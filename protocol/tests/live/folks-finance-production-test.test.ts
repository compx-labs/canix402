import assert from "node:assert/strict";
import test from "node:test";

import {
  MainnetDepositsAppId,
  MainnetPools,
  retrieveUserDepositsInfo
} from "@folks-finance/algorand-sdk";

import {
  USDC_ASSET_ID,
  accountFromMnemonic,
  createAlgodClientFromEnv,
  ensureAssetOptIn,
  getAssetBalance,
  signEncodedTransactionGroup,
  signEncodedTransactionGroupByIndex,
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
  createExecutionIndexerClient,
  resolveFolksEscrowContext,
  resolveFolksPoolState
} from "../../src/execution/shapes/folks-finance/pool-state.js";

loadLiveEnvFiles();

const SETUP_DEPOSIT_ESCROW_SHAPE = "mainnet:folks-finance:v2:setup:depositEscrow";
const SETUP_OPT_ESCROW_ASSET_SHAPE = "mainnet:folks-finance:v2:setup:optEscrowAsset";
const DEPOSIT_ESCROW_SHAPE = "mainnet:folks-finance:v2:deposit:escrow";
const WITHDRAW_ESCROW_SHAPE = "mainnet:folks-finance:v2:withdraw:escrow";

const DEPOSIT_USDC_MICRO_AMOUNT = 100_000n;
const WITHDRAW_USDC_MICRO_AMOUNT = 100_000n;
const USDC_POOL_APP_ID = 971372237;

type ExecutionScenario = "deposit" | "withdraw" | "roundtrip";

const VALID_SCENARIOS: readonly ExecutionScenario[] = ["deposit", "withdraw", "roundtrip"];

interface AssetTransferSearchTransaction {
  assetTransferTransaction?: {
    assetId?: bigint | number;
    amount?: bigint | number;
    receiver?: string;
  };
  innerTxns?: AssetTransferSearchTransaction[];
}

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_FOLKS_EXECUTION_LIVE === "1";
}

function selectedScenario(): ExecutionScenario {
  const raw = process.env.X402_FOLKS_EXECUTION_SCENARIO ?? "roundtrip";
  if ((VALID_SCENARIOS as readonly string[]).includes(raw)) {
    return raw as ExecutionScenario;
  }
  throw new Error(
    `Invalid X402_FOLKS_EXECUTION_SCENARIO "${raw}". Expected one of: ${VALID_SCENARIOS.join(", ")}.`
  );
}

function skipUnlessLive(t: test.TestContext): boolean {
  if (!isExecutionLiveEnabled()) {
    t.skip("Set X402_FOLKS_EXECUTION_LIVE=1 to run Folks Finance production lending tests.");
    return true;
  }
  return false;
}

function skipUnlessScenario(t: test.TestContext, scenario: ExecutionScenario): boolean {
  if (selectedScenario() !== scenario) {
    t.skip(`Skipping because X402_FOLKS_EXECUTION_SCENARIO=${selectedScenario()}.`);
    return true;
  }
  return false;
}

function serializeAmount(value: bigint): string {
  return value.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function lookupConfirmedTransaction(txId: string): Promise<AssetTransferSearchTransaction> {
  const indexer = createExecutionIndexerClient();
  let lastError: unknown;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await indexer.lookupTransactionByID(txId).do();
      return response.transaction as AssetTransferSearchTransaction;
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }

  throw lastError;
}

function sumAssetTransfersToReceiver(
  transaction: AssetTransferSearchTransaction,
  receiver: string,
  assetId: number
): bigint {
  const transfer = transaction.assetTransferTransaction;
  const ownAmount =
    transfer?.receiver === receiver && Number(transfer.assetId) === assetId
      ? BigInt(transfer.amount ?? 0)
      : 0n;
  return (
    ownAmount +
    (transaction.innerTxns ?? []).reduce(
      (total, inner) => total + sumAssetTransfersToReceiver(inner, receiver, assetId),
      0n
    )
  );
}

function resolveUsdcAssetId(): number {
  const configured = process.env.X402_FOLKS_ASSET_ID?.trim();
  if (configured === undefined || configured.length === 0) {
    return USDC_ASSET_ID;
  }
  return Number(configured);
}

function resolveFolksPoolAppId(): number {
  const assetId = resolveUsdcAssetId();
  if (assetId === USDC_ASSET_ID) {
    return USDC_POOL_APP_ID;
  }

  const matches = Object.entries(MainnetPools).filter(([, pool]) => Number(pool.assetId) === assetId);
  const nonIsolatedMatches = matches.filter(([symbol]) => !symbol.startsWith("ISOLATED_"));
  const candidates = nonIsolatedMatches.length > 0 ? nonIsolatedMatches : matches;
  if (candidates.length !== 1) {
    throw new Error(
      `Unable to choose a Folks Finance pool for asset ${assetId}; update the production test with the target pool app id.`
    );
  }

  return candidates[0]![1].appId;
}

function resolveConfiguredEscrowAddress(): string | undefined {
  const configured = process.env.X402_FOLKS_ESCROW_ADDRESS?.trim();
  return configured === undefined || configured.length === 0 ? undefined : configured;
}

async function discoverEscrowAddress(userAddress: string): Promise<string | undefined> {
  const configured = resolveConfiguredEscrowAddress();
  if (configured !== undefined) {
    return configured;
  }

  const indexer = createExecutionIndexerClient();
  const deposits = await retrieveUserDepositsInfo(
    indexer,
    MainnetDepositsAppId,
    userAddress
  );

  if (deposits.length === 0) {
    return undefined;
  }
  if (deposits.length === 1) {
    return deposits[0]!.escrowAddress;
  }

  throw new Error(
    "Multiple Folks Finance deposit escrows found; set X402_FOLKS_ESCROW_ADDRESS explicitly."
  );
}

async function ensureEscrowReady(userAddress: string): Promise<string> {
  const algod = createAlgodClientFromEnv();
  const poolAppId = resolveFolksPoolAppId();
  const poolState = await resolveFolksPoolState({
    network: "mainnet",
    algod,
    poolAppId
  });

  let escrowAddress = await discoverEscrowAddress(userAddress);
  if (escrowAddress === undefined) {
    escrowAddress = await runSetupDepositEscrow(userAddress);
  }

  let escrow = await resolveFolksEscrowContext({
    algod,
    userAddress,
    pool: poolState.pool,
    escrowAddress
  });

  if (!escrow.optedIntoFAsset) {
    await runSetupOptEscrowAsset(userAddress, escrow.escrowAddress, poolAppId);
    escrow = await resolveFolksEscrowContext({
      algod,
      userAddress,
      pool: poolState.pool,
      escrowAddress: escrow.escrowAddress
    });
  }

  assert.equal(escrow.optedIntoFAsset, true);
  return escrow.escrowAddress;
}

async function runSetupDepositEscrow(userAddress: string): Promise<string> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:folks-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: SETUP_DEPOSIT_ESCROW_SHAPE,
    input: { userAddress },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.data[0].shapeKey, SETUP_DEPOSIT_ESCROW_SHAPE);

  const escrowAddress = quoteResponse.data[0].metadata.escrowAddress;
  const escrowPrivateKeyBase64 = quoteResponse.data[0].metadata.escrowPrivateKeyBase64;
  assert.equal(typeof escrowAddress, "string");
  assert.equal(typeof escrowPrivateKeyBase64, "string");

  const escrowSecretKey = Buffer.from(escrowPrivateKeyBase64 as string, "base64");
  const signed = signEncodedTransactionGroupByIndex(
    quoteResponse.data[0].encodedTransactions,
    (index) => (index === 2 ? escrowSecretKey : account.sk)
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);

  return escrowAddress as string;
}

async function runSetupOptEscrowAsset(
  userAddress: string,
  escrowAddress: string,
  poolAppId: number
): Promise<void> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:folks-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: SETUP_OPT_ESCROW_ASSET_SHAPE,
    input: {
      userAddress,
      escrowAddress,
      poolAppId
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.data[0].shapeKey, SETUP_OPT_ESCROW_ASSET_SHAPE);

  const signed = signEncodedTransactionGroup(
    quoteResponse.data[0].encodedTransactions,
    account.sk
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);
}

async function runEscrowDeposit(escrowAddress: string): Promise<bigint> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:folks-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const assetId = resolveUsdcAssetId();
  const poolAppId = resolveFolksPoolAppId();

  await ensureAssetOptIn(account, algod, assetId);

  const poolState = await resolveFolksPoolState({
    network: "mainnet",
    algod,
    poolAppId
  });
  const fAssetId = Number(poolState.pool.fAssetId);
  const fAssetBalanceBefore = await getAssetBalance(algod, escrowAddress, fAssetId);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: DEPOSIT_ESCROW_SHAPE,
    input: {
      userAddress,
      escrowAddress,
      poolAppId,
      assetAmount: serializeAmount(DEPOSIT_USDC_MICRO_AMOUNT)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.data[0].shapeKey, DEPOSIT_ESCROW_SHAPE);

  const signed = signEncodedTransactionGroup(
    quoteResponse.data[0].encodedTransactions,
    account.sk
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);

  const fAssetBalanceAfter = await getAssetBalance(algod, escrowAddress, fAssetId);
  assert.ok(
    fAssetBalanceAfter > fAssetBalanceBefore,
    `Expected escrow fAsset balance to increase after deposit (before=${fAssetBalanceBefore}, after=${fAssetBalanceAfter}).`
  );

  return fAssetBalanceAfter;
}

async function runEscrowWithdraw(escrowAddress: string): Promise<void> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:folks-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const assetId = resolveUsdcAssetId();
  const poolAppId = resolveFolksPoolAppId();

  const usdcBalanceBefore = await getAssetBalance(algod, userAddress, assetId);
  console.log("Running Folks escrow withdraw...", {
    userAddress,
    escrowAddress,
    poolAppId,
    assetId,
    amount: WITHDRAW_USDC_MICRO_AMOUNT.toString(),
    amountDenomination: "asset",
    usdcBalanceBefore: usdcBalanceBefore.toString()
  });

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: WITHDRAW_ESCROW_SHAPE,
    input: {
      userAddress,
      escrowAddress,
      poolAppId,
      amount: serializeAmount(WITHDRAW_USDC_MICRO_AMOUNT),
      amountDenomination: "asset"
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.data[0].shapeKey, WITHDRAW_ESCROW_SHAPE);
  console.log("Folks escrow withdraw quote metadata...", quoteResponse.data[0].metadata);

  const signed = signEncodedTransactionGroup(
    quoteResponse.data[0].encodedTransactions,
    account.sk
  );
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);

  const confirmedWithdraw = await lookupConfirmedTransaction(submission.txId);
  const returnedAssetAmount = sumAssetTransfersToReceiver(
    confirmedWithdraw,
    userAddress,
    assetId
  );
  const usdcBalanceAfter = await getAssetBalance(algod, userAddress, assetId);
  console.log("USDC balance after withdraw...", {
    returnedAssetAmount: returnedAssetAmount.toString(),
    usdcBalanceAfter: usdcBalanceAfter.toString(),
    usdcBalanceBefore: usdcBalanceBefore.toString()
  });
  assert.equal(
    returnedAssetAmount,
    WITHDRAW_USDC_MICRO_AMOUNT,
    `Expected withdraw transaction to return ${WITHDRAW_USDC_MICRO_AMOUNT.toString()} base units to the wallet.`
  );
}

test("escrow deposit via production x402 execution quote", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "deposit")) {
    return;
  }

  const clientMnemonic = requireClientMnemonic("npm run test:folks-production");
  const userAddress = accountFromMnemonic(clientMnemonic).addr.toString();
  const escrowAddress = await ensureEscrowReady(userAddress);
  const fAssetBalanceAfter = await runEscrowDeposit(escrowAddress);
  assert.ok(fAssetBalanceAfter > 0n);
});

test("escrow withdraw via production x402 execution quote", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "withdraw")) {
    return;
  }

  const clientMnemonic = requireClientMnemonic("npm run test:folks-production");
  const userAddress = accountFromMnemonic(clientMnemonic).addr.toString();
  const algod = createAlgodClientFromEnv();
  const poolAppId = resolveFolksPoolAppId();
  const poolState = await resolveFolksPoolState({
    network: "mainnet",
    algod,
    poolAppId
  });

  const escrowAddress = await ensureEscrowReady(userAddress);
  const fAssetBalance = await getAssetBalance(
    algod,
    escrowAddress,
    Number(poolState.pool.fAssetId)
  );

  if (fAssetBalance <= 0n) {
    t.skip("Escrow has no fAsset balance. Run deposit or roundtrip scenario first.");
    return;
  }

  await runEscrowWithdraw(escrowAddress);
});

test("escrow roundtrip deposit then withdraw via production x402 execution quotes", async (t) => {
  if (skipUnlessLive(t) || skipUnlessScenario(t, "roundtrip")) {
    return;
  }

  const clientMnemonic = requireClientMnemonic("npm run test:folks-production");
  const userAddress = accountFromMnemonic(clientMnemonic).addr.toString();
  const escrowAddress = await ensureEscrowReady(userAddress);
  await runEscrowDeposit(escrowAddress);
  await runEscrowWithdraw(escrowAddress);
});
