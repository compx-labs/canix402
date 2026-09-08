import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  META_SWAP_ROUTER_IDS,
  type MetaSwapQuote,
  type MetaSwapRouterId,
  type SwapOptInResponse,
  type SwapQuoteResponse,
  type SwapTransactionsResponse
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
const ROUTER_SET = new Set<string>(META_SWAP_ROUTER_IDS);

test(
  "quote 0.1 USDC to ALGO through the production multi-router compare",
  { timeout: 60_000 },
  async (t) => {
    if (
      process.env.X402_META_SWAP_LIVE !== "1" &&
      process.env.X402_META_SWAP_QUOTE_LIVE !== "1"
    ) {
      t.skip(
        "Set X402_META_SWAP_QUOTE_LIVE=1 to probe production /swaps/quote without submitting."
      );
      return;
    }

    const baseUrl = getProductionBaseUrl();
    const mnemonic = requireClientMnemonic("npm run test:meta-swap-production");
    const address = accountFromMnemonic(mnemonic).addr.toString();
    const routerOverride = optionalRouterOverride();
    const quoteResponse = await fetchQuote(baseUrl, address, routerOverride);
    assert.equal(quoteResponse.meta.executionSubmitted, false);
    assert.equal(quoteResponse.meta.paymentRequired, false);
    assertMetaQuoteEnvelope(quoteResponse.data, routerOverride);
    console.log(
      JSON.stringify(
        {
          probe: "meta-swap-quote",
          baseUrl,
          address,
          winner: quoteResponse.data.router,
          quotedAmount: quoteResponse.data.quotedAmount,
          minOut: quoteResponse.data.minOut,
          alternatives: quoteResponse.data.alternatives
        },
        null,
        2
      )
    );
  }
);

test(
  "swap 0.1 USDC to ALGO through the production multi-router x402 route",
  { timeout: 180_000 },
  async (t) => {
    if (process.env.X402_META_SWAP_LIVE !== "1") {
      t.skip(
        "Set X402_META_SWAP_LIVE=1 to spend 0.1 USDC plus the 0.005 USDC x402 charge on mainnet."
      );
      return;
    }

    const env = getLiveEnv();
    const baseUrl = getProductionBaseUrl();
    const mnemonic = requireClientMnemonic("npm run test:meta-swap-production");
    const account = accountFromMnemonic(mnemonic);
    const address = account.addr.toString();
    const algod = createAlgodClientFromEnv();
    const routerOverride = optionalRouterOverride();

    const initialQuote = await fetchQuote(baseUrl, address, routerOverride);
    await submitMissingOptIns(baseUrl, address, initialQuote.data, account.sk);

    const quoteResponse = await fetchQuote(baseUrl, address, routerOverride);
    assertMetaQuoteEnvelope(quoteResponse.data, routerOverride);
    console.log(
      JSON.stringify(
        {
          probe: "meta-swap-production",
          baseUrl,
          address,
          winner: quoteResponse.data.router,
          quotedAmount: quoteResponse.data.quotedAmount,
          minOut: quoteResponse.data.minOut,
          alternatives: quoteResponse.data.alternatives
        },
        null,
        2
      )
    );

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
    assert.equal(swapResponse.data.router, quoteResponse.data.router);
    assert.ok(swapResponse.data.transactions.length > 0);

    const signedGroup = signWinnerGroup(swapResponse.data.transactions, account.sk);
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

function optionalRouterOverride(): MetaSwapRouterId | undefined {
  const raw = process.env.X402_META_SWAP_ROUTER?.trim();
  if (!raw) {
    return undefined;
  }
  if (!ROUTER_SET.has(raw)) {
    throw new Error(
      `X402_META_SWAP_ROUTER must be one of: ${META_SWAP_ROUTER_IDS.join(", ")}.`
    );
  }
  return raw as MetaSwapRouterId;
}

function assertMetaQuoteEnvelope(
  quote: MetaSwapQuote,
  routerOverride: MetaSwapRouterId | undefined
): void {
  assert.equal(quote.fromAssetId, String(USDC_ASSET_ID));
  assert.equal(quote.toAssetId, String(ALGO_ASSET_ID));
  assert.equal(quote.amount, String(SWAP_INPUT_MICRO_USDC));
  assert.equal(quote.type, "fixed-input");
  assert.ok(BigInt(quote.quotedAmount) > 0n);
  assert.ok(BigInt(quote.minOut) > 0n);
  assert.ok(quote.payload);
  assert.equal(
    "txnPayload" in quote,
    false,
    "Meta quote must not expose the legacy Haystack txnPayload field."
  );
  assert.ok(ROUTER_SET.has(quote.router), `Unexpected winner ${quote.router}.`);
  if (routerOverride !== undefined) {
    assert.equal(quote.router, routerOverride);
  }

  assert.ok(quote.alternatives.length > 0, "Meta quote must include alternatives.");
  if (routerOverride === undefined) {
    assert.ok(
      quote.alternatives.length >= 2,
      `Compare must attempt more than one router; got ${quote.alternatives.length}.`
    );
  }

  const routers = new Set<string>();
  for (const row of quote.alternatives) {
    assert.ok(ROUTER_SET.has(row.router), `Unexpected alternative ${row.router}.`);
    assert.equal(routers.has(row.router), false, `Duplicate alternative ${row.router}.`);
    routers.add(row.router);
  }

  const winnerRow = quote.alternatives.find((row) => row.router === quote.router);
  assert.ok(winnerRow, "Winner must appear in alternatives.");
  assert.equal(winnerRow.status, "quoted");
  assert.equal(winnerRow.expectedNetOut, quote.quotedAmount);
}

async function fetchQuote(
  baseUrl: string,
  address: string,
  router: MetaSwapRouterId | undefined
): Promise<SwapQuoteResponse> {
  const body: Record<string, unknown> = {
    address,
    fromAssetId: USDC_ASSET_ID,
    toAssetId: ALGO_ASSET_ID,
    amount: String(SWAP_INPUT_MICRO_USDC),
    type: "fixed-input",
    slippage: SLIPPAGE_PERCENT
  };
  if (router !== undefined) {
    body.router = router;
  }
  return postFreeJson<SwapQuoteResponse>(baseUrl, "/swaps/quote", body);
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

function signWinnerGroup(
  transactions: SwapTransactionsResponse["data"]["transactions"],
  secretKey: Uint8Array
): Uint8Array[] {
  return transactions.map((member) => {
    if (member.signedTransaction !== undefined) {
      return new Uint8Array(Buffer.from(member.signedTransaction, "base64"));
    }
    if (member.signer !== "user") {
      throw new Error(
        `Winner returned unsigned ${member.signer} member at index ${member.index}.`
      );
    }
    const txn = algosdk.decodeUnsignedTransaction(
      Buffer.from(member.encodedTransaction, "base64")
    );
    return algosdk.signTransaction(txn, secretKey).blob;
  });
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
