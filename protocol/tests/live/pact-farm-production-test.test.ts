import assert from "node:assert/strict";
import test from "node:test";

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

const DEPLOY_SHAPE = "mainnet:pact:v1:farm:deployEscrow";
const STAKE_SHAPE = "mainnet:pact:v1:farm:stake";
const UNSTAKE_SHAPE = "mainnet:pact:v1:farm:unstake";
const CLAIM_SHAPE = "mainnet:pact:v1:farm:claimRewards";

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_PACT_FARM_EXECUTION_LIVE === "1";
}

function requireFarmAppId(): number {
  const raw = process.env.X402_PACT_FARM_APP_ID?.trim();
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Set X402_PACT_FARM_APP_ID to a mainnet Pact farm application id.");
  }
  return value;
}

function requireStakedAssetId(): number {
  const raw = process.env.X402_PACT_FARM_STAKED_ASSET_ID?.trim();
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      "Set X402_PACT_FARM_STAKED_ASSET_ID to the farm's staked LP asset id."
    );
  }
  return value;
}

function stakeAmount(): bigint {
  const raw = process.env.X402_PACT_FARM_STAKE_AMOUNT?.trim();
  if (raw === undefined || raw.length === 0) {
    return 1n;
  }
  const amount = BigInt(raw);
  if (amount <= 0n) {
    throw new Error("X402_PACT_FARM_STAKE_AMOUNT must be a positive integer.");
  }
  return amount;
}

function serializeAmount(value: bigint): string {
  return value.toString();
}

async function quoteAndSubmit(params: {
  shapeKey: string;
  input: Record<string, unknown>;
}): Promise<{ confirmedRound: bigint; metadata: Record<string, unknown> }> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:pact-farm-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: params.shapeKey,
    input: params.input,
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.meta.paymentRequired, true);
  assert.equal(quoteResponse.meta.executionSubmitted, false);
  assert.equal(quoteResponse.data[0].shapeKey, params.shapeKey);

  const signed = signEncodedTransactionGroup(
    quoteResponse.data[0].encodedTransactions,
    account.sk
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);
  return {
    confirmedRound: submission.confirmedRound,
    metadata: quoteResponse.data[0].metadata as Record<string, unknown>
  };
}

test("Pact farm production lifecycle: deploy (if needed) → stake → claim → unstake", async (t) => {
  if (!isExecutionLiveEnabled()) {
    t.skip("Set X402_PACT_FARM_EXECUTION_LIVE=1 to run Pact farm production tests.");
    return;
  }

  const farmAppId = requireFarmAppId();
  const stakedAssetId = requireStakedAssetId();
  const amount = stakeAmount();
  const clientMnemonic = requireClientMnemonic("npm run test:pact-farm-production");
  const account = accountFromMnemonic(clientMnemonic);
  const userAddress = account.addr.toString();
  const algod = createAlgodClientFromEnv();

  await ensureAssetOptIn(account, algod, stakedAssetId, { waitForConfirmation: false });

  const lpBefore = await getAssetBalance(algod, userAddress, stakedAssetId);
  if (lpBefore < amount) {
    t.skip(
      `Wallet LP balance ${lpBefore} is below stake amount ${amount}. Fund LP or lower X402_PACT_FARM_STAKE_AMOUNT.`
    );
    return;
  }

  // Deploy escrow when the wallet has no farm local state yet.
  try {
    await quoteAndSubmit({
      shapeKey: DEPLOY_SHAPE,
      input: { userAddress, farmAppId }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already has a Pact farm escrow/i.test(message)) {
      // Quote path may return 400 JSON; accept either already-deployed or continue if stake works.
      if (!/400|escrow/i.test(message)) {
        throw error;
      }
    }
  }

  const stakeResult = await quoteAndSubmit({
    shapeKey: STAKE_SHAPE,
    input: {
      userAddress,
      farmAppId,
      amount: serializeAmount(amount)
    }
  });
  assert.ok(stakeResult.confirmedRound > 0n);

  const lpAfterStake = await getAssetBalance(algod, userAddress, stakedAssetId);
  assert.ok(
    lpAfterStake <= lpBefore - amount,
    `Expected wallet LP to decrease after farm stake (before=${lpBefore}, after=${lpAfterStake}, amount=${amount}).`
  );

  try {
    await quoteAndSubmit({
      shapeKey: CLAIM_SHAPE,
      input: { userAddress, farmAppId }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Claiming with zero accrued rewards or missing reward opt-ins can fail; unstake is still required.
    t.diagnostic(`Claim skipped/failed: ${message}`);
  }

  await quoteAndSubmit({
    shapeKey: UNSTAKE_SHAPE,
    input: {
      userAddress,
      farmAppId,
      amount: serializeAmount(amount)
    }
  });

  const lpAfterUnstake = await getAssetBalance(algod, userAddress, stakedAssetId);
  assert.ok(
    lpAfterUnstake >= lpAfterStake + amount,
    `Expected wallet LP to increase after unstake (afterStake=${lpAfterStake}, afterUnstake=${lpAfterUnstake}, amount=${amount}).`
  );
});
