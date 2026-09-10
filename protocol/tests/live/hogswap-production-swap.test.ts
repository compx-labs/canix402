import assert from "node:assert/strict";
import test from "node:test";

import {
  ALGO_ASSET_ID,
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
  requireClientMnemonic,
  type ExecutionQuoteResponse
} from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

const SWAP_SHAPE = "mainnet:hogswap:v1:swap:fixed-input";
const SWAP_INPUT_MICRO_USDC = 100_000n;
const EXPECTED_X402_MICRO_USDC = 100_000n;
const MAX_SLIPPAGE_BPS = 50;

test(
  "swap 0.1 USDC to ALGO through the production HOGSWAP execution quote",
  { timeout: 120_000 },
  async (t) => {
    if (process.env.X402_HOGSWAP_SWAP_LIVE !== "1") {
      t.skip(
        "Set X402_HOGSWAP_SWAP_LIVE=1 to spend 0.1 USDC plus the 0.1 USDC x402 quote charge on mainnet."
      );
      return;
    }

    const env = getLiveEnv();
    const baseUrl = getProductionBaseUrl();
    const mnemonic = requireClientMnemonic("npm run test:hogswap-production");
    const account = accountFromMnemonic(mnemonic);
    const address = account.addr.toString();
    const algod = createAlgodClientFromEnv();

    const usdcBefore = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcBefore >= SWAP_INPUT_MICRO_USDC + EXPECTED_X402_MICRO_USDC,
      `Wallet requires at least 0.2 USDC; balance is ${usdcBefore} micro-USDC.`
    );

    const quoteResponse = await fetchQuoteWithOptInRetry({
      baseUrl,
      address,
      mnemonic,
      algodUrl: env.algodUrl,
      account,
      algod
    });

    assert.equal(quoteResponse.meta.paymentRequired, true);
    assert.equal(quoteResponse.meta.executionSubmitted, false);
    assert.equal(quoteResponse.data[0]?.shapeKey, SWAP_SHAPE);
    assert.ok(quoteResponse.data[0].encodedTransactions.length > 0);

    const signed = signEncodedTransactionGroup(
      quoteResponse.data[0].encodedTransactions,
      account.sk
    );
    const submission = await submitTransactionGroup(algod, signed);
    assert.ok(submission.confirmedRound > 0n);

    const usdcAfter = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcAfter <= usdcBefore - SWAP_INPUT_MICRO_USDC - EXPECTED_X402_MICRO_USDC,
      `Expected at least 0.2 USDC total spend (before=${usdcBefore}, after=${usdcAfter}).`
    );
  }
);

async function fetchQuoteWithOptInRetry(params: {
  baseUrl: string;
  address: string;
  mnemonic: string;
  algodUrl: string;
  account: ReturnType<typeof accountFromMnemonic>;
  algod: ReturnType<typeof createAlgodClientFromEnv>;
}): Promise<ExecutionQuoteResponse> {
  try {
    return await fetchHogswapSwapQuote(params);
  } catch (error) {
    const assetIds = parseMissingOptInAssetIdsFromError(error);
    if (assetIds.length === 0) {
      throw error;
    }
    for (const assetId of assetIds) {
      await ensureAssetOptIn(params.account, params.algod, assetId);
    }
    return fetchHogswapSwapQuote(params);
  }
}

function fetchHogswapSwapQuote(params: {
  baseUrl: string;
  address: string;
  mnemonic: string;
  algodUrl: string;
}): Promise<ExecutionQuoteResponse> {
  return fetchPaidExecutionQuote({
    baseUrl: params.baseUrl,
    shapeKey: SWAP_SHAPE,
    input: {
      userAddress: params.address,
      fromAssetId: USDC_ASSET_ID,
      toAssetId: ALGO_ASSET_ID,
      amount: SWAP_INPUT_MICRO_USDC.toString(),
      maxSlippageBps: MAX_SLIPPAGE_BPS
    },
    clientMnemonic: params.mnemonic,
    algodUrl: params.algodUrl
  });
}

function parseMissingOptInAssetIdsFromError(error: unknown): number[] {
  const message = error instanceof Error ? error.message : String(error);
  const jsonMatch = /Body:\s*(\{[\s\S]*)/.exec(message);
  if (jsonMatch?.[1] !== undefined) {
    try {
      const body = JSON.parse(jsonMatch[1]) as {
        error?: { details?: { assetIds?: unknown } };
      };
      const assetIds = body.error?.details?.assetIds;
      if (Array.isArray(assetIds)) {
        return assetIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0);
      }
    } catch {
      // Fall through to the message parser.
    }
  }

  const listed = /Missing opt-in for asset\(s\):\s*([\d,\s]+)/i.exec(message);
  if (listed?.[1] === undefined) {
    return [];
  }
  return listed[1]
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}
