import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import { V2_ORDER_LINK_MODE } from "@pdex/sdk/constants";

import {
  MALLOW_CANCEL_ORDER_SHAPE_KEY,
  MALLOW_CLOSE_MARKET_SHAPE_KEY,
  MALLOW_USDC_ASSET_ID,
  MallowUpstreamError,
  selectMallowOrders,
  setMallowBookLoaderForTests,
  type MallowAccountOrder,
  type MallowAccountPosition,
  type MallowBook,
  type MallowMarketRow
} from "../../src/execution/shapes/mallow/index.js";
import {
  fetchWalletPositions,
  setPositionCollectorsForTests,
  SUPPORTED_POSITION_PROTOCOLS
} from "../../src/services/aggregate-positions.js";
import type { PositionMarketRecord } from "../../src/services/position-execution-shapes.js";

const USER_ADDRESS = algosdk.generateAccount().addr.toString();
const COMPLETE = {
  suppliedUsdComplete: true,
  borrowedUsdComplete: true,
  rewardsUsdComplete: true
} as const;

const MARKETS = [
  { status: "ok", market: "ALGO", marketId: "424242" },
  { status: "ok", market: "BTC", marketId: "515151" }
] as MallowMarketRow[];

function algoLong(): MallowAccountPosition {
  return {
    positionId: "77",
    owner: USER_ADDRESS,
    market: "ALGO",
    marketId: "424242",
    side: "long",
    sizeUsd: 250_000_000n,
    collateralAmount: 25_000_000n,
    collateralAssetId: MALLOW_USDC_ASSET_ID
  };
}

function orphanedStop(): MallowAccountOrder {
  return {
    ownerOrderId: "880000000777",
    owner: USER_ADDRESS,
    market: "BTC",
    marketId: "515151",
    side: "short",
    orderKind: "stopLoss",
    sizeUsd: 250_000_000n,
    collateralAmount: 0n,
    collateralAssetId: MALLOW_USDC_ASSET_ID,
    keeperFeeAmount: 50_000n,
    keeperFeeAssetId: MALLOW_USDC_ASSET_ID,
    linkMode: V2_ORDER_LINK_MODE.CHILD_ACTIVE,
    linkBaseOrderId: 880_000_000_001n,
    positionId: "88",
    schemaVersion: 4,
    raw: {}
  };
}

function book(positions: MallowAccountPosition[], orders: MallowAccountOrder[]): MallowBook {
  return {
    markets: MARKETS,
    quoteOpenLimit: async () => ({}),
    quoteDecrease: async () => ({}),
    orderOracle: async () => {
      throw new Error("unused");
    },
    tradingOracle: async () => {
      throw new Error("unused");
    },
    positions: async () => positions,
    orders: async () => orders,
    recallClient: {} as MallowBook["recallClient"]
  };
}

function stubOtherCollectors(
  extras?: Partial<Record<(typeof SUPPORTED_POSITION_PROTOCOLS)[number], () => Promise<{
    positions: PositionMarketRecord[];
    warnings: string[];
    coverage: typeof COMPLETE;
  }>>>
): void {
  setPositionCollectorsForTests(
    Object.fromEntries(
      SUPPORTED_POSITION_PROTOCOLS.filter((protocol) => protocol !== "mallow").map((protocol) => [
        protocol,
        extras?.[protocol] ??
          (async () => ({ positions: [], warnings: [], coverage: COMPLETE }))
      ])
    ) as Parameters<typeof setPositionCollectorsForTests>[0]
  );
}

test.afterEach(() => {
  setMallowBookLoaderForTests(undefined);
  setPositionCollectorsForTests(undefined);
});

test("keeps ALGO and BTC USDC orders and marks other markets unsupported", () => {
  const orders = selectMallowOrders(MARKETS, {
    orders: [
      {
        owner: USER_ADDRESS,
        owner_order_id: "11",
        market_id: "424242",
        side: 1,
        order_kind: 1,
        collateral_asset_id: MALLOW_USDC_ASSET_ID,
        collateral_amount: "25000000"
      },
      {
        owner: USER_ADDRESS,
        owner_order_id: "12",
        market_id: "999",
        side: 1,
        order_kind: 3,
        collateral_asset_id: MALLOW_USDC_ASSET_ID
      },
      {
        owner: USER_ADDRESS,
        owner_order_id: "13",
        market_id: "424242",
        side: 2,
        order_kind: 2,
        collateral_asset_id: 1
      }
    ]
  });

  assert.deepEqual(
    orders.map((order) => ({ id: order.ownerOrderId, market: order.market })),
    [
      { id: "11", market: "ALGO" },
      { id: "12", market: null },
      { id: "13", market: null }
    ]
  );
});

test("wallet positions include an open Mallow perp and an orphaned stop-loss", async () => {
  setMallowBookLoaderForTests(async () =>
    book(
      [algoLong(), { ...algoLong(), positionId: "4", sizeUsd: 0n }],
      [orphanedStop(), { ...orphanedStop(), ownerOrderId: "12", market: null, marketId: "999" }]
    )
  );
  stubOtherCollectors();

  const response = await fetchWalletPositions(USER_ADDRESS);
  const perp = response.data.find((row) => row.positionId === "mallow:position:ALGO:long:77");
  const order = response.data.find((row) => row.positionId === "mallow:order:880000000777");

  assert.ok(perp);
  assert.equal(perp.positionType, "supplied");
  assert.equal(perp.amount, "25");
  assert.equal(perp.usdValue, 25);
  assert.equal(perp.notes?.includes("ALGO/USD long"), true);
  assert.equal(perp.caveats?.some((caveat) => /margin, not marked equity/i.test(caveat)), true);
  assert.deepEqual(perp.inputHints, {
    mallowMarket: "ALGO",
    mallowSide: "long",
    pexPositionId: "77"
  });
  assert.deepEqual(perp.compatibleExitShapeKeys, [MALLOW_CLOSE_MARKET_SHAPE_KEY]);

  assert.ok(order);
  assert.equal(order.positionType, "supplied");
  assert.equal(order.caveats?.some((caveat) => /orphaned/i.test(caveat)), true);
  assert.equal(order.inputHints?.ownerOrderId, "880000000777");
  assert.deepEqual(order.compatibleExitShapeKeys, [MALLOW_CANCEL_ORDER_SHAPE_KEY]);

  assert.equal(response.data.some((row) => row.positionId.includes(":4")), false);
  assert.equal(response.data.some((row) => row.positionId === "mallow:order:12"), false);
  assert.deepEqual(
    response.protocols.find((row) => row.protocol === "mallow"),
    { protocol: "mallow", status: "ok", positionCount: 2, message: null }
  );
});

test("a Mallow proxy error warns and leaves the rest of the wallet priced", async () => {
  setMallowBookLoaderForTests(async () => {
    throw new MallowUpstreamError("proxy down");
  });
  stubOtherCollectors({
    tinyman: async () => ({
      positions: [
        {
          protocol: "tinyman",
          positionType: "supplied",
          positionId: "tinyman:supplied:1",
          opportunityId: null,
          assetId: 0,
          assetSymbol: "ALGO",
          amountRaw: "1",
          amount: "1",
          usdValue: 12
        }
      ],
      warnings: [],
      coverage: COMPLETE
    })
  });

  const response = await fetchWalletPositions(USER_ADDRESS);
  const mallow = response.protocols.find((row) => row.protocol === "mallow");
  assert.equal(mallow?.status, "partial");
  assert.match(mallow?.message ?? "", /unavailable/i);
  assert.equal(response.data.some((row) => row.protocol === "mallow"), false);
  assert.equal(response.totals.suppliedUsd, 12);
});
