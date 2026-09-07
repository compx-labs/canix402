import assert from "node:assert/strict";
import test from "node:test";

import type { FolksSwapQuote } from "../../src/types/swap-schema.js";
import { createFolksRouterService } from "../../src/services/folks-router.js";
import {
  ALGO_ASSET_ID,
  USDC_ASSET_ID,
  accountFromMnemonic,
  createAlgodClientFromEnv,
  getAssetBalance,
  signEncodedTransactionGroup,
  submitTransactionGroup
} from "../helpers/algorandExecution.js";
import { loadLiveEnvFiles, requireClientMnemonic } from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

const SWAP_INPUT_MICRO_USDC = 100_000n;
const SLIPPAGE_PERCENT = 1;

test(
  "swap 0.1 USDC to ALGO through the Folks Router service",
  { timeout: 120_000 },
  async (t) => {
    if (process.env.X402_FOLKS_ROUTER_SWAP_LIVE !== "1") {
      t.skip(
        "Set X402_FOLKS_ROUTER_SWAP_LIVE=1 to spend 0.1 USDC on a mainnet Folks Router swap (service-level, no x402)."
      );
      return;
    }

    const mnemonic = requireClientMnemonic("npm run test:folks-router-production");
    const account = accountFromMnemonic(mnemonic);
    const address = account.addr.toString();
    const algod = createAlgodClientFromEnv();
    const service = createFolksRouterService();

    const initialQuote = await service.getQuote({
      address,
      fromAssetId: USDC_ASSET_ID,
      toAssetId: ALGO_ASSET_ID,
      amount: String(SWAP_INPUT_MICRO_USDC),
      type: "fixed-input"
    });
    await submitMissingOptIns(service, address, initialQuote, account.sk);

    const quote = await service.getQuote({
      address,
      fromAssetId: USDC_ASSET_ID,
      toAssetId: ALGO_ASSET_ID,
      amount: String(SWAP_INPUT_MICRO_USDC),
      type: "fixed-input"
    });
    assert.equal(quote.source, "folks-router");
    assert.equal(quote.apiVersion, "v2");
    assert.equal(quote.fromAssetId, String(USDC_ASSET_ID));
    assert.equal(quote.toAssetId, String(ALGO_ASSET_ID));
    assert.equal(quote.amount, String(SWAP_INPUT_MICRO_USDC));
    assert.equal(quote.type, "fixed-input");
    assert.ok(BigInt(quote.quotedAmount) > 0n);
    assert.ok(quote.txnPayload);

    const usdcBefore = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcBefore >= SWAP_INPUT_MICRO_USDC,
      `Wallet requires at least 0.1 USDC; balance is ${usdcBefore} micro-USDC.`
    );

    const swapGroup = await service.buildSwapTransactions(address, quote, SLIPPAGE_PERCENT);
    assert.equal(swapGroup.source, "folks-router");
    assert.ok(swapGroup.transactions.length > 0);
    assert.ok(swapGroup.transactions.every((member) => member.signer === "user"));

    const signed = signEncodedTransactionGroup(
      swapGroup.transactions.map(({ encodedTransaction }) => encodedTransaction),
      account.sk
    );
    const submission = await submitTransactionGroup(algod, signed);
    assert.ok(submission.confirmedRound > 0n);

    const usdcAfter = await getAssetBalance(algod, address, USDC_ASSET_ID);
    assert.ok(
      usdcAfter <= usdcBefore - SWAP_INPUT_MICRO_USDC,
      `Expected at least 0.1 USDC spend (before=${usdcBefore}, after=${usdcAfter}).`
    );
  }
);

async function submitMissingOptIns(
  service: ReturnType<typeof createFolksRouterService>,
  address: string,
  quote: FolksSwapQuote,
  secretKey: Uint8Array
): Promise<void> {
  const response = await service.buildOptIns(address, quote);
  if (!response.required) {
    return;
  }

  const signed = signEncodedTransactionGroup(
    response.transactions.map(({ encodedTransaction }) => encodedTransaction),
    secretKey
  );
  const algod = createAlgodClientFromEnv();
  const submission = await submitTransactionGroup(algod, signed);
  assert.ok(submission.confirmedRound > 0n);
}
