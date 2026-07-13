import assert from "node:assert/strict";
import test from "node:test";

import {
  accountFromMnemonic,
  computeBalancedPactAddAmounts,
  createAlgodClientFromEnv,
  ensureAssetOptIn,
  getAssetBalance,
  resolvePactAlgoUsdcPool,
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

const TWO_SIDED_ADD_SHAPE = "mainnet:pact:v1:addLiquidity:twoSided";
const PROPORTIONAL_REMOVE_SHAPE = "mainnet:pact:v1:removeLiquidity:proportional";

const ADD_USDC_MICRO_AMOUNT = 100_000n;
const MAX_SLIPPAGE_BPS = 50;

type ExecutionScenario = "add" | "remove" | "roundtrip";

const VALID_SCENARIOS: readonly ExecutionScenario[] = ["add", "remove", "roundtrip"];

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_PACT_EXECUTION_LIVE === "1";
}

function selectedScenario(): ExecutionScenario {
  const raw = process.env.X402_PACT_EXECUTION_SCENARIO ?? "roundtrip";
  if ((VALID_SCENARIOS as readonly string[]).includes(raw)) {
    return raw as ExecutionScenario;
  }
  throw new Error(
    `Invalid X402_PACT_EXECUTION_SCENARIO "${raw}". Expected one of: ${VALID_SCENARIOS.join(", ")}.`
  );
}

function skipUnlessLive(t: test.TestContext): boolean {
  if (!isExecutionLiveEnabled()) {
    t.skip("Set X402_PACT_EXECUTION_LIVE=1 to run Pact production liquidity tests.");
    return true;
  }
  return false;
}

function skipUnlessScenario(t: test.TestContext, scenario: ExecutionScenario): boolean {
  if (selectedScenario() !== scenario) {
    t.skip(`Skipping because X402_PACT_EXECUTION_SCENARIO=${selectedScenario()}.`);
    return true;
  }
  return false;
}

function serializeAmount(value: bigint): string {
  return value.toString();
}

function resolveRemovePoolTokenAmount(balance: bigint): bigint {
  const configured = process.env.X402_PACT_REMOVE_POOL_TOKEN_AMOUNT?.trim();
  if (configured === undefined || configured.length === 0) {
    return balance;
  }

  const amount = BigInt(configured);
  if (amount <= 0n) {
    throw new Error("X402_PACT_REMOVE_POOL_TOKEN_AMOUNT must be a positive integer.");
  }
  if (amount > balance) {
    throw new Error(
      `X402_PACT_REMOVE_POOL_TOKEN_AMOUNT (${amount}) exceeds wallet LP balance (${balance}).`
    );
  }
  return amount;
}

async function runTwoSidedAddLiquidity(): Promise<{
  poolAppId: number;
  poolTokenId: number;
  lpBalanceAfter: bigint;
}> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:pact-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();

  const pool = await resolvePactAlgoUsdcPool(algod);
  await ensureAssetOptIn(account, algod, pool.poolTokenId);

  const amounts = await computeBalancedPactAddAmounts(algod, ADD_USDC_MICRO_AMOUNT);
  const lpBalanceBefore = await getAssetBalance(algod, userAddress, pool.poolTokenId);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: TWO_SIDED_ADD_SHAPE,
    input: {
      userAddress,
      poolAppId: pool.poolAppId,
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
  assert.equal(quoteResponse.data.shapeKey, TWO_SIDED_ADD_SHAPE);
  assert.equal(quoteResponse.data.encodedTransactions.length, 3);
  assert.equal(quoteResponse.data.transactions[2]?.applicationCall?.appArgsText[0], "ADDLIQ");

  const signed = signEncodedTransactionGroup(
    quoteResponse.data.encodedTransactions,
    account.sk
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);

  const lpBalanceAfter = await getAssetBalance(algod, userAddress, pool.poolTokenId);
  assert.ok(
    lpBalanceAfter > lpBalanceBefore,
    `Expected LP balance to increase after Pact add (before=${lpBalanceBefore}, after=${lpBalanceAfter}).`
  );

  return {
    poolAppId: pool.poolAppId,
    poolTokenId: pool.poolTokenId,
    lpBalanceAfter
  };
}

async function runProportionalRemoveLiquidity(params: {
  poolAppId: number;
  poolTokenId: number;
  poolTokenAmount?: bigint;
}): Promise<void> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:pact-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();

  const lpBalance = await getAssetBalance(algod, userAddress, params.poolTokenId);
  if (lpBalance <= 0n) {
    throw new Error("Wallet has no Pact LP tokens. Run add or roundtrip scenario first.");
  }

  const removeAmount = params.poolTokenAmount ?? resolveRemovePoolTokenAmount(lpBalance);
  assert.ok(removeAmount > 0n);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: PROPORTIONAL_REMOVE_SHAPE,
    input: {
      userAddress,
      poolAppId: params.poolAppId,
      poolTokenAmount: serializeAmount(removeAmount)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.meta.paymentRequired, true);
  assert.equal(quoteResponse.meta.executionSubmitted, false);
  assert.equal(quoteResponse.data.shapeKey, PROPORTIONAL_REMOVE_SHAPE);
  assert.equal(quoteResponse.data.encodedTransactions.length, 2);
  assert.equal(quoteResponse.data.transactions[1]?.applicationCall?.appArgsText[0], "REMLIQ");
  assert.ok(
    quoteResponse.data.warnings.some((warning) => warning.includes("REMLIQ minimum asset outputs"))
  );

  const signed = signEncodedTransactionGroup(
    quoteResponse.data.encodedTransactions,
    account.sk
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);

  const lpBalanceAfter = await getAssetBalance(algod, userAddress, params.poolTokenId);
  assert.ok(
    lpBalanceAfter < lpBalance,
    `Expected LP balance to decrease after Pact remove (before=${lpBalance}, after=${lpBalanceAfter}).`
  );
}

test("two-sided add liquidity via production x402 execution quote", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "add")) {
    return;
  }

  const result = await runTwoSidedAddLiquidity();
  assert.ok(result.lpBalanceAfter > 0n);
  assert.equal(result.poolAppId > 0, true);
});

test("proportional remove liquidity via production x402 execution quote", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "remove")) {
    return;
  }

  const algod = createAlgodClientFromEnv();
  const clientMnemonic = requireClientMnemonic("npm run test:pact-production");
  const userAddress = accountFromMnemonic(clientMnemonic).addr.toString();
  const pool = await resolvePactAlgoUsdcPool(algod);
  const lpBalance = await getAssetBalance(algod, userAddress, pool.poolTokenId);

  if (lpBalance <= 0n) {
    t.skip("Wallet has no LP tokens. Run add or roundtrip scenario first.");
    return;
  }

  await runProportionalRemoveLiquidity({
    poolAppId: pool.poolAppId,
    poolTokenId: pool.poolTokenId
  });
});

test("roundtrip add then remove via production x402 execution quotes", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "roundtrip")) {
    return;
  }

  const addResult = await runTwoSidedAddLiquidity();
  await runProportionalRemoveLiquidity({
    poolAppId: addResult.poolAppId,
    poolTokenId: addResult.poolTokenId,
    poolTokenAmount: addResult.lpBalanceAfter
  });
});
