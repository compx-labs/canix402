import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  HogswapClientError,
  HogswapNoRouteError,
  HogswapQuoteExpiredError,
  parseHogswapQuote,
  type HogswapExecuteResult,
  type HogswapQuote
} from "../../src/services/hogswap-client.js";
import {
  HogswapRouterError,
  createHogswapSwapService,
  setHogswapSwapServiceDependenciesForTests
} from "../../src/services/hogswap-router.js";
import {
  hogswapAlgoUsdcQuotePayload,
  hogswapGoldUsdcQuotePayload,
  HOGSWAP_FIXTURE_GOLD_ASSET_ID,
  HOGSWAP_FIXTURE_ROUTER_APP_ID,
  HOGSWAP_FIXTURE_USDC_ASSET_ID
} from "../fixtures/hogswap/swap.js";

const ADDRESS = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const OTHER_ADDRESS = algosdk.generateAccount().addr.toString();
const QUOTED_AT = Date.UTC(2026, 8, 7, 12, 0, 0);

test.afterEach(() => {
  setHogswapSwapServiceDependenciesForTests(undefined);
});

function suggestedParams(fee: number): algosdk.SuggestedParams {
  return {
    fee: BigInt(fee),
    minFee: 1000n,
    firstValid: 1000n,
    lastValid: 2000n,
    genesisID: "mainnet-v1.0",
    genesisHash: new Uint8Array(32).fill(11),
    flatFee: true
  };
}

function encodeMember(txn: algosdk.Transaction): { txnB64: string; description: string } {
  return {
    txnB64: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString("base64"),
    description: txn.type === "appl" ? "HOGSWAP router call" : "asset transfer"
  };
}

function buildUnsignedSwapGroup(input: {
  sender: string;
  assetIndex: number;
  amount: bigint;
}): { transactions: algosdk.Transaction[]; execute: HogswapExecuteResult } {
  const params = suggestedParams(1000);
  const receiver = algosdk.getApplicationAddress(HOGSWAP_FIXTURE_ROUTER_APP_ID).toString();
  const transfer =
    input.assetIndex === 0
      ? algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: input.sender,
          receiver,
          amount: input.amount,
          suggestedParams: params
        })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: input.sender,
          receiver,
          amount: input.amount,
          assetIndex: input.assetIndex,
          suggestedParams: params
        });
  const appl = algosdk.makeApplicationNoOpTxnFromObject({
    sender: input.sender,
    appIndex: BigInt(HOGSWAP_FIXTURE_ROUTER_APP_ID),
    suggestedParams: { ...params, fee: 5000n, flatFee: true }
  });
  const transactions = [transfer, appl];
  algosdk.assignGroupID(transactions);
  return {
    transactions,
    execute: {
      quoteId: "q-algo-usdc-fixture",
      unsignedGroup: transactions.map(encodeMember),
      routerAppId: HOGSWAP_FIXTURE_ROUTER_APP_ID,
      groupIdB64: Buffer.from(transactions[0]?.group ?? new Uint8Array()).toString("base64"),
      assetIn: input.assetIndex,
      assetOut: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      amountIn: Number(input.amount),
      minOutAtSlippage: 94_169,
      networkFeeMicroalgo: 19_000,
      notes: ["unsigned; never broadcast"],
      raw: {}
    }
  };
}

function parsedQuote(payload: Record<string, unknown>): HogswapQuote {
  return parseHogswapQuote({ ...payload, quoted_at: QUOTED_AT });
}

test("HOGSWAP swap service quotes ALGO→USDC without subtracting the router fee twice", async () => {
  setHogswapSwapServiceDependenciesForTests({
    now: () => QUOTED_AT,
    quoteSwap: async () => {
      const quote = parsedQuote(hogswapAlgoUsdcQuotePayload);
      quote.quotedAtMs = QUOTED_AT;
      return quote;
    }
  });

  const service = createHogswapSwapService();
  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
    amount: "1000000",
    type: "fixed-input"
  });

  assert.equal(quote.router, "hogswap");
  assert.equal(quote.fromAssetId, "0");
  assert.equal(quote.toAssetId, String(HOGSWAP_FIXTURE_USDC_ASSET_ID));
  assert.equal(quote.quotedAmount, "94738");
  assert.equal(quote.minOutAtSlippage, "94169");
  assert.equal(quote.routerFeeBpsEffective, 5);
  assert.equal(quote.routerFeeAmount, "47");
  assert.equal(quote.legs.length, 2);
  assert.equal(Number(quote.quotedAmount), 94_738);
  assert.ok(Number(quote.quotedAmount) > Number(quote.minOutAtSlippage));
});

test("HOGSWAP swap service quotes GOLD→USDC (ASA→ASA) and builds an unsigned group", async () => {
  const { execute } = buildUnsignedSwapGroup({
    sender: ADDRESS,
    assetIndex: HOGSWAP_FIXTURE_GOLD_ASSET_ID,
    amount: 1_000_000n
  });
  setHogswapSwapServiceDependenciesForTests({
    now: () => QUOTED_AT,
    quoteSwap: async (request) => {
      assert.equal(request.assetIn, HOGSWAP_FIXTURE_GOLD_ASSET_ID);
      assert.equal(request.assetOut, HOGSWAP_FIXTURE_USDC_ASSET_ID);
      const quote = parsedQuote(hogswapGoldUsdcQuotePayload);
      quote.quotedAtMs = QUOTED_AT;
      return quote;
    },
    executeQuote: async (quoteId, userAddress) => {
      assert.equal(quoteId, "q-gold-usdc-fixture");
      assert.equal(userAddress, ADDRESS);
      return { ...execute, quoteId };
    }
  });

  const service = createHogswapSwapService();
  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: HOGSWAP_FIXTURE_GOLD_ASSET_ID,
    toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
    amount: 1_000_000
  });
  const group = await service.buildSwapTransactions(ADDRESS, quote);

  assert.equal(group.router, "hogswap");
  assert.equal(group.signed, false);
  assert.equal(group.submitted, false);
  assert.equal(group.routerAppId, HOGSWAP_FIXTURE_ROUTER_APP_ID);
  assert.equal(group.transactions.length, 2);
  assert.deepEqual(group.userSignIndexes, [0, 1]);
  assert.ok(group.transactions.every((txn) => txn.signer === "user"));
  for (const member of group.transactions) {
    const txn = algosdk.decodeUnsignedTransaction(Buffer.from(member.encodedTransaction, "base64"));
    assert.equal(txn.sender.toString(), ADDRESS);
  }
});

test("HOGSWAP swap service maps quote 404 to no-route and execute 404 to expired", async () => {
  setHogswapSwapServiceDependenciesForTests({
    now: () => QUOTED_AT,
    quoteSwap: async () => {
      throw new HogswapNoRouteError("HOGSWAP /quote returned HTTP 404: no route", 404);
    }
  });
  const service = createHogswapSwapService();
  await assert.rejects(
    service.getQuote({
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      amount: "1000000"
    }),
    (error: unknown) =>
      error instanceof HogswapRouterError && error.kind === "no-route"
  );

  const quote = await (async () => {
    setHogswapSwapServiceDependenciesForTests({
      now: () => QUOTED_AT,
      quoteSwap: async () => {
        const parsed = parsedQuote(hogswapAlgoUsdcQuotePayload);
        parsed.quotedAtMs = QUOTED_AT;
        return parsed;
      },
      executeQuote: async () => {
        throw new HogswapQuoteExpiredError("HOGSWAP /execute returned HTTP 404", 404);
      }
    });
    return createHogswapSwapService().getQuote({
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      amount: "1000000"
    });
  })();

  await assert.rejects(
    createHogswapSwapService().buildSwapTransactions(ADDRESS, quote),
    (error: unknown) => error instanceof HogswapRouterError && error.kind === "expired"
  );
});

test("HOGSWAP swap service maps quote timeout to upstream", async () => {
  setHogswapSwapServiceDependenciesForTests({
    now: () => QUOTED_AT,
    quoteSwap: async () => {
      throw new HogswapClientError("HOGSWAP /quote timed out after 8000ms.");
    }
  });
  await assert.rejects(
    createHogswapSwapService().getQuote({
      address: ADDRESS,
      fromAssetId: 0,
      toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
      amount: "1000000"
    }),
    (error: unknown) =>
      error instanceof HogswapRouterError &&
      error.kind === "upstream" &&
      /timed out/.test(error.message)
  );
});

test("HOGSWAP swap service rejects stale and address-mismatched quotes before execute", async () => {
  setHogswapSwapServiceDependenciesForTests({
    now: () => QUOTED_AT,
    quoteSwap: async () => {
      const parsed = parsedQuote(hogswapAlgoUsdcQuotePayload);
      parsed.quotedAtMs = QUOTED_AT;
      return parsed;
    },
    executeQuote: async () => {
      throw new Error("execute must not run");
    }
  });
  const service = createHogswapSwapService();
  const quote = await service.getQuote({
    address: ADDRESS,
    fromAssetId: 0,
    toAssetId: HOGSWAP_FIXTURE_USDC_ASSET_ID,
    amount: "1000000"
  });

  await assert.rejects(
    service.buildSwapTransactions(OTHER_ADDRESS, quote),
    /different Algorand address/ // pragma: allowlist secret
  );

  setHogswapSwapServiceDependenciesForTests({
    now: () => QUOTED_AT + 31_000,
    executeQuote: async () => {
      throw new Error("execute must not run for a stale quote");
    }
  });
  await assert.rejects(
    createHogswapSwapService().buildSwapTransactions(ADDRESS, quote),
    (error: unknown) => error instanceof HogswapRouterError && error.kind === "expired"
  );
});
