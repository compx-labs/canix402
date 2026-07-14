import assert from "node:assert/strict";
import test from "node:test";

import { CompXSDK } from "@compx/sdk";

import {
  USDC_ASSET_ID,
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

const DEPOSIT_SHAPE = "mainnet:compx:v1:deposit:asa";
const WITHDRAW_SHAPE = "mainnet:compx:v1:withdraw:asa";
const STAKE_SHAPE = "mainnet:compx:v1:stake:asa";
const UNSTAKE_SHAPE = "mainnet:compx:v1:unstake:asa";
const CLAIM_SHAPE = "mainnet:compx:v1:claim:rewards";

const DEPOSIT_USDC_MICRO_AMOUNT = 100_000n;
const USDC_MARKET_APP_ID = 3491050310;

type LendingScenario = "deposit" | "withdraw" | "roundtrip";
type StakingScenario = "stake" | "unstake" | "claim" | "roundtrip";

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_COMPX_EXECUTION_LIVE === "1";
}

function selectedLendingScenario(): LendingScenario {
  const raw = process.env.X402_COMPX_LENDING_SCENARIO ?? "roundtrip";
  if (["deposit", "withdraw", "roundtrip"].includes(raw)) {
    return raw as LendingScenario;
  }
  throw new Error(
    `Invalid X402_COMPX_LENDING_SCENARIO "${raw}". Expected deposit, withdraw, or roundtrip.`
  );
}

function selectedStakingScenario(): StakingScenario {
  const raw = process.env.X402_COMPX_STAKING_SCENARIO ?? "roundtrip";
  if (["stake", "unstake", "claim", "roundtrip"].includes(raw)) {
    return raw as StakingScenario;
  }
  throw new Error(
    `Invalid X402_COMPX_STAKING_SCENARIO "${raw}". Expected stake, unstake, claim, or roundtrip.`
  );
}

function skipUnlessLive(t: test.TestContext): boolean {
  if (!isExecutionLiveEnabled()) {
    t.skip("Set X402_COMPX_EXECUTION_LIVE=1 to run CompX production execution tests.");
    return true;
  }
  return false;
}

function serializeAmount(value: bigint): string {
  return value.toString();
}

async function resolveUsdcMarketAppId(algod: ReturnType<typeof createAlgodClientFromEnv>): Promise<{
  marketAppId: number;
  lstTokenId: number;
}> {
  const sdk = new CompXSDK({ algodClient: algod, network: "mainnet" });
  const market = await sdk.lending.getMarket(USDC_MARKET_APP_ID);
  if (market === null) {
    throw new Error(`CompX USDC lending market ${USDC_MARKET_APP_ID} was not found.`);
  }
  if (market.baseTokenId !== USDC_ASSET_ID || market.contractState !== 1) {
    throw new Error(
      `CompX USDC lending market ${USDC_MARKET_APP_ID} is not an active USDC market.`
    );
  }
  return { marketAppId: market.appId, lstTokenId: market.lstTokenId };
}

function resolveStakingPoolAppId(): number | undefined {
  const configured = process.env.X402_COMPX_STAKING_POOL_APP_ID?.trim();
  if (configured === undefined || configured.length === 0) {
    return undefined;
  }
  const poolAppId = Number(configured);
  if (!Number.isInteger(poolAppId) || poolAppId <= 0) {
    throw new Error("X402_COMPX_STAKING_POOL_APP_ID must be a positive integer.");
  }
  return poolAppId;
}

function resolveStakeAmount(): bigint {
  const configured = process.env.X402_COMPX_STAKE_AMOUNT?.trim();
  if (configured === undefined || configured.length === 0) {
    return 100_000n;
  }
  const amount = BigInt(configured);
  if (amount <= 0n) {
    throw new Error("X402_COMPX_STAKE_AMOUNT must be a positive integer.");
  }
  return amount;
}

async function runLendingDeposit(): Promise<{ marketAppId: number; lstMinted: bigint }> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:compx-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const { marketAppId, lstTokenId } = await resolveUsdcMarketAppId(algod);

  await ensureAssetOptIn(account, algod, USDC_ASSET_ID);
  await ensureAssetOptIn(account, algod, lstTokenId);

  const lstBefore = await getAssetBalance(algod, userAddress, lstTokenId);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: DEPOSIT_SHAPE,
    input: {
      userAddress,
      marketAppId,
      amount: serializeAmount(DEPOSIT_USDC_MICRO_AMOUNT)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.meta.paymentRequired, true);
  const signed = signEncodedTransactionGroup(quoteResponse.data.encodedTransactions, account.sk);
  await submitTransactionGroup(algod, signed);

  const lstAfter = await getAssetBalance(algod, userAddress, lstTokenId);
  const lstMinted = lstAfter - lstBefore;
  assert.ok(lstMinted > 0n, "Expected LST balance to increase after deposit.");

  return { marketAppId, lstMinted };
}

test("CompX production lending deposit", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedLendingScenario() !== "deposit") {
    t.skip(`Skipping because X402_COMPX_LENDING_SCENARIO=${selectedLendingScenario()}.`);
    return;
  }
  await runLendingDeposit();
});

test("CompX production lending withdraw", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedLendingScenario() !== "withdraw") {
    t.skip(`Skipping because X402_COMPX_LENDING_SCENARIO=${selectedLendingScenario()}.`);
    return;
  }

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:compx-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const { marketAppId, lstTokenId } = await resolveUsdcMarketAppId(algod);
  await ensureAssetOptIn(account, algod, USDC_ASSET_ID);

  const lstBalance = await getAssetBalance(algod, userAddress, lstTokenId);
  if (lstBalance <= 0n) {
    t.skip("Wallet has no CompX LST balance to withdraw.");
    return;
  }

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: WITHDRAW_SHAPE,
    input: {
      userAddress,
      marketAppId,
      amount: serializeAmount(lstBalance)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  const signed = signEncodedTransactionGroup(quoteResponse.data.encodedTransactions, account.sk);
  await submitTransactionGroup(algod, signed);
});

test("CompX production lending roundtrip", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedLendingScenario() !== "roundtrip") {
    t.skip(`Skipping because X402_COMPX_LENDING_SCENARIO=${selectedLendingScenario()}.`);
    return;
  }

  const { marketAppId, lstMinted } = await runLendingDeposit();

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:compx-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: WITHDRAW_SHAPE,
    input: {
      userAddress,
      marketAppId,
      amount: serializeAmount(lstMinted)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  const signed = signEncodedTransactionGroup(quoteResponse.data.encodedTransactions, account.sk);
  await submitTransactionGroup(algod, signed);
});

test("CompX production staking stake/unstake roundtrip", async (t) => {
  if (skipUnlessLive(t)) return;

  const poolAppId = resolveStakingPoolAppId();
  if (poolAppId === undefined) {
    t.skip("Set X402_COMPX_STAKING_POOL_APP_ID to run CompX staking production tests.");
    return;
  }

  const scenario = selectedStakingScenario();
  if (scenario === "claim") {
    t.skip("Use the dedicated claim test when rewards exist.");
    return;
  }

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:compx-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const stakeAmount = resolveStakeAmount();

  const sdk = new CompXSDK({ algodClient: algod, network: "mainnet" });
  const pool = await sdk.staking.getPool(poolAppId);
  if (pool === null) {
    t.skip(`CompX staking pool ${poolAppId} was not found.`);
    return;
  }

  await ensureAssetOptIn(account, algod, pool.stakedAssetId);
  await ensureAssetOptIn(account, algod, pool.rewardAssetId);

  if (scenario === "stake" || scenario === "roundtrip") {
    const stakeQuote = await fetchPaidExecutionQuote({
      baseUrl,
      shapeKey: STAKE_SHAPE,
      input: {
        userAddress,
        poolAppId,
        amount: serializeAmount(stakeAmount)
      },
      clientMnemonic,
      algodUrl: env.algodUrl
    });
    const signedStake = signEncodedTransactionGroup(
      stakeQuote.data.encodedTransactions,
      account.sk
    );
    await submitTransactionGroup(algod, signedStake);
  }

  if (scenario === "unstake" || scenario === "roundtrip") {
    const staker = await sdk.staking.getStakerInfo(poolAppId, userAddress);
    const unstakeAmount =
      scenario === "roundtrip" ? stakeAmount : staker?.stake ?? stakeAmount;
    if (unstakeAmount <= 0n) {
      t.skip("No staked balance available to unstake.");
      return;
    }

    const unstakeQuote = await fetchPaidExecutionQuote({
      baseUrl,
      shapeKey: UNSTAKE_SHAPE,
      input: {
        userAddress,
        poolAppId,
        amount: serializeAmount(unstakeAmount)
      },
      clientMnemonic,
      algodUrl: env.algodUrl
    });
    const signedUnstake = signEncodedTransactionGroup(
      unstakeQuote.data.encodedTransactions,
      account.sk
    );
    await submitTransactionGroup(algod, signedUnstake);
  }
});

test("CompX production staking claim rewards", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedStakingScenario() !== "claim") {
    t.skip(`Skipping because X402_COMPX_STAKING_SCENARIO=${selectedStakingScenario()}.`);
    return;
  }

  const poolAppId = resolveStakingPoolAppId();
  if (poolAppId === undefined) {
    t.skip("Set X402_COMPX_STAKING_POOL_APP_ID to run CompX staking claim tests.");
    return;
  }

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:compx-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();

  const sdk = new CompXSDK({ algodClient: algod, network: "mainnet" });
  const pool = await sdk.staking.getPool(poolAppId);
  if (pool === null) {
    t.skip(`CompX staking pool ${poolAppId} was not found.`);
    return;
  }

  const staker = await sdk.staking.getStakerInfo(poolAppId, userAddress);
  if (staker === null) {
    t.skip("User has no staker box; stake before claiming rewards.");
    return;
  }

  await ensureAssetOptIn(account, algod, pool.rewardAssetId);
  const rewardBefore = await getAssetBalance(algod, userAddress, pool.rewardAssetId);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: CLAIM_SHAPE,
    input: {
      userAddress,
      poolAppId
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  const signed = signEncodedTransactionGroup(quoteResponse.data.encodedTransactions, account.sk);
  await submitTransactionGroup(algod, signed);

  const rewardAfter = await getAssetBalance(algod, userAddress, pool.rewardAssetId);
  if (rewardAfter <= rewardBefore) {
    t.skip("No accrued rewards were claimable for this staker at execution time.");
  }
});
