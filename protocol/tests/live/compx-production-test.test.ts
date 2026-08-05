import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import { CompXSDK, DEFAULT_APP_CALL_MAX_FEE, buildDepositTransactions } from "@compx/sdk";

import {
  USDC_ASSET_ID,
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
import { createCompXBuilderAlgodClient } from "../../src/execution/shapes/compx/shared.js";

loadLiveEnvFiles();

const DEPOSIT_SHAPE = "mainnet:compx:v1:deposit:asa";
const WITHDRAW_SHAPE = "mainnet:compx:v1:withdraw:asa";
const BORROW_SHAPE = "mainnet:compx:v1:borrow:asa";
const REPAY_SHAPE = "mainnet:compx:v1:repay:asa";
const STAKE_SHAPE = "mainnet:compx:v1:stake:asa";
const UNSTAKE_SHAPE = "mainnet:compx:v1:unstake:asa";
const CLAIM_SHAPE = "mainnet:compx:v1:claim:rewards";

const DEPOSIT_USDC_MICRO_AMOUNT = 100_000n;
const BORROW_USDC_MICRO_AMOUNT = 10_000n;
const USDC_MARKET_APP_ID = 3491050310;

type LendingScenario =
  | "deposit"
  | "withdraw"
  | "roundtrip"
  | "borrow"
  | "repay"
  | "credit-roundtrip";
type StakingScenario = "stake" | "unstake" | "claim" | "roundtrip";

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_COMPX_EXECUTION_LIVE === "1";
}

function selectedLendingScenario(): LendingScenario {
  const raw = process.env.X402_COMPX_LENDING_SCENARIO ?? "roundtrip";
  if (
    [
      "deposit",
      "withdraw",
      "roundtrip",
      "borrow",
      "repay",
      "credit-roundtrip"
    ].includes(raw)
  ) {
    return raw as LendingScenario;
  }
  throw new Error(
    `Invalid X402_COMPX_LENDING_SCENARIO "${raw}". Expected deposit, withdraw, roundtrip, borrow, repay, or credit-roundtrip.`
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

function signCompXTransactions(
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

async function submitCompXQuote(
  algod: ReturnType<typeof createAlgodClientFromEnv>,
  encodedTransactions: readonly string[],
  secretKey: Uint8Array
): Promise<void> {
  await submitTransactionGroup(algod, signCompXTransactions(encodedTransactions, secretKey));
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

test("CompX SDK production smoke reads markets and builds deposit group", async (t) => {
  if (skipUnlessLive(t)) return;

  const env = getLiveEnv();
  const clientMnemonic = requireClientMnemonic("npm run test:compx-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const sdk = new CompXSDK({ algodClient: algod, network: "mainnet" });

  const market = await sdk.lending.getMarket(USDC_MARKET_APP_ID);
  assert.ok(market, `CompX USDC lending market ${USDC_MARKET_APP_ID} was not found.`);
  assert.equal(market.appId, USDC_MARKET_APP_ID);
  assert.equal(market.baseTokenId, USDC_ASSET_ID);
  assert.equal(market.contractState, 1);

  const markets = await sdk.lending.getAllMarkets();
  assert.ok(markets.length > 0, "Expected CompX SDK to return at least one lending market.");
  assert.equal(
    markets.some((candidate) => candidate.appId === USDC_MARKET_APP_ID),
    true
  );

  const pools = await sdk.staking.getAllPools();
  assert.ok(Array.isArray(pools), "Expected CompX SDK staking pools response to be an array.");

  const builderAlgod = createCompXBuilderAlgodClient();
  const bundle = await buildDepositTransactions(builderAlgod, {
    appId: market.appId,
    sender: userAddress,
    amount: DEPOSIT_USDC_MICRO_AMOUNT,
    appCallMaxFee: DEFAULT_APP_CALL_MAX_FEE
  });

  console.log("CompX SDK smoke... algodUrl:", env.algodUrl);
  console.log("CompX SDK smoke... marketCount:", markets.length);
  console.log("CompX SDK smoke... stakingPoolCount:", pools.length);
  console.log("CompX SDK smoke... buildDepositTransactions txnCount:", bundle.transactions.length);
  console.log("CompX SDK smoke... buildDepositTransactions metadata:", bundle.metadata);

  assert.ok(bundle.transactions.length > 0);
  assert.equal(bundle.metadata.appId, USDC_MARKET_APP_ID);
  assert.equal(bundle.metadata.sender, userAddress);
  assert.equal(bundle.metadata.baseTokenId, USDC_ASSET_ID);
  assert.equal(bundle.metadata.lstTokenId, market.lstTokenId);
});

async function runLendingDeposit(): Promise<{ marketAppId: number; lstMinted: bigint }> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:compx-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const { marketAppId, lstTokenId } = await resolveUsdcMarketAppId(algod);

  await ensureAssetOptIn(account, algod, USDC_ASSET_ID);

  const lstBefore = await getAssetBalance(algod, userAddress, lstTokenId);

  console.log("Running lending deposit... userAddress:", userAddress);
  console.log("Running lending deposit... marketAppId:", marketAppId);
  console.log("Running lending deposit... amount:", DEPOSIT_USDC_MICRO_AMOUNT);
  console.log("Running lending deposit... algodUrl:", env.algodUrl);
  console.log("Running lending deposit... baseUrl:", baseUrl);
  console.log("Running lending deposit... shapeKey:", DEPOSIT_SHAPE);
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

  await submitCompXQuote(algod, quoteResponse.data[0].encodedTransactions, account.sk);

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

  await submitCompXQuote(algod, quoteResponse.data[0].encodedTransactions, account.sk);
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

  await submitCompXQuote(algod, quoteResponse.data[0].encodedTransactions, account.sk);
});

test("CompX production credit roundtrip (deposit → borrow → repay → withdraw)", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedLendingScenario() !== "credit-roundtrip") {
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
  const collateralAmount = lstMinted / 2n;
  if (collateralAmount <= 0n) {
    throw new Error("Expected positive LST minted from deposit for credit roundtrip.");
  }

  const borrowQuote = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: BORROW_SHAPE,
    input: {
      userAddress,
      marketAppId,
      borrowAmount: serializeAmount(BORROW_USDC_MICRO_AMOUNT),
      collateralAmount: serializeAmount(collateralAmount)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });
  await submitCompXQuote(algod, borrowQuote.data[0].encodedTransactions, account.sk);

  const repayQuote = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: REPAY_SHAPE,
    input: {
      userAddress,
      marketAppId,
      amount: serializeAmount(BORROW_USDC_MICRO_AMOUNT)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });
  await submitCompXQuote(algod, repayQuote.data[0].encodedTransactions, account.sk);

  const remainingLst = await getAssetBalance(
    algod,
    userAddress,
    (await resolveUsdcMarketAppId(algod)).lstTokenId
  );
  if (remainingLst <= 0n) {
    t.skip("No remaining LST to withdraw after credit roundtrip.");
    return;
  }

  const withdrawQuote = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: WITHDRAW_SHAPE,
    input: {
      userAddress,
      marketAppId,
      amount: serializeAmount(remainingLst)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });
  await submitCompXQuote(algod, withdrawQuote.data[0].encodedTransactions, account.sk);
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
    await submitCompXQuote(algod, stakeQuote.data[0].encodedTransactions, account.sk);
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
    await submitCompXQuote(algod, unstakeQuote.data[0].encodedTransactions, account.sk);
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

  await submitCompXQuote(algod, quoteResponse.data[0].encodedTransactions, account.sk);

  const rewardAfter = await getAssetBalance(algod, userAddress, pool.rewardAssetId);
  if (rewardAfter <= rewardBefore) {
    t.skip("No accrued rewards were claimable for this staker at execution time.");
  }
});
