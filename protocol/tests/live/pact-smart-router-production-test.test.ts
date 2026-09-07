import assert from "node:assert/strict";
import test from "node:test";

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
  fetchPaidExecutionQuote,
  getLiveEnv,
  getProductionBaseUrl,
  loadLiveEnvFiles,
  requireClientMnemonic
} from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

const SWAP_SHAPE = "mainnet:pact:smart-router:swap:fixed-input";
const SWAP_INPUT_MICRO_USDC = 100_000n;
const EXPECTED_X402_MICRO_USDC = 100_000n;
const MAX_SLIPPAGE_BPS = 50;

test(
  "swap 0.1 USDC to ALGO through the production Pact Smart Router",
  { timeout: 180_000 },
  async (t) => {
    if (process.env.X402_PACT_SMART_ROUTER_LIVE !== "1") {
      t.skip(
        "Set X402_PACT_SMART_ROUTER_LIVE=1 to spend 0.1 USDC plus the 0.1 USDC x402 quote charge on mainnet."
      );
      return;
    }

    const env = getLiveEnv();
    const baseUrl = getProductionBaseUrl();
    const mnemonic = requireClientMnemonic("npm run test:pact-smart-router-production");
    const account = accountFromMnemonic(mnemonic);
    const address = account.addr.toString();
    const algod = createAlgodClientFromEnv();

    const usdcBefore = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcBefore >= SWAP_INPUT_MICRO_USDC + EXPECTED_X402_MICRO_USDC,
      `Wallet requires at least 0.2 USDC; balance is ${usdcBefore} micro-USDC.`
    );

    const quoteResponse = await fetchPaidExecutionQuote({
      baseUrl,
      shapeKey: SWAP_SHAPE,
      input: {
        userAddress: address,
        fromAssetId: USDC_ASSET_ID,
        toAssetId: ALGO_ASSET_ID,
        amount: SWAP_INPUT_MICRO_USDC.toString(),
        maxSlippageBps: MAX_SLIPPAGE_BPS
      },
      clientMnemonic: mnemonic,
      algodUrl: env.algodUrl
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
