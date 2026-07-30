import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import { getStakingPosition } from "@alpha-arcade/sdk";

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
  ALPHA_ARCADE_STAKING_APP_ID,
  ALPHA_ASSET_ID,
  USDC_ASSET_ID
} from "../../src/execution/shapes/alpha-arcade/index.js";

loadLiveEnvFiles();

const STAKE_SHAPE = "mainnet:alpha-arcade:v1:stake:alpha";
const UNSTAKE_SHAPE = "mainnet:alpha-arcade:v1:unstake:alpha";
const CLAIM_SHAPE = "mainnet:alpha-arcade:v1:claimRewards:usdc";

type StakingScenario = "stake" | "unstake" | "claim" | "roundtrip";

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_ALPHA_ARCADE_STAKING_LIVE === "1";
}

function selectedScenario(): StakingScenario {
  const raw = process.env.X402_ALPHA_ARCADE_STAKING_SCENARIO ?? "roundtrip";
  if (["stake", "unstake", "claim", "roundtrip"].includes(raw)) {
    return raw as StakingScenario;
  }
  throw new Error(
    `Invalid X402_ALPHA_ARCADE_STAKING_SCENARIO "${raw}". Expected stake, unstake, claim, or roundtrip.`
  );
}

function skipUnlessLive(t: test.TestContext): boolean {
  if (!isExecutionLiveEnabled()) {
    t.skip(
      "Set X402_ALPHA_ARCADE_STAKING_LIVE=1 to run Alpha Arcade staking production tests."
    );
    return true;
  }
  return false;
}

function resolveStakeAmount(): bigint {
  const configured = process.env.X402_ALPHA_ARCADE_STAKE_AMOUNT?.trim();
  if (configured === undefined || configured.length === 0) {
    return 1_000_000n;
  }
  const amount = BigInt(configured);
  if (amount <= 0n) {
    throw new Error("X402_ALPHA_ARCADE_STAKE_AMOUNT must be a positive integer.");
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

async function readPosition(algod: algosdk.Algodv2, address: string) {
  const indexer = new algosdk.Indexer(
    process.env.X402_INDEXER_TOKEN ?? "",
    (process.env.X402_INDEXER_URL ?? "https://mainnet-idx.algonode.cloud").replace(/\/$/, ""),
    ""
  );
  return getStakingPosition(
    {
      algodClient: algod,
      indexerClient: indexer,
      signer: algosdk.makeEmptyTransactionSigner(),
      activeAddress: address,
      matcherAppId: 3_078_581_851,
      usdcAssetId: USDC_ASSET_ID,
      stakingAppId: ALPHA_ARCADE_STAKING_APP_ID,
      alphaAssetId: ALPHA_ASSET_ID
    },
    address
  );
}

test("Alpha Arcade production staking stake/unstake roundtrip", async (t) => {
  if (skipUnlessLive(t)) return;

  const scenario = selectedScenario();
  if (scenario === "claim") {
    t.skip("Use the dedicated claim test when rewards exist.");
    return;
  }

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:alpha-arcade-staking-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const stakeAmount = resolveStakeAmount();

  await ensureAssetOptIn(account, algod, ALPHA_ASSET_ID);
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

    const afterFirst = await readPosition(algod, userAddress);
    assert.equal(afterFirst.optedIn, true, "Expected app opt-in after staking.");
    assert.ok(afterFirst.staked >= Number(stakeAmount));

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
      "Returning-staker stake group must be 2 transactions (no opt_in)."
    );
    await submitQuote(algod, secondStakeQuote.data[0].encodedTransactions, account.sk);
  }

  if (scenario === "unstake" || scenario === "roundtrip") {
    const position = await readPosition(algod, userAddress);
    const unstakeAmount =
      scenario === "roundtrip" ? stakeAmount * 2n : BigInt(position.staked);
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

test("Alpha Arcade production staking claim rewards", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedScenario() !== "claim") {
    t.skip(`Skipping because X402_ALPHA_ARCADE_STAKING_SCENARIO=${selectedScenario()}.`);
    return;
  }

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:alpha-arcade-staking-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();

  const position = await readPosition(algod, userAddress);
  if (!position.optedIn) {
    t.skip("User is not opted into Alpha Arcade staking; stake before claiming.");
    return;
  }

  await ensureAssetOptIn(account, algod, USDC_ASSET_ID);

  const usdcBefore = await getAssetBalance(algod, userAddress, USDC_ASSET_ID);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: CLAIM_SHAPE,
    input: { userAddress },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  await submitQuote(algod, quoteResponse.data[0].encodedTransactions, account.sk);

  const usdcAfter = await getAssetBalance(algod, userAddress, USDC_ASSET_ID);
  if (usdcAfter <= usdcBefore) {
    t.skip("No accrued USDC rewards were claimable for this staker at execution time.");
  }
});
