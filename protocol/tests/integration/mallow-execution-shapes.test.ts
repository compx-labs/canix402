import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import { V2_ORDER_LINK_MODE } from "@pdex/sdk/constants";
import { setProtocolManifest } from "@pdex/sdk/manifest";
import { computeMarketYieldRegistryHash } from "@pdex/sdk/marketYield";
import type { MarketYieldActionRecallClient } from "@pdex/sdk/marketYield";
import { ORACLE_PRICE_SCALE } from "@pdex/sdk/oracle";

import { buildApp } from "../../src/app.js";
import {
  InvalidShapeInputError,
  ShapeStateError,
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  MALLOW_CANCEL_ORDER_SHAPE_KEY,
  MALLOW_CLOSE_MARKET_SHAPE_KEY,
  MALLOW_OPEN_LIMIT_SHAPE_KEY,
  MALLOW_USDC_ASSET_ID,
  MALLOW_USDC_OPT_IN_SHAPE_KEY,
  assertMallowCancelEncodes,
  assertMallowOrderEncodes,
  mallowCancelOrderShape,
  mallowCloseMarketShape,
  mallowOpenLimitShape,
  mallowUsdcOptInShape,
  selectMallowPositions,
  setMallowBookLoaderForTests,
  setMallowCancelOrderDependenciesForTests,
  setMallowCloseMarketDependenciesForTests,
  setMallowOpenLimitDependenciesForTests,
  setMallowUsdcOptInDependenciesForTests,
  type MallowAccountOrder,
  type MallowAccountPosition,
  type MallowBook,
  type MallowPreparedMarket
} from "../../src/execution/shapes/mallow/index.js";
import { numberToPrice12 } from "../../src/execution/shapes/mallow/math.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const BUILDER = algosdk.generateAccount().addr.toString();
const GENESIS_HASH = new Uint8Array(32).fill(7);

function methodSpec(signature: string, types: string[]) {
  return {
    signature,
    args: types.map((type, index) => ({ type, name: `arg${index}` })),
    returns: { type: "void" }
  };
}

const SUBMIT_LINKED_UINT64 = Array.from({ length: 21 }, () => "uint64");

setProtocolManifest(
  {
    receipts: { version: 1, flags: {}, types: {} },
    apps: {
      PDexV2Math: { method_specs: { noop: methodSpec("noop()void", []) } },
      PDexV2Trading: {
        method_specs: {
          decrease_or_close: methodSpec(
            `decrease_or_close(${[
              ...Array.from({ length: 8 }, () => "uint64"),
              "(address,uint64)",
              "byte[]",
              "byte[]",
              ...Array.from({ length: 4 }, () => "uint64")
            ].join(",")})void`,
            [
              ...Array.from({ length: 8 }, () => "uint64"),
              "(address,uint64)",
              "byte[]",
              "byte[]",
              ...Array.from({ length: 4 }, () => "uint64")
            ]
          )
        }
      },
      PDexV2OrderOps: {
        method_specs: {
          cancel_order: methodSpec("cancel_order(uint64)void", ["uint64"]),
          submit_linked_order: methodSpec(
            `submit_linked_order(${[...SUBMIT_LINKED_UINT64, "(address,uint64)", "txn", "pay", "byte[]", "byte[]"].join(",")})byte[]`,
            [...SUBMIT_LINKED_UINT64, "(address,uint64)", "txn", "pay", "byte[]", "byte[]"]
          )
        }
      }
    }
  },
  2
);

function uint64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value);
  return out;
}

function restingOracle(input: {
  marketId: bigint;
  indexMin: bigint;
  indexMax: bigint;
  targetAppId?: bigint;
}): Uint8Array {
  const parts = [
    new TextEncoder().encode("PDX2"),
    Uint8Array.of(3),
    new Uint8Array(32),
    uint64(input.targetAppId ?? 2006n),
    uint64(input.marketId),
    uint64(10n),
    uint64(11n),
    uint64(12n),
    uint64(input.indexMin),
    uint64(input.indexMax),
    uint64(ORACLE_PRICE_SCALE),
    uint64(ORACLE_PRICE_SCALE),
    uint64(ORACLE_PRICE_SCALE),
    uint64(ORACLE_PRICE_SCALE),
    uint64(1_700_000_000n)
  ];
  const message = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    message.set(part, offset);
    offset += part.length;
  }
  return message;
}

function suggestedParams(): algosdk.SuggestedParams {
  return {
    fee: 1_000n,
    minFee: 1_000n,
    firstValid: 1_000n,
    lastValid: 2_000n,
    genesisID: "mainnet-v1.0",
    genesisHash: GENESIS_HASH,
    flatFee: false
  };
}

function preparedMarket(input: {
  market: "ALGO" | "BTC";
  marketId: string;
  index: bigint;
  indexMin: bigint;
  indexMax: bigint;
}): MallowPreparedMarket {
  return {
    market: input.market,
    status: "ok",
    marketId: input.marketId,
    poolId: "9",
    symbol: `${input.market}/USD`,
    baseSymbol: input.market,
    quoteSymbol: "USD",
    prices: {
      index: input.index,
      indexMin: input.indexMin,
      indexMax: input.indexMax,
      short: ORACLE_PRICE_SCALE,
      shortMin: ORACLE_PRICE_SCALE
    },
    maxLeverage: 20,
    collateralAssetId: MALLOW_USDC_ASSET_ID,
    openFeeBps: 10n,
    closeFeeBps: 10n,
    collateralPrice12: ORACLE_PRICE_SCALE,
    orderOpsAppId: 2006,
    appRefs: {
      v2MarketsAppId: 2001,
      v2TradingAppId: 2002,
      v2AdminControlAppId: 2003,
      v2MathAppId: 2004,
      v2TradingRiskOpsAppId: 2008,
      v2MarketXalgoYieldVaultAppId: 2009
    },
    assetRefs: {
      indexAssetId: 10,
      longAssetId: 11,
      shortAssetId: 12
    },
    raw: {
      initial_margin_bps: 500,
      open_fee_bps: 10,
      close_fee_bps: 10
    }
  };
}

const ALGO = preparedMarket({
  market: "ALGO",
  marketId: "424242",
  index: numberToPrice12(0.101),
  indexMin: numberToPrice12(0.1005),
  indexMax: numberToPrice12(0.1015)
});

const BTC = preparedMarket({
  market: "BTC",
  marketId: "515151",
  index: numberToPrice12(61_000),
  indexMin: numberToPrice12(60_500),
  indexMax: numberToPrice12(61_500)
});

function bandFor(marketId: string): { indexMin: bigint; indexMax: bigint } {
  const market = marketId === BTC.marketId ? BTC : ALGO;
  return { indexMin: market.prices.indexMin!, indexMax: market.prices.indexMax! };
}

function closeRecallClient(): MarketYieldActionRecallClient {
  return {
    network: "mainnet",
    async v2MarketYieldActionRecallPlan(input) {
      const outputs = Array.isArray(input.outputs) ? input.outputs : [];
      const marketId = String(input.market_id);
      const assetIds = outputs.map((output) => String((output as { asset_id?: unknown }).asset_id));
      const registry = {
        schema_version: 1,
        registry_version: "mallow-test",
        last_indexed_round: 1,
        markets_app_id: 2001,
        market_yield_vault_app_id: 2010,
        markets_app_address: "",
        market_yield_vault_app_address: "",
        market_folks_yield_vault_app_id: 0,
        market_folks_yield_vault_app_address: "",
        market_xalgo_yield_vault_app_id: 0,
        market_xalgo_yield_vault_app_address: "",
        xalgo_consensus_app_id: 0,
        xalgo_asset_id: 0,
        xalgo_proposer_addresses: [],
        action_recall_uses_router: false,
        base_heavy_call_flat_fee_micro_algos: 0,
        market_yield_recall_flat_fee_micro_algos: 0,
        strategies: [],
        markets: [
          {
            market_id: Number(marketId),
            index_asset_id: 10,
            pool_type: 1,
            long_asset_id: Number(assetIds[0] ?? 0),
            short_asset_id: Number(assetIds[1] ?? 0)
          }
        ]
      };
      const registryHash = computeMarketYieldRegistryHash(registry);
      return {
        preparation_version: 1,
        network: "mainnet",
        markets_app_id: "2001",
        observed_round: "1",
        market_id: marketId,
        atomic_action_ready: true,
        blockers: [],
        registry_version: "mallow-test",
        registry_hash: registryHash,
        market_yield_registry: { ...registry, registry_hash: registryHash },
        yield_recall_mode: 0,
        caps_by_asset: Object.fromEntries(assetIds.map((assetId) => [assetId, "0"])),
        plans: outputs.map((output) => {
          const row = output as { asset_id?: unknown; required_hot_amount?: unknown };
          return {
            asset_id: String(row.asset_id),
            market_id: marketId,
            required_hot_amount: String(row.required_hot_amount),
            yield_configured: false,
            cap_sufficient: true,
            atomic_action_ready: true,
            requires_pre_recall: false,
            blockers: [],
            max_receipt_amount: "0",
            available_receipt_amount: "0",
            action_recall_capacity_available: false,
            liquidity_accounting: {
              status: "valid",
              pool_amount: "0",
              economic_underlying: "0",
              signed_hot_amount: "0",
              deficit_amount: "0"
            }
          };
        })
      };
    },
    async v2MarketYieldResourceRegistry() {
      throw new Error("embedded registry should satisfy recall planning");
    }
  };
}

function bookFor(markets: MallowPreparedMarket[], extras?: Partial<MallowBook>): MallowBook {
  return {
    markets,
    quoteOpenLimit: async (body) => ({
      ok: true,
      acceptable_price: body.acceptable_price,
      required_storage_payment_microalgo: "100200",
      crossed: false
    }),
    quoteDecrease: async (body) => ({
      ok: true,
      acceptable_price: body.acceptable_price,
      primary_output_amount: "1000000",
      pnl_output_amount: "0"
    }),
    orderOracle: async (marketId) => ({
      message: restingOracle({
        marketId: BigInt(marketId),
        ...bandFor(marketId)
      }),
      signature: new Uint8Array(64)
    }),
    tradingOracle: async (marketId) => ({
      message: restingOracle({
        marketId: BigInt(marketId),
        targetAppId: 2002n,
        ...bandFor(marketId)
      }),
      signature: new Uint8Array(64)
    }),
    positions: async () => [],
    orders: async () => [],
    recallClient: closeRecallClient(),
    ...extras
  };
}

function algoPosition(overrides?: Partial<MallowAccountPosition>): MallowAccountPosition {
  return {
    positionId: "77",
    owner: USER_ADDRESS,
    market: "ALGO",
    marketId: ALGO.marketId,
    side: "long",
    sizeUsd: 250_000_000n,
    collateralAmount: 25_000_000n,
    collateralAssetId: MALLOW_USDC_ASSET_ID,
    ...overrides
  };
}

function buildContext(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    now: () => Date.UTC(2026, 8, 27, 12, 0, 0),
    quoteTtlMs: 30_000
  };
}

test.afterEach(() => {
  setMallowOpenLimitDependenciesForTests(undefined);
  setMallowCloseMarketDependenciesForTests(undefined);
  setMallowCancelOrderDependenciesForTests(undefined);
  setMallowUsdcOptInDependenciesForTests(undefined);
  setMallowBookLoaderForTests(undefined);
});

const PARENT_ORDER_ID = 880_000_000_001n;
const TAKE_PROFIT_ORDER_ID = 880_000_000_002n;
const STOP_LOSS_ORDER_ID = 880_000_000_003n;
const ORPHAN_ORDER_ID = 880_000_000_777n;

function restingOrder(overrides?: Partial<MallowAccountOrder>): MallowAccountOrder {
  return {
    ownerOrderId: PARENT_ORDER_ID.toString(),
    owner: USER_ADDRESS,
    market: "ALGO",
    marketId: ALGO.marketId,
    side: "long",
    orderKind: "openLimit",
    sizeUsd: 250_000_000n,
    collateralAmount: 25_000_000n,
    collateralAssetId: MALLOW_USDC_ASSET_ID,
    keeperFeeAmount: 50_000n,
    keeperFeeAssetId: MALLOW_USDC_ASSET_ID,
    linkMode: V2_ORDER_LINK_MODE.BRACKET_PARENT,
    linkBaseOrderId: PARENT_ORDER_ID,
    positionId: null,
    schemaVersion: 4,
    raw: {},
    ...overrides
  };
}

function installCancelDependencies(book: MallowBook): void {
  setMallowCancelOrderDependenciesForTests({
    loadBook: async () => book,
    getSuggestedParams: async () => suggestedParams()
  });
}

function installCloseDependencies(book: MallowBook, optedIn = true): void {
  setMallowCloseMarketDependenciesForTests({
    loadBook: async () => book,
    builderFee: () => ({ builderAddress: BUILDER, builderFeeBps: 3n }),
    accountOptedIntoUsdc: async () => optedIn,
    getSuggestedParams: async () => suggestedParams()
  });
}

function installOrderDependencies(book: MallowBook, optedIn = true): void {
  setMallowOpenLimitDependenciesForTests({
    loadBook: async () => book,
    builderFee: () => ({ builderAddress: BUILDER, builderFeeBps: 3n }),
    accountOptedIntoUsdc: async () => optedIn,
    getSuggestedParams: async () => suggestedParams(),
    nextOwnerOrderId: () => 100n
  });
}

test("compiles an unsigned ALGO long with attached take-profit and stop-loss", async () => {
  installOrderDependencies(bookFor([ALGO, BTC]));
  const quote = await compileExecutableQuote(
    registry(),
    mallowOpenLimitShape.key,
    {
      userAddress: USER_ADDRESS,
      market: "ALGO",
      side: "long",
      collateralUsd: 25,
      leverage: 10,
      entryPriceUsd: 0.1,
      takeProfitPct: 20,
      stopLossPct: 25
    },
    buildContext()
  );

  assert.equal(MALLOW_OPEN_LIMIT_SHAPE_KEY, "mainnet:mallow:v1:openLimit:attached");
  assert.equal(quote.shapeKey, MALLOW_OPEN_LIMIT_SHAPE_KEY);
  assert.equal(quote.metadata.market, "ALGO");
  assert.equal(quote.metadata.marketId, "424242");
  assert.equal(quote.metadata.builderAddress, BUILDER);
  assert.equal(quote.metadata.builderFeeBps, 3);
  assert.equal(quote.metadata.executionSubmitted, false);
  assert.equal(quote.metadata.takeProfitPct, 20);
  assert.equal(quote.metadata.stopLossPct, 25);
  assert.ok(quote.encodedTransactions.length > 1);
  assertMallowOrderEncodes({
    transactions: quote.transactions,
    marketId: 424242n,
    builderAddress: BUILDER
  });
});

test("compiles an unsigned BTC long against the BTC market id", async () => {
  installOrderDependencies(bookFor([ALGO, BTC]));
  const quote = await compileExecutableQuote(
    registry(),
    mallowOpenLimitShape.key,
    {
      userAddress: USER_ADDRESS,
      market: "BTC",
      side: "long",
      collateralUsd: 50,
      leverage: 5,
      entryPriceUsd: 60_000,
      takeProfitPct: 20,
      stopLossPct: 25
    },
    buildContext()
  );

  assert.equal(quote.metadata.market, "BTC");
  assert.equal(quote.metadata.marketId, "515151");
  assert.equal(quote.metadata.entryPriceUsd, "60000");
  assertMallowOrderEncodes({
    transactions: quote.transactions,
    marketId: 515151n,
    builderAddress: BUILDER
  });
});

test("refuses a wallet that is not opted into USDC", async () => {
  installOrderDependencies(bookFor([ALGO, BTC]), false);
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowOpenLimitShape.key,
        {
          userAddress: USER_ADDRESS,
          market: "ALGO",
          side: "long",
          collateralUsd: 25,
          leverage: 10,
          entryPriceUsd: 0.1,
          takeProfitPct: 20,
          stopLossPct: 25
        },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "not-opted-in");
      return true;
    }
  );
});

test("refuses leverage above the market maximum", async () => {
  installOrderDependencies(bookFor([ALGO, BTC]));
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowOpenLimitShape.key,
        {
          userAddress: USER_ADDRESS,
          market: "ALGO",
          side: "long",
          collateralUsd: 25,
          leverage: 50,
          entryPriceUsd: 0.1,
          takeProfitPct: 20,
          stopLossPct: 25
        },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "leverage-above-max");
      return true;
    }
  );
});

test("refuses a limit that is already through the index", async () => {
  const crossed = preparedMarket({
    market: "ALGO",
    marketId: "424242",
    index: numberToPrice12(0.05),
    indexMin: numberToPrice12(0.04),
    indexMax: numberToPrice12(0.05)
  });
  installOrderDependencies(bookFor([crossed]));
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowOpenLimitShape.key,
        {
          userAddress: USER_ADDRESS,
          market: "ALGO",
          side: "long",
          collateralUsd: 25,
          leverage: 10,
          entryPriceUsd: 0.1,
          takeProfitPct: 20,
          stopLossPct: 25
        },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "limit-crossed");
      return true;
    }
  );
});

test("rejects a market other than ALGO or BTC", () => {
  assert.throws(
    () =>
      mallowOpenLimitShape.parseInput({
        userAddress: USER_ADDRESS,
        market: "ETH",
        side: "long",
        collateralUsd: 10,
        leverage: 2,
        entryPriceUsd: 1,
        takeProfitPct: 10,
        stopLossPct: 10
      }),
    (error: unknown) => error instanceof InvalidShapeInputError
  );
});

test("compiles a zero-amount USDC opt-in", async () => {
  setMallowUsdcOptInDependenciesForTests({
    accountOptedIntoUsdc: async () => false,
    getSuggestedParams: async () => suggestedParams()
  });
  const quote = await compileExecutableQuote(
    registry(),
    mallowUsdcOptInShape.key,
    { userAddress: USER_ADDRESS },
    buildContext()
  );
  assert.equal(MALLOW_USDC_OPT_IN_SHAPE_KEY, "mainnet:mallow:v1:optIn:usdc");
  assert.equal(quote.shapeKey, MALLOW_USDC_OPT_IN_SHAPE_KEY);
  assert.equal(quote.transactions.length, 1);
  assert.equal(quote.transactions[0]?.type, "axfer");
  assert.equal(quote.transactions[0]?.assetTransfer?.assetIndex, String(MALLOW_USDC_ASSET_ID));
  assert.equal(quote.transactions[0]?.assetTransfer?.amount, "0");
  assert.equal(quote.metadata.executionSubmitted, false);
});

test("GET /protocols/mallow/markets keeps a missing pair on its own row", async () => {
  setMallowBookLoaderForTests(async () => bookFor([ALGO]));
  const app = buildApp();
  try {
    const response = await app.inject({ method: "GET", url: "/protocols/mallow/markets" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: {
        shapeKey: string;
        builderFeeBps: number;
        markets: Array<{ market: string; status: string; marketId: string | null; reason: string | null }>;
      };
    };
    assert.equal(body.data.shapeKey, MALLOW_OPEN_LIMIT_SHAPE_KEY);
    assert.equal(body.data.builderFeeBps, 3);
    assert.equal(body.data.markets.find((row) => row.market === "ALGO")?.status, "ok");
    assert.equal(body.data.markets.find((row) => row.market === "ALGO")?.marketId, "424242");
    assert.equal(body.data.markets.find((row) => row.market === "BTC")?.status, "unavailable");
    assert.equal(body.data.markets.find((row) => row.market === "BTC")?.reason, "market-unavailable");
  } finally {
    await app.close();
  }
});

test("compiles an unsigned full close of an ALGO long", async () => {
  installCloseDependencies(
    bookFor([ALGO, BTC], {
      positions: async () => [algoPosition()]
    })
  );
  const quote = await compileExecutableQuote(
    registry(),
    mallowCloseMarketShape.key,
    {
      userAddress: USER_ADDRESS,
      market: "ALGO",
      side: "long",
      positionId: "77"
    },
    buildContext()
  );

  assert.equal(MALLOW_CLOSE_MARKET_SHAPE_KEY, "mainnet:mallow:v1:close:market");
  assert.equal(quote.shapeKey, MALLOW_CLOSE_MARKET_SHAPE_KEY);
  assert.equal(quote.metadata.positionId, "77");
  assert.equal(quote.metadata.marketId, "424242");
  assert.equal(quote.metadata.sizeUsd, "250");
  assert.equal(quote.metadata.minPrimaryOutput, "1000000");
  assert.equal(quote.metadata.builderAddress, BUILDER);
  assert.equal(quote.metadata.executionSubmitted, false);
  assert.ok(quote.warnings.some((warning) => /not cancelled/i.test(warning)));
  assertMallowOrderEncodes({
    transactions: quote.transactions,
    marketId: 424242n,
    positionId: 77n,
    builderAddress: BUILDER
  });
});

test("refuses a missing Mallow position", async () => {
  installCloseDependencies(bookFor([ALGO, BTC]));
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowCloseMarketShape.key,
        { userAddress: USER_ADDRESS, market: "ALGO", side: "long", positionId: "77" },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "position-not-found");
      return true;
    }
  );
});

test("refuses a replaced Mallow position id", async () => {
  installCloseDependencies(
    bookFor([ALGO, BTC], {
      positions: async () => [algoPosition({ positionId: "88" })]
    })
  );
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowCloseMarketShape.key,
        { userAddress: USER_ADDRESS, market: "ALGO", side: "long", positionId: "77" },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "position-replaced");
      return true;
    }
  );
});

test("refuses a zero-size Mallow position", async () => {
  installCloseDependencies(
    bookFor([ALGO, BTC], {
      positions: async () => [algoPosition({ sizeUsd: 0n })]
    })
  );
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowCloseMarketShape.key,
        { userAddress: USER_ADDRESS, market: "ALGO", side: "long", positionId: "77" },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "position-not-found");
      return true;
    }
  );
});

test("refuses a rejected Mallow decrease quote", async () => {
  installCloseDependencies(
    bookFor([ALGO, BTC], {
      positions: async () => [algoPosition()],
      quoteDecrease: async () => ({ ok: false, failure_reasons: ["insufficient_liquidity"] })
    })
  );
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowCloseMarketShape.key,
        { userAddress: USER_ADDRESS, market: "ALGO", side: "long", positionId: "77" },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "quote-rejected");
      return true;
    }
  );
});

test("GET /protocols/mallow/positions returns ALGO and BTC rows and omits other markets", async () => {
  setMallowBookLoaderForTests(async () =>
    bookFor([ALGO, BTC], {
      positions: async () =>
        selectMallowPositions([ALGO, BTC], [
          {
            position_id: "77",
            market_id: ALGO.marketId,
            side: 1,
            size_usd: "250000000",
            collateral_amount: "25000000",
            collateral_asset_id: MALLOW_USDC_ASSET_ID,
            owner: USER_ADDRESS
          },
          {
            position_id: "88",
            market_id: BTC.marketId,
            side: 2,
            size_usd: "1000000",
            collateral_amount: "500000",
            collateral_asset_id: MALLOW_USDC_ASSET_ID
          },
          {
            position_id: "3",
            market_id: "999",
            side: 1,
            size_usd: "9000000",
            collateral_amount: "1000000",
            collateral_asset_id: MALLOW_USDC_ASSET_ID
          },
          {
            position_id: "4",
            market_id: ALGO.marketId,
            side: 1,
            size_usd: "0",
            collateral_amount: "0",
            collateral_asset_id: MALLOW_USDC_ASSET_ID
          }
        ])
    })
  );
  const app = buildApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: `/protocols/mallow/positions?address=${USER_ADDRESS}`
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: {
        shapeKey: string;
        positions: Array<{ positionId: string; market: string; side: string; sizeUsd: string }>;
      };
    };
    assert.equal(body.data.shapeKey, MALLOW_CLOSE_MARKET_SHAPE_KEY);
    assert.deepEqual(
      body.data.positions.map((position) => position.positionId),
      ["77", "88"]
    );
    assert.equal(body.data.positions.find((position) => position.market === "ALGO")?.sizeUsd, "250");
    assert.equal(body.data.positions.find((position) => position.market === "BTC")?.side, "short");
    assert.equal(body.data.positions.some((position) => position.positionId === "3"), false);
    assert.equal(body.data.positions.some((position) => position.positionId === "4"), false);

    const unknown = await app.inject({ method: "GET", url: "/protocols/mallow/positions?address=not-an-address" });
    assert.equal(unknown.statusCode, 200);
    assert.deepEqual(unknown.json().data.positions, []);
  } finally {
    await app.close();
  }
});

test("cancels a bracket parent with both child box ids and no builder fee", async () => {
  installCancelDependencies(
    bookFor([ALGO, BTC], {
      orders: async () => [restingOrder()]
    })
  );
  const quote = await compileExecutableQuote(
    registry(),
    mallowCancelOrderShape.key,
    { userAddress: USER_ADDRESS, ownerOrderId: PARENT_ORDER_ID.toString() },
    buildContext()
  );

  assert.equal(MALLOW_CANCEL_ORDER_SHAPE_KEY, "mainnet:mallow:v1:cancelOrder:resting");
  assert.equal(quote.shapeKey, MALLOW_CANCEL_ORDER_SHAPE_KEY);
  assert.equal(quote.metadata.builderAddress, null);
  assert.equal(quote.metadata.builderFeeBps, 0);
  assert.equal(quote.metadata.attachedTakeProfitOrderId, TAKE_PROFIT_ORDER_ID.toString());
  assert.equal(quote.metadata.attachedStopLossOrderId, STOP_LOSS_ORDER_ID.toString());
  assert.equal(quote.metadata.executionSubmitted, false);
  assert.equal(quote.transactions.length, 2);
  assertMallowCancelEncodes({
    transactions: quote.transactions,
    orderIds: [PARENT_ORDER_ID, TAKE_PROFIT_ORDER_ID, STOP_LOSS_ORDER_ID]
  });
});

test("cancels a lone orphaned stop-loss by its own id", async () => {
  installCancelDependencies(
    bookFor([ALGO, BTC], {
      orders: async () => [
        restingOrder({
          ownerOrderId: ORPHAN_ORDER_ID.toString(),
          orderKind: "stopLoss",
          linkMode: V2_ORDER_LINK_MODE.CHILD_ACTIVE,
          linkBaseOrderId: PARENT_ORDER_ID,
          collateralAmount: 0n,
          positionId: "77"
        })
      ]
    })
  );
  const quote = await compileExecutableQuote(
    registry(),
    mallowCancelOrderShape.key,
    { userAddress: USER_ADDRESS, ownerOrderId: ORPHAN_ORDER_ID.toString() },
    buildContext()
  );

  assert.equal(quote.metadata.orderKind, "stopLoss");
  assert.equal(quote.metadata.attachedTakeProfitOrderId, null);
  assert.equal(quote.transactions.length, 1);
  assertMallowCancelEncodes({
    transactions: quote.transactions,
    orderIds: [ORPHAN_ORDER_ID],
    absentOrderIds: [PARENT_ORDER_ID, TAKE_PROFIT_ORDER_ID, STOP_LOSS_ORDER_ID]
  });
});

test("refuses a Mallow order owned by someone else", async () => {
  installCancelDependencies(
    bookFor([ALGO, BTC], {
      orders: async () => [restingOrder({ owner: BUILDER })]
    })
  );
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowCancelOrderShape.key,
        { userAddress: USER_ADDRESS, ownerOrderId: PARENT_ORDER_ID.toString() },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "order-not-owned");
      return true;
    }
  );
});

test("refuses a Mallow order outside ALGO and BTC", async () => {
  installCancelDependencies(
    bookFor([ALGO, BTC], {
      orders: async () => [restingOrder({ market: null, marketId: "999" })]
    })
  );
  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry(),
        mallowCancelOrderShape.key,
        { userAddress: USER_ADDRESS, ownerOrderId: PARENT_ORDER_ID.toString() },
        buildContext()
      ),
    (error: unknown) => {
      assert.ok(error instanceof ShapeStateError);
      assert.equal((error.details as { reason?: string }).reason, "market-unavailable");
      return true;
    }
  );
});

function registry(): TransactionShapeRegistry {
  const next = new TransactionShapeRegistry();
  next.register(mallowOpenLimitShape);
  next.register(mallowCloseMarketShape);
  next.register(mallowCancelOrderShape);
  next.register(mallowUsdcOptInShape);
  return next;
}
