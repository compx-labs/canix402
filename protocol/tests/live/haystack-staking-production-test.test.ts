import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  accountFromMnemonic,
  createAlgodClientFromEnv,
  ensureAssetOptIn,
  getAssetBalance,
  submitTransactionGroup
} from "../helpers/algorandExecution.js";
import {
  fetchPaidExecutionQuote,
  getLiveEnv,
  getProductionBaseUrl,
  loadLiveEnvFiles,
  requireClientMnemonic
} from "../helpers/x402LiveClient.js";
import {
  HAYSTACK_STAKING_APP_ID,
  HAY_ASSET_ID,
  USDC_ASSET_ID,
  createStakerBoxName,
  getStakerBoxRecord
} from "../../src/execution/shapes/haystack/index.js";

loadLiveEnvFiles();

const STAKE_SHAPE = "mainnet:haystack:v1:stake:hay";
const UNSTAKE_SHAPE = "mainnet:haystack:v1:unstake:hay";
const CLAIM_SHAPE = "mainnet:haystack:v1:claim:rewards";

type StakingScenario = "stake" | "unstake" | "claim" | "roundtrip";

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_HAYSTACK_STAKING_LIVE === "1";
}

function selectedScenario(): StakingScenario {
  const raw = process.env.X402_HAYSTACK_STAKING_SCENARIO ?? "roundtrip";
  if (["stake", "unstake", "claim", "roundtrip"].includes(raw)) {
    return raw as StakingScenario;
  }
  throw new Error(
    `Invalid X402_HAYSTACK_STAKING_SCENARIO "${raw}". Expected stake, unstake, claim, or roundtrip.`
  );
}

function skipUnlessLive(t: test.TestContext): boolean {
  if (!isExecutionLiveEnabled()) {
    t.skip("Set X402_HAYSTACK_STAKING_LIVE=1 to run Haystack staking production tests.");
    return true;
  }
  return false;
}

function resolveStakeAmount(): bigint {
  const configured = process.env.X402_HAYSTACK_STAKE_AMOUNT?.trim();
  if (configured === undefined || configured.length === 0) {
    return 100_000n;
  }
  const amount = BigInt(configured);
  if (amount <= 0n) {
    throw new Error("X402_HAYSTACK_STAKE_AMOUNT must be a positive integer.");
  }
  return amount;
}

function serializeAmount(value: bigint): string {
  return value.toString();
}

function signTransactions(
  encodedTransactions: readonly string[],
  secretKey: Uint8Array
): Uint8Array[] {
  return encodedTransactions.map((encoded) =>
    algosdk.signTransaction(
      algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64")),
      secretKey
    ).blob
  );
}

async function submitQuote(
  algod: ReturnType<typeof createAlgodClientFromEnv>,
  encodedTransactions: readonly string[],
  secretKey: Uint8Array
): Promise<void> {
  await submitTransactionGroup(algod, signTransactions(encodedTransactions, secretKey));
}

test("Haystack production staking stake/unstake roundtrip", async (t) => {
  if (skipUnlessLive(t)) return;

  const scenario = selectedScenario();
  if (scenario === "claim") {
    t.skip("Use the dedicated claim test when rewards exist.");
    return;
  }

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:haystack-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const stakeAmount = resolveStakeAmount();

  await ensureAssetOptIn(account, algod, HAY_ASSET_ID);
  await ensureAssetOptIn(account, algod, USDC_ASSET_ID);

  if (scenario === "stake" || scenario === "roundtrip") {
    const stakeQuote = await fetchPaidExecutionQuote({
      baseUrl,
      shapeKey: STAKE_SHAPE,
      input: {
        userAddress,
        amount: serializeAmount(stakeAmount)
      },
      clientMnemonic,
      algodUrl: env.algodUrl
    });
    await submitQuote(algod, stakeQuote.data[0].encodedTransactions, account.sk);

    // A second stake by an existing staker must omit the MBR payment (2-txn group).
    const stakerBoxName = createStakerBoxName(userAddress);
    const record = await getStakerBoxRecord(algod, HAYSTACK_STAKING_APP_ID, stakerBoxName);
    assert.equal(record.hasBox, true, "Expected staker box to exist after staking.");

    const secondStakeQuote = await fetchPaidExecutionQuote({
      baseUrl,
      shapeKey: STAKE_SHAPE,
      input: {
        userAddress,
        amount: serializeAmount(stakeAmount)
      },
      clientMnemonic,
      algodUrl: env.algodUrl
    });
    assert.equal(
      secondStakeQuote.data[0].transactions.length,
      2,
      "Returning-staker stake group must be 2 transactions (no MBR payment)."
    );
    await submitQuote(algod, secondStakeQuote.data[0].encodedTransactions, account.sk);
  }

  if (scenario === "unstake" || scenario === "roundtrip") {
    const stakerBoxName = createStakerBoxName(userAddress);
    const record = await getStakerBoxRecord(algod, HAYSTACK_STAKING_APP_ID, stakerBoxName);
    const unstakeAmount = scenario === "roundtrip" ? stakeAmount * 2n : record.stake;
    if (unstakeAmount <= 0n) {
      t.skip("No staked balance available to unstake.");
      return;
    }

    const unstakeQuote = await fetchPaidExecutionQuote({
      baseUrl,
      shapeKey: UNSTAKE_SHAPE,
      input: {
        userAddress,
        amount: serializeAmount(unstakeAmount)
      },
      clientMnemonic,
      algodUrl: env.algodUrl
    });
    await submitQuote(algod, unstakeQuote.data[0].encodedTransactions, account.sk);
  }
});

test("Haystack production staking claim rewards", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedScenario() !== "claim") {
    t.skip(`Skipping because X402_HAYSTACK_STAKING_SCENARIO=${selectedScenario()}.`);
    return;
  }

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:haystack-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();

  const stakerBoxName = createStakerBoxName(userAddress);
  const record = await getStakerBoxRecord(algod, HAYSTACK_STAKING_APP_ID, stakerBoxName);
  if (!record.hasBox) {
    t.skip("User has no staker box; stake before claiming rewards.");
    return;
  }

  await ensureAssetOptIn(account, algod, USDC_ASSET_ID);
  await ensureAssetOptIn(account, algod, HAY_ASSET_ID);

  const usdcBefore = await getAssetBalance(algod, userAddress, USDC_ASSET_ID);
  const hayBefore = await getAssetBalance(algod, userAddress, HAY_ASSET_ID);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: CLAIM_SHAPE,
    input: { userAddress },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  await submitQuote(algod, quoteResponse.data[0].encodedTransactions, account.sk);

  const usdcAfter = await getAssetBalance(algod, userAddress, USDC_ASSET_ID);
  const hayAfter = await getAssetBalance(algod, userAddress, HAY_ASSET_ID);
  if (usdcAfter <= usdcBefore && hayAfter <= hayBefore) {
    t.skip("No accrued rewards were claimable for this staker at execution time.");
  }
});
