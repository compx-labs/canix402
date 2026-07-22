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
    depositIndex: 10n ** 18n,
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

function decodedMarket() {
  return {
    paused: false,
    maxTotalDeposits: 0n,
    maxTotalBorrows: 0n,
    liquidationBonus: 0n,
    collateralFactor: 0n,
    liquidationThreshold: 0n,
    reserveFactor: 0n,
    borrowRate: 0n,
    slope: 0n,
    totalScaledDeposits: 0n,
    totalScaledBorrows: 0n,
    depositIndex: 0n,
    borrowIndex: 0n,
    lastUpdateTime: 0n,
    reserves: 0n,
    price: 0n,
    nTokenAppId: BigInt(NTOKEN_APP_ID),
    closeFactor: 0n
  };
}

function cloneWithoutGroup(txn: algosdk.Transaction): algosdk.Transaction {
  const clone = algosdk.decodeUnsignedTransaction(algosdk.encodeUnsignedTransaction(txn));
  delete clone.group;
  return clone;
}

function buildStaleGroupedTransactions(transactions: algosdk.Transaction[]): algosdk.Transaction[] {
  const stale = transactions.map((txn) =>
    algosdk.decodeUnsignedTransaction(algosdk.encodeUnsignedTransaction(txn))
  );
  algosdk.assignGroupID(stale);
  stale[0]!.fee = BigInt(stale[0]!.fee) + 1n;
  return stale;
}

function buildPaddingPayments(count: number): algosdk.Transaction[] {
  return Array.from({ length: count }, () =>
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: USER.addr,
      receiver: USER.addr,
      amount: 0n,
      suggestedParams: suggestedParams(1_000)
    })
  );
}

function assertEncodedTransactionsHaveCanonicalGroup(encodedTransactions: readonly string[]): void {
  const transactions = encodedTransactions.map((encoded) =>
    algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"))
  );
  assert.ok(transactions.length > 0);

  const embeddedGroups = transactions.map((txn) =>
    txn.group === undefined ? "" : Buffer.from(txn.group).toString("base64")
  );
  assert.equal(new Set(embeddedGroups).size, 1);
  assert.notEqual(embeddedGroups[0], "");

  const canonicalTransactions = transactions.map((txn) => cloneWithoutGroup(txn));
  algosdk.assignGroupID(canonicalTransactions);
  const canonicalGroup = Buffer.from(canonicalTransactions[0]!.group!).toString("base64");
  assert.equal(embeddedGroups[0], canonicalGroup);
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

test("deposit shape clears stale builder group ids before encoding quote", async () => {
  const state = lendingMarketState();
  const amount = 100_000n;
  const staleGroup = buildStaleGroupedTransactions(
    buildMockDorkFiDepositGroup({
      user: USER,
      poolAppId: POOL_APP_ID,
      marketAppId: MARKET_APP_ID,
      assetId: USDC_ID,
      amount,
      suggestedParams: suggestedParams(20_000)
    })
  );

  setDorkFiDepositAsaDependenciesForTests({
    resolveMarketState: async () => state,
    buildDepositTransactions: async () => staleGroup
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

  assertEncodedTransactionsHaveCanonicalGroup(quote.encodedTransactions);
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

test("withdraw shape clears stale builder group ids before encoding quote", async () => {
  const state = lendingMarketState();
  const amount = 50_000n;
  const staleGroup = buildStaleGroupedTransactions(
    [
      ...buildMockDorkFiWithdrawGroup({
        user: USER,
        poolAppId: POOL_APP_ID,
        marketAppId: MARKET_APP_ID,
        assetId: USDC_ID,
        nTokenAmount: amount,
        suggestedParams: suggestedParams(20_000)
      }),
      ...buildPaddingPayments(7)
    ]
  );

  setDorkFiWithdrawAsaDependenciesForTests({
    resolveMarketState: async () => state,
    buildWithdrawTransactions: async () => staleGroup,
    simulateWithdrawUnderlyingAmount: async () => 49_000n
  });

  const registry = new TransactionShapeRegistry();
  registry.register(dorkfiWithdrawAsaShape);
  const quote = await compileExecutableQuote(
    registry,
    dorkfiWithdrawAsaShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      marketAppId: MARKET_APP_ID,
      assetId: USDC_ID,
      amount: amount.toString()
    },
    buildContext()
  );

  assertEncodedTransactionsHaveCanonicalGroup(quote.encodedTransactions);
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

test("resolveState reads user nToken balance from nToken app id", async () => {
  let balanceContractAppId = 0;
  setDorkFiLendingMarketStateDependenciesForTests({
    simulateGetMarket: async () => decodedMarket(),
    getAccountAssetBalance: async () => 5_000_000n,
    getArc200Balance: async ({ contractAppId }) => {
      balanceContractAppId = contractAppId;
      return 50_000n;
    },
    isAssetOptedIn: async () => true
  });

  const state = await dorkfiWithdrawAsaShape.resolveState(buildContext(), {
    userAddress: USER_ADDRESS,
    poolAppId: POOL_APP_ID,
    marketAppId: MARKET_APP_ID,
    assetId: USDC_ID,
    amount: 1000n
  });

  assert.equal(balanceContractAppId, NTOKEN_APP_ID);
  assert.equal(state.userNTokenBalance, 50_000n);
});

test("createExecutionRegistry includes all Dork.fi shapes", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:dorkfi:v1:deposit:asa"), true);
  assert.equal(registry.has("mainnet:dorkfi:v1:withdraw:asa"), true);
});
