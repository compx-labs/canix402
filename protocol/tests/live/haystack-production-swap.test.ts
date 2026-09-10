import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import type {
  MetaSwapQuote,
  SwapOptInResponse,
  SwapQuoteResponse,
  SwapTransactionsResponse
} from "../../src/types/swap-schema.js";
import {
  ALGO_ASSET_ID,
  USDC_ASSET_ID,
  accountFromMnemonic,
  createAlgodClientFromEnv,
  getAssetBalance,
  signEncodedTransactionGroup,
  submitTransactionGroup
} from "../helpers/algorandExecution.js";
import {
  assertPaidPreflight,
  executePaidJsonRequest,
  getAlgorandAccept,
  getLiveEnv,
  getProductionBaseUrl,
  loadLiveEnvFiles,
  requireClientMnemonic
} from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

const SWAP_INPUT_MICRO_USDC = 100_000n;
const EXPECTED_X402_MICRO_USDC = 5_000n;
const SLIPPAGE_PERCENT = 1;

test(
  "swap 0.1 USDC to ALGO through the production Haystack x402 route",
  { timeout: 120_000 },
  async (t) => {
    if (process.env.X402_HAYSTACK_SWAP_LIVE !== "1") {
      t.skip(
        "Set X402_HAYSTACK_SWAP_LIVE=1 to spend 0.1 USDC plus the 0.005 USDC x402 charge on mainnet."
      );
      return;
    }

    const env = getLiveEnv();
    const baseUrl = getProductionBaseUrl();
    const mnemonic = requireClientMnemonic("npm run test:haystack-production");
    const account = accountFromMnemonic(mnemonic);
    const address = account.addr.toString();
    const algod = createAlgodClientFromEnv();

    const initialQuote = await fetchQuote(baseUrl, address);
    await submitMissingOptIns(baseUrl, address, initialQuote.data, account.sk);

    // Opt-ins consume rounds and quotes are deliberately short-lived.
    const quoteResponse = await fetchQuote(baseUrl, address);
    assert.equal(quoteResponse.data.fromAssetId, String(USDC_ASSET_ID));
    assert.equal(quoteResponse.data.toAssetId, String(ALGO_ASSET_ID));
    assert.equal(quoteResponse.data.amount, String(SWAP_INPUT_MICRO_USDC));
    assert.equal(quoteResponse.data.type, "fixed-input");
    assert.ok(BigInt(quoteResponse.data.quotedAmount) > 0n);
    assert.equal(quoteResponse.data.router, "haystack");
    assert.ok(quoteResponse.data.payload);

    const requestBody = {
      address,
      quote: quoteResponse.data,
      slippage: SLIPPAGE_PERCENT
    };
    const paymentRequest = await assertPaidPreflight(
      baseUrl,
      "/swaps/transactions",
      { method: "POST", body: requestBody }
    );
    const accepted = getAlgorandAccept(paymentRequest);
    const paymentAmount = toMicroUsdc(
      accepted.maxAmountRequired ?? accepted.amount ?? "0"
    );
    assert.equal(accepted.asset, String(USDC_ASSET_ID));
    assert.equal(paymentAmount, EXPECTED_X402_MICRO_USDC);

    const usdcBefore = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcBefore >= SWAP_INPUT_MICRO_USDC + EXPECTED_X402_MICRO_USDC,
      `Wallet requires at least 0.105 USDC; balance is ${usdcBefore} micro-USDC.`
    );

    const paidResult = await executePaidJsonRequest({
      baseUrl,
      path: "/swaps/transactions",
      body: requestBody,
      clientMnemonic: mnemonic,
      algodUrl: env.algodUrl
    });
    assert.equal(paidResult.status, 200);
    assert.ok(paidResult.paymentResponseHeader);

    const swapResponse = paidResult.body as SwapTransactionsResponse;
    assert.equal(swapResponse.meta.paymentRequired, true);
    assert.equal(swapResponse.meta.executionSubmitted, false);
    assert.ok(swapResponse.data.transactions.length > 0);

    const signedGroup = swapResponse.data.transactions.map((member) => {
      if (member.signedTransaction !== undefined) {
        return new Uint8Array(Buffer.from(member.signedTransaction, "base64"));
      }

      const txn = algosdk.decodeUnsignedTransaction(
        Buffer.from(member.encodedTransaction, "base64")
      );
      return algosdk.signTransaction(txn, account.sk).blob;
    });

    const submission = await submitTransactionGroup(algod, signedGroup);
    assert.ok(submission.confirmedRound > 0n);

    const usdcAfter = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcAfter <=
        usdcBefore - SWAP_INPUT_MICRO_USDC - EXPECTED_X402_MICRO_USDC,
      `Expected at least 0.105 USDC total spend (before=${usdcBefore}, after=${usdcAfter}).`
    );
  }
);

async function fetchQuote(
  baseUrl: string,
  address: string
): Promise<SwapQuoteResponse> {
  return postFreeJson<SwapQuoteResponse>(baseUrl, "/swaps/quote", {
    address,
    fromAssetId: USDC_ASSET_ID,
    toAssetId: ALGO_ASSET_ID,
    amount: String(SWAP_INPUT_MICRO_USDC),
    type: "fixed-input",
    router: "haystack"
  });
}

async function submitMissingOptIns(
  baseUrl: string,
  address: string,
  quote: MetaSwapQuote,
  secretKey: Uint8Array
): Promise<void> {
  const response = await postFreeJson<SwapOptInResponse>(
    baseUrl,
    "/swaps/optin",
    { address, quote }
  );
  assert.equal(response.meta.executionSubmitted, false);
  if (!response.data.required) {
    return;
  }

  const signed = signEncodedTransactionGroup(
    response.data.transactions.map(({ encodedTransaction }) => encodedTransaction),
    secretKey
  );
  const algod = createAlgodClientFromEnv();
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);
}

async function postFreeJson<T>(
  baseUrl: string,
  path: string,
  body: unknown
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(
      `${path}: expected status 200, got ${response.status}. Body: ${text.slice(0, 400)}`
    );
  }
  return JSON.parse(text) as T;
}

function toMicroUsdc(value: string): bigint {
  if (!value.includes(".")) {
    return BigInt(value);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(`${fraction}000000`.slice(0, 6));
}
