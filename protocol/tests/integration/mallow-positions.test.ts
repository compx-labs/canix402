import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import { v2OrderBoxKey, v2PositionBoxKey } from "@pdex/sdk/boxes";
import { SIDE, V2_ORDER_KIND, V2_ORDER_LINK_MODE } from "@pdex/sdk/constants";
import { v2PackOrderLink } from "@pdex/sdk/transactions";

import {
  MALLOW_CANCEL_ORDER_SHAPE_KEY,
  MALLOW_CLOSE_MARKET_SHAPE_KEY,
  MALLOW_USDC_ASSET_ID,
  MallowUpstreamError,
  orderOwnerPrefix,
  readMallowOrderRecordsFromBoxes,
  readMallowPositionsFromBoxes,
  selectMallowOrders,
  setMallowAlgodForTests,
  setMallowBookLoaderForTests,
  type MallowBook,
  type MallowBoxAlgod,
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

const TRADING_APP_ID = 7001;
const ORDER_OPS_APP_ID = 7002;
const ALGO_MARKET_ID = 424242n;
const BTC_MARKET_ID = 515151n;

const MARKETS = [
  { status: "ok", market: "ALGO", marketId: ALGO_MARKET_ID.toString() },
  { status: "ok", market: "BTC", marketId: BTC_MARKET_ID.toString() }
] as MallowMarketRow[];

const POSITION_FIELDS = ["position_id", "size_usd", "collateral_amount", "side", "collateral_asset_id"].map(
  (name) => ({ name, type: "uint64", size: 8 })
);

const ORDER_FIELDS = [
  ...[
    "schema_version",
    "order_kind",
    "target_kind",
    "market_id",
    "owner_order_id",
    "side",
    "collateral_asset_id",
    "size_usd_delta",
    "collateral_amount",
    "trigger_price",
    "acceptable_price",
    "keeper_fee_asset_id",
    "keeper_fee_amount",
    "output_swap_mode",
    "min_primary_output_amount",
    "min_secondary_output_amount",
    "expiry_time",
    "created_at",
    "flags"
  ].map((name) => ({ name, type: "uint64", size: 8 })),
  { name: "builder_address", type: "address", size: 32 },
  { name: "builder_fee_bps", type: "uint64", size: 8 },
  { name: "position_id", type: "uint64", size: 8 }
];

const PROTOCOL = {
  boxes: {
    formats: {
      position_state: { fields: POSITION_FIELDS },
      order_state: { fields: ORDER_FIELDS }
    }
  }
};

function encodeUint64s(fields: readonly { name: string }[], values: Record<string, bigint>): Uint8Array {
  const bytes = new Uint8Array(fields.length * 8);
  const view = new DataView(bytes.buffer);
  fields.forEach((field, index) => {
    view.setBigUint64(index * 8, values[field.name] ?? 0n);
  });
  return bytes;
}

function encodeOrder(values: Record<string, bigint>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const field of ORDER_FIELDS) {
    if (field.type === "address") {
      parts.push(new Uint8Array(32));
      continue;
    }
    const chunk = new Uint8Array(8);
    new DataView(chunk.buffer).setBigUint64(0, values[field.name] ?? 0n);
    parts.push(chunk);
  }
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function positionBox(marketId: bigint, side: number, values: Record<string, bigint>): [string, Uint8Array] {
  const name = v2PositionBoxKey(USER_ADDRESS, marketId, MALLOW_USDC_ASSET_ID, side);
  return [Buffer.from(name).toString("base64"), encodeUint64s(POSITION_FIELDS, values)];
}

function orderBox(ownerOrderId: bigint, values: Record<string, bigint>): { name: Uint8Array; value: Uint8Array } {
  return {
    name: v2OrderBoxKey(USER_ADDRESS, ownerOrderId),
    value: encodeOrder({
      schema_version: 4n,
      collateral_asset_id: BigInt(MALLOW_USDC_ASSET_ID),
      keeper_fee_asset_id: BigInt(MALLOW_USDC_ASSET_ID),
      trigger_price: 1n,
      acceptable_price: 1n,
      owner_order_id: ownerOrderId,
      ...values
    })
  };
}

function boxName(name: Uint8Array): string {
  return Buffer.from(name).toString("base64");
}

function stubAlgod(input: {
  positions?: Map<string, Uint8Array>;
  orders?: Array<{ name: Uint8Array; value: Uint8Array }>;
  ordersError?: Error;
}): MallowBoxAlgod & { calls: { named: number; boxes: number } } {
  const calls = { named: 0, boxes: 0 };
  return {
    calls,
    getApplicationBoxByName(_appId, name) {
      calls.named += 1;
      return {
        async do() {
          const value = input.positions?.get(boxName(name));
          if (!value) {
            throw Object.assign(new Error("box not found"), { status: 404 });
          }
          return { value };
        }
      };
    },
    getApplicationBoxes() {
      const query = {
        prefix() {
          return query;
        },
        limit() {
          return query;
        },
        next() {
          return query;
        },
        include() {
          return query;
        },
        async do() {
          calls.boxes += 1;
          if (input.ordersError) {
            throw input.ordersError;
          }
          return { boxes: input.orders ?? [] };
        }
      };
      return query;
    }
  };
}

function chainBook(): MallowBook {
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
    positions: (address) =>
      readMallowPositionsFromBoxes({
        markets: MARKETS,
        protocol: PROTOCOL,
        tradingAppId: TRADING_APP_ID,
        address
      }),
    orders: async (address) =>
      selectMallowOrders(
        MARKETS,
        await readMallowOrderRecordsFromBoxes({
          markets: MARKETS,
          protocol: PROTOCOL,
          orderOpsAppId: ORDER_OPS_APP_ID,
          address
        })
      ),
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
  setMallowAlgodForTests(undefined);
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
  const positions = new Map<string, Uint8Array>([
    positionBox(ALGO_MARKET_ID, SIDE.LONG, {
      position_id: 77n,
      size_usd: 250_000_000n,
      collateral_amount: 25_000_000n,
      side: BigInt(SIDE.LONG),
      collateral_asset_id: BigInt(MALLOW_USDC_ASSET_ID)
    }),
    positionBox(ALGO_MARKET_ID, SIDE.SHORT, {
      position_id: 4n,
      size_usd: 0n,
      side: BigInt(SIDE.SHORT)
    })
  ]);
  const stop = orderBox(880_000_000_777n, {
    order_kind: BigInt(V2_ORDER_KIND.DECREASE_STOP_LOSS),
    market_id: BTC_MARKET_ID,
    side: BigInt(SIDE.SHORT),
    size_usd_delta: 250_000_000n,
    keeper_fee_amount: 50_000n,
    flags: v2PackOrderLink(V2_ORDER_LINK_MODE.CHILD_ACTIVE, 880_000_000_001n),
    position_id: 88n
  });
  const otherMarket = orderBox(12n, {
    order_kind: BigInt(V2_ORDER_KIND.DECREASE_STOP_LOSS),
    market_id: 999n,
    side: BigInt(SIDE.LONG),
    position_id: 1n
  });
  assert.equal(Buffer.from(stop.name).subarray(0, orderOwnerPrefix(USER_ADDRESS).byteLength).equals(Buffer.from(orderOwnerPrefix(USER_ADDRESS))), true);
  setMallowAlgodForTests(() => stubAlgod({ positions, orders: [stop, otherMarket] }));
  setMallowBookLoaderForTests(async () => chainBook());
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

test("missing Mallow boxes are an empty book, not a partial snapshot", async () => {
  const algod = stubAlgod({});
  setMallowAlgodForTests(() => algod);
  setMallowBookLoaderForTests(async () => chainBook());
  stubOtherCollectors();

  const response = await fetchWalletPositions(USER_ADDRESS);
  assert.equal(response.data.some((row) => row.protocol === "mallow"), false);
  assert.equal(algod.calls.named > 0, true);
  assert.equal(algod.calls.boxes, 1);
  assert.deepEqual(
    response.protocols.find((row) => row.protocol === "mallow"),
    { protocol: "mallow", status: "ok", positionCount: 0, message: null }
  );
});

test("an OrderOps box failure keeps positions already read", async () => {
  const positions = new Map<string, Uint8Array>([
    positionBox(ALGO_MARKET_ID, SIDE.LONG, {
      position_id: 77n,
      size_usd: 250_000_000n,
      collateral_amount: 25_000_000n,
      side: BigInt(SIDE.LONG),
      collateral_asset_id: BigInt(MALLOW_USDC_ASSET_ID)
    })
  ]);
  setMallowAlgodForTests(() =>
    stubAlgod({ positions, ordersError: new Error("algod down") })
  );
  setMallowBookLoaderForTests(async () => chainBook());
  stubOtherCollectors();

  const response = await fetchWalletPositions(USER_ADDRESS);
  const mallow = response.protocols.find((row) => row.protocol === "mallow");
  assert.equal(response.data.some((row) => row.positionId === "mallow:position:ALGO:long:77"), true);
  assert.equal(mallow?.status, "partial");
  assert.match(mallow?.message ?? "", /Mallow orders are unavailable/i);
  assert.doesNotMatch(mallow?.message ?? "", /Mallow positions are unavailable/i);
  assert.equal(response.totals.suppliedUsd, 25);
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
