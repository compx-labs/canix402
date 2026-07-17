import assert from "node:assert/strict";
import test from "node:test";

import {
  accountFromMnemonic,
  createAlgodClientFromEnv,
  ensureAssetOptIn,
  getAssetBalance,
  getDorkFiArc200Balance,
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
import {
  findCatalogMarket,
  DORKFI_MAINNET_USDC_ASA_ID,
  DORKFI_MAINNET_USDC_MARKET_APP_ID,
  DORKFI_MAINNET_USDC_POOL_APP_ID
} from "../../src/execution/shapes/dorkfi/index.js";

loadLiveEnvFiles();

const DEPOSIT_SHAPE = "mainnet:dorkfi:v1:deposit:asa";
const WITHDRAW_SHAPE = "mainnet:dorkfi:v1:withdraw:asa";

const DEPOSIT_USDC_MICRO_AMOUNT = 100_000n;

type LendingScenario = "deposit" | "withdraw" | "roundtrip";

function isExecutionLiveEnabled(): boolean {
  return process.env.X402_DORKFI_EXECUTION_LIVE === "1";
}

function selectedScenario(): LendingScenario {
  const raw = process.env.X402_DORKFI_EXECUTION_SCENARIO ?? "roundtrip";
  if (["deposit", "withdraw", "roundtrip"].includes(raw)) {
    return raw as LendingScenario;
  }
  throw new Error(
    `Invalid X402_DORKFI_EXECUTION_SCENARIO "${raw}". Expected deposit, withdraw, or roundtrip.`
  );
}

function skipUnlessLive(t: test.TestContext): boolean {
  if (!isExecutionLiveEnabled()) {
    t.skip("Set X402_DORKFI_EXECUTION_LIVE=1 to run Dork.fi production execution tests.");
    return true;
  }
  return false;
}

function serializeAmount(value: bigint): string {
  return value.toString();
}

function resolveUsdcMarket(): {
  poolAppId: number;
  marketAppId: number;
  assetId: number;
  nTokenAppId: number;
} {
  const poolAppId = Number(
    process.env.X402_DORKFI_USDC_POOL_APP_ID ?? DORKFI_MAINNET_USDC_POOL_APP_ID
  );
  const marketAppId = Number(
    process.env.X402_DORKFI_USDC_MARKET_APP_ID ?? DORKFI_MAINNET_USDC_MARKET_APP_ID
  );
  const assetId = Number(process.env.X402_DORKFI_USDC_ASSET_ID ?? DORKFI_MAINNET_USDC_ASA_ID);
  const catalogMarket = findCatalogMarket({ poolAppId, marketAppId, assetId });
  const nTokenAppId = Number(
    process.env.X402_DORKFI_USDC_NTOKEN_APP_ID ?? catalogMarket?.nTokenAppId
  );

  if (!Number.isInteger(poolAppId) || poolAppId <= 0) {
    throw new Error("X402_DORKFI_USDC_POOL_APP_ID must be a positive integer.");
  }
  if (!Number.isInteger(marketAppId) || marketAppId <= 0) {
    throw new Error("X402_DORKFI_USDC_MARKET_APP_ID must be a positive integer.");
  }
  if (!Number.isInteger(assetId) || assetId <= 0) {
    throw new Error("X402_DORKFI_USDC_ASSET_ID must be a positive integer.");
  }
  if (!Number.isInteger(nTokenAppId) || nTokenAppId <= 0) {
    throw new Error(
      "X402_DORKFI_USDC_NTOKEN_APP_ID must be configured for custom Dork.fi USDC market overrides."
    );
  }

  return { poolAppId, marketAppId, assetId, nTokenAppId };
}

async function runLendingDeposit(): Promise<{ nTokenMinted: bigint }> {
  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:dorkfi-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const market = resolveUsdcMarket();

  await ensureAssetOptIn(account, algod, market.assetId);

  const nTokenBefore = await getDorkFiArc200Balance(
    algod,
    market.nTokenAppId,
    userAddress
  );

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: DEPOSIT_SHAPE,
    input: {
      userAddress,
      poolAppId: market.poolAppId,
      marketAppId: market.marketAppId,
      assetId: market.assetId,
      amount: serializeAmount(DEPOSIT_USDC_MICRO_AMOUNT)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  assert.equal(quoteResponse.meta.paymentRequired, true);
  const signed = signEncodedTransactionGroup(
    quoteResponse.data[0].encodedTransactions,
    account.sk
  );
  await submitTransactionGroup(algod, signed);

  const nTokenAfter = await getDorkFiArc200Balance(
    algod,
    market.nTokenAppId,
    userAddress
  );
  const nTokenMinted = nTokenAfter - nTokenBefore;
  assert.ok(nTokenMinted > 0n, "Expected nToken balance to increase after deposit.");

  return { nTokenMinted };
}

test("Dork.fi production lending deposit", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedScenario() !== "deposit") {
    t.skip(`Skipping because X402_DORKFI_EXECUTION_SCENARIO=${selectedScenario()}.`);
    return;
  }
  await runLendingDeposit();
});

test("Dork.fi production lending withdraw", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedScenario() !== "withdraw") {
    t.skip(`Skipping because X402_DORKFI_EXECUTION_SCENARIO=${selectedScenario()}.`);
    return;
  }

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:dorkfi-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const market = resolveUsdcMarket();

  const nTokenBalance = await getDorkFiArc200Balance(
    algod,
    market.nTokenAppId,
    userAddress
  );
  if (nTokenBalance <= 0n) {
    t.skip("Wallet has no Dork.fi nToken balance to withdraw.");
    return;
  }

  const usdcBefore = await getAssetBalance(algod, userAddress, market.assetId);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: WITHDRAW_SHAPE,
    input: {
      userAddress,
      poolAppId: market.poolAppId,
      marketAppId: market.marketAppId,
      assetId: market.assetId,
      amount: serializeAmount(nTokenBalance)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  const signed = signEncodedTransactionGroup(
    quoteResponse.data[0].encodedTransactions,
    account.sk
  );
  await submitTransactionGroup(algod, signed);

  const nTokenAfter = await getDorkFiArc200Balance(
    algod,
    market.nTokenAppId,
    userAddress
  );
  assert.ok(nTokenAfter < nTokenBalance, "Expected nToken balance to decrease after withdraw.");

  const usdcAfter = await getAssetBalance(algod, userAddress, market.assetId);
  assert.ok(usdcAfter > usdcBefore, "Expected USDC balance to increase after withdraw.");
});

test("Dork.fi production lending roundtrip", async (t) => {
  if (skipUnlessLive(t)) return;
  if (selectedScenario() !== "roundtrip") {
    t.skip(`Skipping because X402_DORKFI_EXECUTION_SCENARIO=${selectedScenario()}.`);
    return;
  }

  const { nTokenMinted } = await runLendingDeposit();

  const env = getLiveEnv();
  const baseUrl = getProductionBaseUrl();
  const clientMnemonic = requireClientMnemonic("npm run test:dorkfi-production");
  const account = accountFromMnemonic(clientMnemonic);
  const algod = createAlgodClientFromEnv();
  const userAddress = account.addr.toString();
  const market = resolveUsdcMarket();
  const usdcBefore = await getAssetBalance(algod, userAddress, market.assetId);

  const quoteResponse = await fetchPaidExecutionQuote({
    baseUrl,
    shapeKey: WITHDRAW_SHAPE,
    input: {
      userAddress,
      poolAppId: market.poolAppId,
      marketAppId: market.marketAppId,
      assetId: market.assetId,
      amount: serializeAmount(nTokenMinted)
    },
    clientMnemonic,
    algodUrl: env.algodUrl
  });

  const signed = signEncodedTransactionGroup(
    quoteResponse.data[0].encodedTransactions,
    account.sk
  );
  await submitTransactionGroup(algod, signed);

  const usdcAfter = await getAssetBalance(algod, userAddress, market.assetId);
  assert.ok(usdcAfter >= usdcBefore, "Expected USDC balance to recover after roundtrip withdraw.");
});
