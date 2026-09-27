import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import { setProtocolManifest } from "@pdex/sdk/manifest";
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
  MALLOW_OPEN_LIMIT_SHAPE_KEY,
  MALLOW_USDC_ASSET_ID,
  MALLOW_USDC_OPT_IN_SHAPE_KEY,
  assertMallowOrderEncodes,
  mallowOpenLimitShape,
  mallowUsdcOptInShape,
  setMallowBookLoaderForTests,
  setMallowOpenLimitDependenciesForTests,
  setMallowUsdcOptInDependenciesForTests,
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
      PDexV2OrderOps: {
        method_specs: {
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
}): Uint8Array {
  const parts = [
    new TextEncoder().encode("PDX2"),
    Uint8Array.of(3),
    new Uint8Array(32),
    uint64(2006n),
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

function bookFor(markets: MallowPreparedMarket[]): MallowBook {
  return {
    markets,
    quoteOpenLimit: async (body) => ({
      ok: true,
      acceptable_price: body.acceptable_price,
      required_storage_payment_microalgo: "100200",
      crossed: false
    }),
    orderOracle: async (marketId) => ({
      message: restingOracle({
        marketId: BigInt(marketId),
        indexMin: marketId === BTC.marketId ? BTC.prices.indexMin! : ALGO.prices.indexMin!,
        indexMax: marketId === BTC.marketId ? BTC.prices.indexMax! : ALGO.prices.indexMax!
      }),
      signature: new Uint8Array(64)
    })
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
  setMallowUsdcOptInDependenciesForTests(undefined);
  setMallowBookLoaderForTests(undefined);
});

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

function registry(): TransactionShapeRegistry {
  const next = new TransactionShapeRegistry();
  next.register(mallowOpenLimitShape);
  next.register(mallowUsdcOptInShape);
  return next;
}
