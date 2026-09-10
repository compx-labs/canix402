import assert from "node:assert/strict";
import test from "node:test";

import { fetchStammPools } from "../../src/services/hogswap-client.js";
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

const MINT_SHAPE = "mainnet:stamm:v1:mint:lp";
const REDEEM_SHAPE = "mainnet:stamm:v1:redeem:lp";

const DEFAULT_POOL_APP_ID = 3544790053;
const DEFAULT_TIER_INDEX = 1;
const MINT_ALGO_MICRO_AMOUNT = 100_000n;
const EXPECTED_X402_MICRO_USDC = 100_000n;
const MAX_SLIPPAGE_BPS = 100;

test(
  "mint then redeem STAMM LP through production execution quotes",
  { timeout: 180_000 },
  async (t) => {
    if (process.env.X402_STAMM_EXECUTION_LIVE !== "1") {
      t.skip(
        "Set X402_STAMM_EXECUTION_LIVE=1 to mint 0.1 ALGO of STAMM LP and redeem it on mainnet."
      );
      return;
    }

    const env = getLiveEnv();
    const baseUrl = getProductionBaseUrl();
    const mnemonic = requireClientMnemonic("npm run test:stamm-production");
    const account = accountFromMnemonic(mnemonic);
    const address = account.addr.toString();
    const algod = createAlgodClientFromEnv();
    const poolAppId = resolvePoolAppId();
    const tierIndex = resolveTierIndex();

    const usdcBefore = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcBefore >= EXPECTED_X402_MICRO_USDC * 2n,
      `Wallet requires at least 0.2 USDC for two execution quotes; balance is ${usdcBefore} micro-USDC.`
    );

    const catalogLpAssetId = await resolveStammLpAssetId(poolAppId, tierIndex);
    if (catalogLpAssetId !== undefined) {
      await ensureAssetOptIn(account, algod, catalogLpAssetId);
    }

    const algoBefore = await getAssetBalance(algod, address, ALGO_ASSET_ID);
    assert.ok(
      algoBefore > MINT_ALGO_MICRO_AMOUNT,
      `Wallet requires more than 0.1 ALGO for a one-sided mint; balance is ${algoBefore} microAlgos.`
    );

    const mintQuote = await fetchQuoteWithOptInRetry({
      baseUrl,
      mnemonic,
      algodUrl: env.algodUrl,
      account,
      algod,
      shapeKey: MINT_SHAPE,
      input: {
        userAddress: address,
        poolAppId,
        tierIndex,
        amountA: MINT_ALGO_MICRO_AMOUNT.toString(),
        amountB: "0",
        maxSlippageBps: MAX_SLIPPAGE_BPS
      }
    });
    assert.equal(mintQuote.data[0]?.shapeKey, MINT_SHAPE);

    const lpAssetId =
      parsePositiveInteger(mintQuote.data[0].metadata.lpAssetId) ?? catalogLpAssetId;
    assert.ok(
      lpAssetId !== undefined,
      "STAMM mint quote metadata is missing lpAssetId and the catalog did not resolve one."
    );

    const lpBefore = await getAssetBalance(algod, address, lpAssetId);
    const signedMint = signEncodedTransactionGroup(
      mintQuote.data[0].encodedTransactions,
      account.sk
    );
    const mintSubmission = await submitTransactionGroup(algod, signedMint);
    assert.ok(mintSubmission.confirmedRound > 0n);

    const lpAfterMint = await getAssetBalance(algod, address, lpAssetId);
    const mintedLp = lpAfterMint - lpBefore;
    const expectedLpOut = parsePositiveBigInt(mintQuote.data[0].metadata.expectedLpOut);
    assert.ok(
      mintedLp > 0n,
      `Expected LP balance to increase after mint (before=${lpBefore}, after=${lpAfterMint}, expectedLpOut=${expectedLpOut ?? "n/a"}).`
    );

    const redeemQuote = await fetchQuoteWithOptInRetry({
      baseUrl,
      mnemonic,
      algodUrl: env.algodUrl,
      account,
      algod,
      shapeKey: REDEEM_SHAPE,
      input: {
        userAddress: address,
        poolAppId,
        tierIndex,
        lpAmount: mintedLp.toString(),
        targetAsset: ALGO_ASSET_ID,
        maxSlippageBps: MAX_SLIPPAGE_BPS
      }
    });
    assert.equal(redeemQuote.data[0]?.shapeKey, REDEEM_SHAPE);

    const signedRedeem = signEncodedTransactionGroup(
      redeemQuote.data[0].encodedTransactions,
      account.sk
    );
    const redeemSubmission = await submitTransactionGroup(algod, signedRedeem);
    assert.ok(redeemSubmission.confirmedRound > 0n);

    const lpAfterRedeem = await getAssetBalance(algod, address, lpAssetId);
    assert.ok(
      lpAfterRedeem <= lpBefore,
      `Expected LP to return to the pre-mint balance (before=${lpBefore}, afterRedeem=${lpAfterRedeem}).`
    );

    const algoAfter = await getAssetBalance(algod, address, ALGO_ASSET_ID);
    assert.ok(
      algoAfter > algoBefore - MINT_ALGO_MICRO_AMOUNT,
      `Expected ALGO back minus fees/slippage (before=${algoBefore}, after=${algoAfter}).`
    );

    const usdcAfter = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcAfter <= usdcBefore - EXPECTED_X402_MICRO_USDC * 2n,
      `Expected at least 0.2 USDC x402 spend (before=${usdcBefore}, after=${usdcAfter}).`
    );
  }
);

function resolvePoolAppId(): number {
  const raw = process.env.X402_STAMM_POOL_APP_ID?.trim();
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_POOL_APP_ID;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("X402_STAMM_POOL_APP_ID must be a positive integer application id.");
  }
  return value;
}

function resolveTierIndex(): number {
  const raw = process.env.X402_STAMM_TIER_INDEX?.trim();
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_TIER_INDEX;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error("X402_STAMM_TIER_INDEX must be an integer 0–5.");
  }
  return value;
}

async function resolveStammLpAssetId(
  poolAppId: number,
  tierIndex: number
): Promise<number | undefined> {
  const pools = await fetchStammPools();
  const pool = pools.find((row) => parsePositiveInteger(row.pool_id) === poolAppId);
  if (pool === undefined) {
    return undefined;
  }
  const tiers = Array.isArray(pool.tier_breakdown) ? pool.tier_breakdown : [];
  for (const tier of tiers) {
    if (typeof tier !== "object" || tier === null) {
      continue;
    }
    const record = tier as Record<string, unknown>;
    if (parseNonNegativeInteger(record.index) !== tierIndex) {
      continue;
    }
    return parsePositiveInteger(record.lp_asset_id);
  }
  return undefined;
}

async function fetchQuoteWithOptInRetry(params: {
  baseUrl: string;
  mnemonic: string;
  algodUrl: string;
  account: ReturnType<typeof accountFromMnemonic>;
  algod: ReturnType<typeof createAlgodClientFromEnv>;
  shapeKey: string;
  input: Record<string, unknown>;
}): Promise<ExecutionQuoteResponse> {
  try {
    return await fetchPaidStammQuote(params);
  } catch (error) {
    const assetIds = parseMissingOptInAssetIdsFromError(error);
    if (assetIds.length === 0) {
      throw error;
    }
    for (const assetId of assetIds) {
      await ensureAssetOptIn(params.account, params.algod, assetId);
    }
    return fetchPaidStammQuote(params);
  }
}

function fetchPaidStammQuote(params: {
  baseUrl: string;
  mnemonic: string;
  algodUrl: string;
  shapeKey: string;
  input: Record<string, unknown>;
}): Promise<ExecutionQuoteResponse> {
  return fetchPaidExecutionQuote({
    baseUrl: params.baseUrl,
    shapeKey: params.shapeKey,
    input: params.input,
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

function parsePositiveInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parsePositiveBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint" && value > 0n) {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}
