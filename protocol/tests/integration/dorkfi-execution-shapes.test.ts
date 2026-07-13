import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  InvalidShapeInputError,
  ShapeStateError,
  TransactionShapeRegistry,
  compileExecutableQuote,
  createExecutionRegistry,
  serializeTransaction
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  DORKFI_MAINNET_USDC_ASA_ID,
  DORKFI_MAINNET_USDC_MARKET_APP_ID,
  DORKFI_MAINNET_USDC_POOL_APP_ID,
  buildMockDorkFiDepositGroup,
  buildMockDorkFiWithdrawGroup,
  dorkfiDepositAsaShape,
  dorkfiWithdrawAsaShape,
  setDorkFiDepositAsaDependenciesForTests,
  setDorkFiLendingMarketStateDependenciesForTests,
  setDorkFiWithdrawAsaDependenciesForTests,
  type DorkFiLendingMarketState
} from "../../src/execution/shapes/dorkfi/index.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const POOL_APP_ID = DORKFI_MAINNET_USDC_POOL_APP_ID;
const MARKET_APP_ID = DORKFI_MAINNET_USDC_MARKET_APP_ID;
const USDC_ID = DORKFI_MAINNET_USDC_ASA_ID;
const NTOKEN_APP_ID = 3_333_764_003;
const GENESIS_HASH = new Uint8Array(32).fill(7);

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

function buildContext(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    now: () => Date.UTC(2026, 6, 13, 10, 30, 0),
    quoteTtlMs: 30_000
  };
}

function lendingMarketState(overrides?: Partial<DorkFiLendingMarketState>): DorkFiLendingMarketState {
  return {
    network: "mainnet",
    poolAppId: POOL_APP_ID,
    marketAppId: MARKET_APP_ID,
    assetId: USDC_ID,
    nTokenAppId: NTOKEN_APP_ID,
    poolAppAddress: algosdk.getApplicationAddress(POOL_APP_ID).toString(),
    decimals: 6,
    tokenStandard: "asa",
    symbol: "USDC",
    paused: false,
    userAssetBalance: 5_000_000n,
    userNTokenBalance: 1_000_000n,
    userOptedIntoAsset: true,
    catalogMarket: {
      symbol: "USDC",
      poolAppId: POOL_APP_ID,
      marketAppId: MARKET_APP_ID,
      nTokenAppId: NTOKEN_APP_ID,
      assetId: USDC_ID,
      decimals: 6,
      tokenStandard: "asa"
    },
    ...overrides
  };
}

test.afterEach(() => {
  setDorkFiLendingMarketStateDependenciesForTests(undefined);
  setDorkFiDepositAsaDependenciesForTests(undefined);
  setDorkFiWithdrawAsaDependenciesForTests(undefined);
});

test("deposit shape rejects missing poolAppId", () => {
  assert.throws(
    () =>
      dorkfiDepositAsaShape.parseInput({
        userAddress: USER_ADDRESS,
        marketAppId: MARKET_APP_ID,
        assetId: USDC_ID,
        amount: "1000"
      }),
    InvalidShapeInputError
  );
});

test("deposit shape rejects native ALGO assetId", () => {
  assert.throws(
    () =>
      dorkfiDepositAsaShape.parseInput({
        userAddress: USER_ADDRESS,
        poolAppId: POOL_APP_ID,
        marketAppId: MARKET_APP_ID,
        assetId: 0,
        amount: "1000"
      }),
    InvalidShapeInputError
  );
});

test("deposit shape builds and validates mocked group", async () => {
  const state = lendingMarketState();
  const amount = 100_000n;
  const group = buildMockDorkFiDepositGroup({
    user: USER,
    poolAppId: POOL_APP_ID,
    marketAppId: MARKET_APP_ID,
    assetId: USDC_ID,
    amount,
    suggestedParams: suggestedParams(20_000)
  });

  setDorkFiDepositAsaDependenciesForTests({
    resolveMarketState: async () => state,
    buildDepositTransactions: async () => group
  });

  const registry = new TransactionShapeRegistry();
  registry.register(dorkfiDepositAsaShape);
  const quote = await compileExecutableQuote(
    registry,
    dorkfiDepositAsaShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      marketAppId: MARKET_APP_ID,
      assetId: USDC_ID,
      amount: amount.toString()
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  const input = dorkfiDepositAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    poolAppId: POOL_APP_ID,
    marketAppId: MARKET_APP_ID,
    assetId: USDC_ID,
    amount: amount.toString()
  });
  const validation = dorkfiDepositAsaShape.validate(quote.transactions, input, state);
  assert.equal(validation.valid, true);
});

test("withdraw shape validates lending withdraw selector", () => {
  const state = lendingMarketState();
  const amount = 50_000n;
  const group = buildMockDorkFiWithdrawGroup({
    user: USER,
    poolAppId: POOL_APP_ID,
    marketAppId: MARKET_APP_ID,
    assetId: USDC_ID,
    nTokenAmount: amount,
    suggestedParams: suggestedParams(20_000)
  }).map((txn) => serializeTransaction(txn));

  const input = dorkfiWithdrawAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    poolAppId: POOL_APP_ID,
    marketAppId: MARKET_APP_ID,
    assetId: USDC_ID,
    amount: amount.toString()
  });
  assert.equal(dorkfiWithdrawAsaShape.validate(group, input, state).valid, true);
});

test("withdraw shape rejects ungrouped transactions", () => {
  const state = lendingMarketState();
  const group = buildMockDorkFiWithdrawGroup({
    user: USER,
    poolAppId: POOL_APP_ID,
    marketAppId: MARKET_APP_ID,
    assetId: USDC_ID,
    nTokenAmount: 1000n,
    suggestedParams: suggestedParams(20_000)
  }).map((txn) => serializeTransaction(txn));
  const ungrouped = group.map((txn) => ({ ...txn, groupPresent: false }));
  const input = dorkfiWithdrawAsaShape.parseInput({
    userAddress: USER_ADDRESS,
    poolAppId: POOL_APP_ID,
    marketAppId: MARKET_APP_ID,
    assetId: USDC_ID,
    amount: "1000"
  });
  const validation = dorkfiWithdrawAsaShape.validate(ungrouped, input, state);
  assert.equal(validation.valid, false);
});

test("resolveState rejects unknown market catalog entries", async () => {
  setDorkFiLendingMarketStateDependenciesForTests({
    findCatalogMarket: () => undefined
  });

  await assert.rejects(
    () =>
      dorkfiDepositAsaShape.resolveState(buildContext(), {
        userAddress: USER_ADDRESS,
        poolAppId: POOL_APP_ID,
        marketAppId: MARKET_APP_ID,
        assetId: USDC_ID,
        amount: 1000n
      }),
    ShapeStateError
  );
});

test("createExecutionRegistry includes all Dork.fi shapes", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:dorkfi:v1:deposit:asa"), true);
  assert.equal(registry.has("mainnet:dorkfi:v1:withdraw:asa"), true);
});
