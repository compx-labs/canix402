import assert from "node:assert/strict";
import test from "node:test";

import {
  USDC_ASSET_ID,
  accountFromMnemonic,
  computeBalancedAddAmounts,
  createAlgodClientFromEnv,
  ensureAssetOptIn,
  getAssetBalance,
  resolveTinymanAlgoUsdcPool,
  signEncodedTransactionGroup,
  submitTransactionGroup
} from "../helpers/algorandExecution.js";
import {
  fetchPaidExecutionQuote,
  getLiveEnv,
  getProductionBaseUrl,
  loadLiveEnvFiles,
  requireClientMnemonic
} from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

const ADD_LIQUIDITY_SHAPE = "mainnet:tinyman:v2:addLiquidity:flexible";
const REMOVE_LIQUIDITY_SHAPE = "mainnet:tinyman:v2:removeLiquidity:multipleAssetsOut";
const ADD_USDC_MICRO_AMOUNT = 100_000n;
const MAX_SLIPPAGE_BPS = 50;

type ExecutionScenario = "add" | "remove" | "roundtrip";

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_TINYMAN_EXECUTION_LIVE === "1";
}

function selectedScenario(): ExecutionScenario {
  const raw = process.env.X402_TINYMAN_EXECUTION_SCENARIO ?? "roundtrip";
  if (raw === "add" || raw === "remove" || raw === "roundtrip") {
    return raw;
  }
  throw new Error(
    `Invalid X402_TINYMAN_EXECUTION_SCENARIO "${raw}". Expected add, remove, or roundtrip.`
  );
}

function skipUnlessLive(t: test.TestContext): boolean {
  if (!isExecutionLiveEnabled()) {
    t.skip("Set X402_TINYMAN_EXECUTION_LIVE=1 to run Tinyman execution live tests.");
    return true;
  }
  return false;
}

function skipUnlessScenario(t: test.TestContext, scenario: ExecutionScenario): boolean {
  if (selectedScenario() !== scenario) {
    t.skip(`Skipping because X402_TINYMAN_EXECUTION_SCENARIO=${selectedScenario()}.`);
    return true;
  }
  return false;
}

function serializeAmount(value: bigint): string {
  return value.toString();
}

function resolveRemovePoolTokenAmount(balance: bigint): bigint {
  const configured = process.env.X402_TINYMAN_REMOVE_POOL_TOKEN_AMOUNT?.trim();
  if (configured === undefined || configured.length === 0) {
    return balance;
  }

  const amount = BigInt(configured);
  if (amount <= 0n) {
    throw new Error("X402_TINYMAN_REMOVE_POOL_TOKEN_AMOUNT must be a positive integer.");
  }
  if (amount > balance) {
    throw new Error(
      `X402_TINYMAN_REMOVE_POOL_TOKEN_AMOUNT (${amount}) exceeds wallet LP balance (${balance}).`
    );
  }
  return amount;
}

async function runAddLiquidity(): Promise<{
  poolTokenId: number;
  lpBalanceAfter: bigint;
}> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:tinyman-execution-live");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();

  const pool = await resolveTinymanAlgoUsdcPool(algod);
  await ensureAssetOptIn(account, algod, USDC_ASSET_ID);
  await ensureAssetOptIn(account, algod, pool.poolTokenId);

  const amounts = await computeBalancedAddAmounts(algod, ADD_USDC_MICRO_AMOUNT);
  const lpBalanceBefore = await getAssetBalance(algod, userAddress, pool.poolTokenId);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: ADD_LIQUIDITY_SHAPE,
    input: {
      userAddress,
      assetAId: amounts.assetAId,
      assetAAmount: serializeAmount(amounts.assetAAmount),
      assetBId: amounts.assetBId,
      assetBAmount: serializeAmount(amounts.assetBAmount),
      maxSlippageBps: MAX_SLIPPAGE_BPS
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.meta.paymentRequired, true);
  assert.equal(quoteResponse.meta.executionSubmitted, false);
  assert.equal(quoteResponse.data.shapeKey, ADD_LIQUIDITY_SHAPE);
  assert.equal(quoteResponse.data.encodedTransactions.length, 3);

  const signed = signEncodedTransactionGroup(
    quoteResponse.data.encodedTransactions,
    account.sk
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);

  const lpBalanceAfter = await getAssetBalance(algod, userAddress, pool.poolTokenId);
  assert.ok(
    lpBalanceAfter > lpBalanceBefore,
    `Expected LP balance to increase after add liquidity (before=${lpBalanceBefore}, after=${lpBalanceAfter}).`
  );

  return { poolTokenId: pool.poolTokenId, lpBalanceAfter };
}

async function runRemoveLiquidity(poolTokenAmount?: bigint): Promise<void> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:tinyman-execution-live");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();

  const pool = await resolveTinymanAlgoUsdcPool(algod);
  const lpBalance = await getAssetBalance(algod, userAddress, pool.poolTokenId);
  if (lpBalance <= 0n) {
    throw new Error(
      "Wallet has no Tinyman LP tokens. Run add or roundtrip scenario first."
    );
  }

  const removeAmount = poolTokenAmount ?? resolveRemovePoolTokenAmount(lpBalance);
  assert.ok(removeAmount > 0n);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: REMOVE_LIQUIDITY_SHAPE,
    input: {
      userAddress,
      assetAId: USDC_ASSET_ID,
      assetBId: 0,
      poolTokenAmount: serializeAmount(removeAmount),
      maxSlippageBps: MAX_SLIPPAGE_BPS
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.meta.paymentRequired, true);
  assert.equal(quoteResponse.meta.executionSubmitted, false);
  assert.equal(quoteResponse.data.shapeKey, REMOVE_LIQUIDITY_SHAPE);
  assert.equal(quoteResponse.data.encodedTransactions.length, 2);
  assert.equal(quoteResponse.data.transactions[1]?.applicationCall?.appArgsText[0], "remove_liquidity");

  const signed = signEncodedTransactionGroup(
    quoteResponse.data.encodedTransactions,
    account.sk
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);

  const lpBalanceAfter = await getAssetBalance(algod, userAddress, pool.poolTokenId);
  assert.ok(
    lpBalanceAfter < lpBalance,
    `Expected LP balance to decrease after remove liquidity (before=${lpBalance}, after=${lpBalanceAfter}).`
  );
}

test("add liquidity via production x402 execution quote", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "add")) {
    return;
  }

  const result = await runAddLiquidity();
  assert.ok(result.lpBalanceAfter > 0n);
  assert.equal(result.poolTokenId > 0, true);
});

test("remove liquidity via production x402 execution quote", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "remove")) {
    return;
  }

  const algod = createAlgodClientFromEnv();
  const clientMnemonic = requireClientMnemonic("npm run test:tinyman-execution-live");
  const userAddress = accountFromMnemonic(clientMnemonic).addr.toString();
  const pool = await resolveTinymanAlgoUsdcPool(algod);
  const lpBalance = await getAssetBalance(algod, userAddress, pool.poolTokenId);

  if (lpBalance <= 0n) {
    t.skip("Wallet has no LP tokens. Run add or roundtrip scenario first.");
    return;
  }

  await runRemoveLiquidity();
});

test("roundtrip add then remove via production x402 execution quotes", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "roundtrip")) {
    return;
  }

  const addResult = await runAddLiquidity();
  await runRemoveLiquidity(addResult.lpBalanceAfter);
});
