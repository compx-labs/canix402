import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { SignerTransaction, V2PoolInfo } from "@tinymanorg/tinyman-js-sdk";

import { buildApp } from "../../src/app.js";
import {
  setTinymanFlexibleAddLiquidityDependenciesForTests,
  setTinymanRemoveLiquidityDependenciesForTests,
  tinymanAddLiquidityFlexibleShape,
  tinymanRemoveLiquidityMultipleAssetsOutShape
} from "../../src/execution/shapes/tinyman/index.js";
import type { TinymanV2PoolState } from "../../src/execution/shapes/tinyman/pool-state.js";

const USER = algosdk.generateAccount();
const POOL = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const POOL_ADDRESS = POOL.addr.toString();
const VALIDATOR_APP_ID = 1002541853;
const USDC_ID = 31566704;
const ALGO_ID = 0;
const POOL_TOKEN_ID = 900001;
const GENESIS_HASH = new Uint8Array(32).fill(9);

function suggestedParams(fee: number): algosdk.SuggestedParams {
  return {
    fee: BigInt(fee),
    minFee: 1000n,
    firstValid: 1000n,
    lastValid: 2000n,
    genesisID: "mainnet-v1.0",
    genesisHash: GENESIS_HASH,
    flatFee: true
  };
}

function buildFlexibleGroup(): algosdk.Transaction[] {
  const asset1Txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 1_000_000n,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(1000)
  });
  const asset2Txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 2_000_000n,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("add_liquidity"),
      new TextEncoder().encode("flexible"),
      algosdk.encodeUint64(1_407_142n)
    ],
    foreignAssets: [POOL_TOKEN_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(3000)
  });
  const group = [asset1Txn, asset2Txn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildRemoveLiquidityGroup(): algosdk.Transaction[] {
  const poolTokenTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 500_000n,
    assetIndex: POOL_TOKEN_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("remove_liquidity"),
      algosdk.encodeUint64(248_750n),
      algosdk.encodeUint64(497_500n)
    ],
    foreignAssets: [USDC_ID, ALGO_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(3000)
  });
  const group = [poolTokenTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function poolState(): TinymanV2PoolState {
  return {
    network: "mainnet",
    validatorAppId: VALIDATOR_APP_ID,
    poolAddress: POOL_ADDRESS,
    poolTokenId: POOL_TOKEN_ID,
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Decimals: 6,
    asset2Decimals: 6,
    poolInfo: {} as unknown as V2PoolInfo
  };
}

function installTinymanMocks(): void {
  setTinymanFlexibleAddLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getFlexibleQuote: () => ({
      asset1In: { id: USDC_ID, amount: 1_000_000n },
      asset2In: { id: ALGO_ID, amount: 2_000_000n },
      poolTokenOut: { id: POOL_TOKEN_ID, amount: 1_414_213n },
      share: 0.01,
      slippage: 0.005,
      internalSwapQuote: {
        assetIn: { id: USDC_ID, amount: 0n, decimals: 6 },
        assetOut: { id: ALGO_ID, amount: 0n, decimals: 6 },
        swapFees: 0n,
        priceImpact: 0
      },
      minPoolTokenAssetAmountWithSlippage: 1_407_142n
    }),
    generateFlexibleTxns: async (): Promise<SignerTransaction[]> =>
      buildFlexibleGroup().map((txn) => ({ txn }))
  });
}

function installRemoveLiquidityMocks(): void {
  setTinymanRemoveLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    resolvePoolReserves: async () => ({
      asset1: 10_000_000_000n,
      asset2: 20_000_000_000n,
      issuedLiquidity: 1_000_000_000n,
      round: 50_000_000n
    }),
    getRemoveLiquidityQuote: () => ({
      round: 50_000_000,
      asset1Out: { assetId: USDC_ID, amount: 250_000n },
      asset2Out: { assetId: ALGO_ID, amount: 500_000n },
      poolTokenIn: { assetId: POOL_TOKEN_ID, amount: 500_000n }
    }),
    generateRemoveLiquidityTxns: async (): Promise<SignerTransaction[]> =>
      buildRemoveLiquidityGroup().map((txn) => ({ txn }))
  });
}

const quoteRequestBody = {
  shapeKey: tinymanAddLiquidityFlexibleShape.key,
  input: {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetAAmount: "1000000",
    assetBId: ALGO_ID,
    assetBAmount: "2000000",
    maxSlippageBps: 50
  }
};

const removeQuoteRequestBody = {
  shapeKey: tinymanRemoveLiquidityMultipleAssetsOutShape.key,
  input: {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetBId: ALGO_ID,
    poolTokenAmount: "500000",
    maxSlippageBps: 50
  }
};

test.afterEach(() => {
  setTinymanFlexibleAddLiquidityDependenciesForTests(undefined);
  setTinymanRemoveLiquidityDependenciesForTests(undefined);
});

test("POST /execution/quotes returns unsigned executable quote", async () => {
  installTinymanMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: quoteRequestBody
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      shapeKey: string;
      encodedTransactions: string[];
      transactions: Array<{ type: string }>;
      expiresAt: string;
    };
    meta: { paymentRequired: boolean; executionSubmitted: boolean };
  };

  assert.equal(body.data.shapeKey, tinymanAddLiquidityFlexibleShape.key);
  assert.equal(body.data.encodedTransactions.length, 3);
  assert.equal(body.data.transactions.length, 3);
  assert.deepEqual(
    body.data.transactions.map((txn) => txn.type),
    ["axfer", "pay", "appl"]
  );
  assert.equal(body.meta.paymentRequired, true);
  assert.equal(body.meta.executionSubmitted, false);
  assert.ok(new Date(body.data.expiresAt).getTime() > Date.now() - 60_000);

  await app.close();
});

test("POST /execution/quotes returns remove-liquidity executable quote", async () => {
  installRemoveLiquidityMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: removeQuoteRequestBody
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      shapeKey: string;
      encodedTransactions: string[];
      transactions: Array<{ type: string }>;
    };
  };

  assert.equal(body.data.shapeKey, tinymanRemoveLiquidityMultipleAssetsOutShape.key);
  assert.equal(body.data.encodedTransactions.length, 2);
  assert.equal(body.data.transactions.length, 2);
  assert.deepEqual(
    body.data.transactions.map((txn) => txn.type),
    ["axfer", "appl"]
  );

  await app.close();
});

test("POST /execution/quotes returns 400 when remove-liquidity poolTokenAmount is missing", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: tinymanRemoveLiquidityMultipleAssetsOutShape.key,
      input: {
        userAddress: USER_ADDRESS,
        assetAId: USDC_ID,
        assetBId: ALGO_ID,
        maxSlippageBps: 50
      }
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");

  await app.close();
});

test("POST /execution/quotes returns 404 for unknown shape key", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: "mainnet:tinyman:v2:addLiquidity:initial",
      input: quoteRequestBody.input
    }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "NOT_FOUND");

  await app.close();
});

test("POST /execution/quotes returns 400 for invalid input", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: tinymanAddLiquidityFlexibleShape.key,
      input: {
        ...quoteRequestBody.input,
        maxSlippageBps: 20_000
      }
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");

  await app.close();
});
