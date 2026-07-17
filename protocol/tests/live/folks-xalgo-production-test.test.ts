import assert from "node:assert/strict";
import test from "node:test";

import { MainnetConsensusConfig } from "@folks-finance/algorand-sdk";

import {
  accountFromMnemonic,
  createAlgodClientFromEnv,
  ensureAssetOptIn,
  getAssetBalance,
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

const STAKE_SHAPE = "mainnet:folks-finance:xalgo-v1:stake:immediate";
const UNSTAKE_SHAPE = "mainnet:folks-finance:xalgo-v1:unstake:immediate";
const XALGO_ASSET_ID = MainnetConsensusConfig.xAlgoId;

type ExecutionScenario = "stake" | "unstake" | "roundtrip";

const VALID_SCENARIOS: readonly ExecutionScenario[] = ["stake", "unstake", "roundtrip"];

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_FOLKS_XALGO_LIVE === "1";
}

function selectedScenario(): ExecutionScenario {
  const raw = process.env.X402_FOLKS_XALGO_SCENARIO ?? "roundtrip";
  if ((VALID_SCENARIOS as readonly string[]).includes(raw)) {
    return raw as ExecutionScenario;
  }
  throw new Error(
    `Invalid X402_FOLKS_XALGO_SCENARIO "${raw}". Expected one of: ${VALID_SCENARIOS.join(", ")}.`
  );
}

function skipUnlessLive(t: test.TestContext): boolean {
  if (!isExecutionLiveEnabled()) {
    t.skip("Set X402_FOLKS_XALGO_LIVE=1 to run Folks xALGO production tests.");
    return true;
  }
  return false;
}

function skipUnlessScenario(t: test.TestContext, scenario: ExecutionScenario): boolean {
  if (selectedScenario() !== scenario) {
    t.skip(`Skipping because X402_FOLKS_XALGO_SCENARIO=${selectedScenario()}.`);
    return true;
  }
  return false;
}

function resolveStakeAmount(): bigint {
  const configured = process.env.X402_FOLKS_XALGO_STAKE_AMOUNT?.trim();
  if (configured === undefined || configured.length === 0) {
    return 1_000_000n;
  }
  const amount = BigInt(configured);
  if (amount <= 0n) {
    throw new Error("X402_FOLKS_XALGO_STAKE_AMOUNT must be a positive integer.");
  }
  return amount;
}

function serializeAmount(value: bigint): string {
  return value.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("Folks xALGO stake immediate on production", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "stake")) {
    return;
  }

  const env = getLiveEnv();
  const mnemonic = requireClientMnemonic(env);
  const account = accountFromMnemonic(mnemonic);
  const algod = createAlgodClientFromEnv();
  const stakeAmount = resolveStakeAmount();

  await ensureAssetOptIn(algod, account, XALGO_ASSET_ID);

  const xAlgoBefore = await getAssetBalance(algod, account.addr.toString(), XALGO_ASSET_ID);
  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl: getProductionBaseUrl(),
    shapeKey: STAKE_SHAPE,
    input: {
      userAddress: account.addr.toString(),
      amount: serializeAmount(stakeAmount)
    }
  });
  const quote = quoteResponse.data[0]!;

  assert.equal(quote.shapeKey, STAKE_SHAPE);
  assert.ok(quote.encodedTransactions.length >= 3);

  const signed = signEncodedTransactionGroup(quote.encodedTransactions, account.sk);
  await submitTransactionGroup(algod, signed);
  await sleep(3_000);

  const xAlgoAfter = await getAssetBalance(algod, account.addr.toString(), XALGO_ASSET_ID);
  assert.ok(
    xAlgoAfter > xAlgoBefore,
    `Expected xALGO balance to increase after stake (before=${xAlgoBefore}, after=${xAlgoAfter}).`
  );
});

test("Folks xALGO unstake immediate on production", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "unstake")) {
    return;
  }

  const env = getLiveEnv();
  const mnemonic = requireClientMnemonic(env);
  const account = accountFromMnemonic(mnemonic);
  const algod = createAlgodClientFromEnv();

  const configured = process.env.X402_FOLKS_XALGO_UNSTAKE_AMOUNT?.trim();
  const unstakeAmount =
    configured !== undefined && configured.length > 0
      ? BigInt(configured)
      : await getAssetBalance(algod, account.addr.toString(), XALGO_ASSET_ID);

  assert.ok(unstakeAmount > 0n, "No xALGO balance available to unstake.");

  const algoBefore = await getAssetBalance(algod, account.addr.toString(), 0);
  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl: getProductionBaseUrl(),
    shapeKey: UNSTAKE_SHAPE,
    input: {
      userAddress: account.addr.toString(),
      amount: serializeAmount(unstakeAmount)
    }
  });
  const quote = quoteResponse.data[0]!;

  assert.equal(quote.shapeKey, UNSTAKE_SHAPE);
  const signed = signEncodedTransactionGroup(quote.encodedTransactions, account.sk);
  await submitTransactionGroup(algod, signed);
  await sleep(3_000);

  const algoAfter = await getAssetBalance(algod, account.addr.toString(), 0);
  assert.ok(
    algoAfter > algoBefore - 100_000n,
    `Expected ALGO balance to recover after unstake (before=${algoBefore}, after=${algoAfter}).`
  );
});

test("Folks xALGO stake then unstake roundtrip on production", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "roundtrip")) {
    return;
  }

  const env = getLiveEnv();
  const mnemonic = requireClientMnemonic(env);
  const account = accountFromMnemonic(mnemonic);
  const algod = createAlgodClientFromEnv();
  const stakeAmount = resolveStakeAmount();

  await ensureAssetOptIn(algod, account, XALGO_ASSET_ID);

  const xAlgoBefore = await getAssetBalance(algod, account.addr.toString(), XALGO_ASSET_ID);
  const stakeQuoteResponse = await fetchPaidExecutionQuote({
    baseUrl: getProductionBaseUrl(),
    shapeKey: STAKE_SHAPE,
    input: {
      userAddress: account.addr.toString(),
      amount: serializeAmount(stakeAmount)
    }
  });
  await submitTransactionGroup(
    algod,
    signEncodedTransactionGroup(stakeQuoteResponse.data[0]!.encodedTransactions, account.sk)
  );
  await sleep(3_000);

  const xAlgoAfterStake = await getAssetBalance(algod, account.addr.toString(), XALGO_ASSET_ID);
  const minted = xAlgoAfterStake - xAlgoBefore;
  assert.ok(minted > 0n, `Expected positive xALGO mint (minted=${minted}).`);

  const unstakeQuoteResponse = await fetchPaidExecutionQuote({
    baseUrl: getProductionBaseUrl(),
    shapeKey: UNSTAKE_SHAPE,
    input: {
      userAddress: account.addr.toString(),
      amount: serializeAmount(minted)
    }
  });
  await submitTransactionGroup(
    algod,
    signEncodedTransactionGroup(unstakeQuoteResponse.data[0]!.encodedTransactions, account.sk)
  );
  await sleep(3_000);

  const xAlgoAfterUnstake = await getAssetBalance(algod, account.addr.toString(), XALGO_ASSET_ID);
  assert.equal(
    xAlgoAfterUnstake,
    xAlgoBefore,
    `Expected xALGO balance to return to pre-stake level (before=${xAlgoBefore}, after=${xAlgoAfterUnstake}).`
  );
});
