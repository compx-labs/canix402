/**
 * Mainnet simulate of a Haystack token launch.
 *
 * Builds the real `mainnet:haystack:v1:launch:token` group against mainnet algod,
 * then asks algod to simulate that unsigned group. Nothing is signed and nothing
 * is submitted, so no ASA is created.
 *
 *   X402_HAYSTACK_LAUNCH_LIVE=1 npm run test:haystack-launch-simulate
 *
 * Optional:
 *   X402_ALGOD_URL, X402_ALGOD_TOKEN
 *   X402_HAYSTACK_LAUNCH_SENDER  funded address used only as `from` (no key)
 */
import assert from "node:assert/strict";
import test from "node:test";

import algosdk, { Algodv2 } from "algosdk";

import { TransactionShapeRegistry, compileExecutableQuote } from "../../src/execution/index.js";
import type { ExecutableQuote } from "../../src/execution/index.js";
import {
  HAYSTACK_LAUNCH_APP_ID,
  LAUNCH_FIELD_BYTES
} from "../../src/execution/shapes/haystack/launch-constants.js";
import { readLaunchGlobal, readTokenInfoBox } from "../../src/execution/shapes/haystack/launch-chain.js";
import { haystackLaunchTokenShape } from "../../src/execution/shapes/haystack/launch-token.js";
import {
  GAS_METHOD_SELECTOR_HEX,
  LAUNCH_TOKEN_SELECTOR_HEX,
  LAUNCH_TOKEN_THEN_BUY_ALGO_SELECTOR_HEX,
  LAUNCH_TOKEN_THEN_BUY_SELECTOR_HEX
} from "../../src/execution/shapes/haystack/launch-spec.js";
import { readAppCallSelectorHex } from "../../src/execution/shapes/haystack/shared.js";

const LIVE = process.env.X402_HAYSTACK_LAUNCH_LIVE === "1";
const ALGOD_URL = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
const ALGOD_TOKEN = process.env.X402_ALGOD_TOKEN ?? "";

/** Metadata that fits the HayLaunch byte caps. `0` selects the contract defaults. */
const LAUNCH_METADATA = {
  symbol: "CNXSIM",
  name: "Canix Simulate",
  assetUrl: "ipfs://bafkreicanix402simulatelaunchonly",
  description: "Canix mainnet simulate only. This launch is not submitted.",
  socialWebsite: "https://canix402.compx.io",
  socialX: "https://x.com/canix402",
  socialTelegram: "https://t.me/canix402",
  socialDiscord: "https://discord.gg/canix",
  bondingTokenId: 0,
  targetBondingUsd: "0",
  priceMultiplier: "0"
} as const;

const MIN_SENDER_MICROALGOS = 3_000_000n;

test(
  "simulates a Haystack token launch on mainnet without submitting",
  { skip: LIVE ? false : "set X402_HAYSTACK_LAUNCH_LIVE=1", timeout: 120_000 },
  async () => {
    assertMetadataFits();

    const algod = new Algodv2(ALGOD_TOKEN, ALGOD_URL, "");
    const appAddress = algosdk.getApplicationAddress(HAYSTACK_LAUNCH_APP_ID).toString();
    const before = await readLaunchGlobal(algod);
    const reservedTokenNum = before.nextTokenNum;
    assert.equal(
      await readTokenInfoBox(algod, reservedTokenNum),
      null,
      `token ${reservedTokenNum} already exists; nextTokenNum moved`
    );

    const sender = await resolveSender(algod);
    const registry = new TransactionShapeRegistry();
    registry.register(haystackLaunchTokenShape);
    const quote = await compileExecutableQuote(
      registry,
      haystackLaunchTokenShape.key,
      { userAddress: sender, ...LAUNCH_METADATA },
      { network: "mainnet", algod, now: () => Date.now() }
    );

    assert.equal(quote.shapeKey, haystackLaunchTokenShape.key);
    assert.equal(quote.transactions.length, quote.encodedTransactions.length);
    assert.ok(quote.transactions.length >= 4);
    assertUnsigned(quote);

    const selectors = quote.transactions.map((txn) => readAppCallSelectorHex(txn));
    assert.equal(selectors.filter((value) => value === GAS_METHOD_SELECTOR_HEX).length, 2);
    assert.equal(selectors.filter((value) => value === LAUNCH_TOKEN_SELECTOR_HEX).length, 1);
    assert.equal(selectors.includes(LAUNCH_TOKEN_THEN_BUY_SELECTOR_HEX), false);
    assert.equal(selectors.includes(LAUNCH_TOKEN_THEN_BUY_ALGO_SELECTOR_HEX), false);

    const launchCall = quote.transactions.find(
      (txn) => readAppCallSelectorHex(txn) === LAUNCH_TOKEN_SELECTOR_HEX
    );
    const encodedArgs = Buffer.concat(
      (launchCall?.applicationCall?.appArgsBase64 ?? []).map((arg) => Buffer.from(arg, "base64"))
    );
    for (const field of [
      LAUNCH_METADATA.symbol,
      LAUNCH_METADATA.name,
      LAUNCH_METADATA.assetUrl,
      LAUNCH_METADATA.description,
      LAUNCH_METADATA.socialWebsite,
      LAUNCH_METADATA.socialX,
      LAUNCH_METADATA.socialTelegram,
      LAUNCH_METADATA.socialDiscord
    ]) {
      assert.ok(encodedArgs.includes(Buffer.from(field)), `launch app args missing ${field}`);
    }

    const mbrPayment = quote.transactions.find(
      (txn) => txn.type === "pay" && txn.payment?.receiver === appAddress
    );
    assert.ok(mbrPayment, "launch group is missing the MBR payment to the app");
    assert.ok(BigInt(mbrPayment.payment?.amount ?? "0") > 0n);

    const simulated = await algod
      .simulateTransactions(
        new algosdk.modelsv2.SimulateRequest({
          txnGroups: [
            new algosdk.modelsv2.SimulateRequestTransactionGroup({
              txns: quote.encodedTransactions.map((encoded) => {
                return new algosdk.SignedTransaction({
                  txn: algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"))
                });
              })
            })
          ],
          allowEmptySignatures: true,
          allowUnnamedResources: true
        })
      )
      .do();

    const group = simulated.txnGroups[0];
    assert.ok(group, "algod returned no simulated group");
    assert.equal(
      group.failureMessage,
      undefined,
      group.failureMessage ?? "launch simulation failed"
    );

    const afterBox = await readTokenInfoBox(algod, reservedTokenNum);
    assert.equal(
      afterBox,
      null,
      afterBox === null
        ? ""
        : `token ${reservedTokenNum} exists after simulate (creator ${afterBox.tokenCreator}). This test does not submit.`
    );
  }
);

function assertMetadataFits(): void {
  for (const [field, maxBytes] of Object.entries(LAUNCH_FIELD_BYTES)) {
    const value = LAUNCH_METADATA[field as keyof typeof LAUNCH_FIELD_BYTES];
    assert.ok(value.length > 0, `${field} is empty`);
    assert.ok(
      Buffer.byteLength(value) <= maxBytes,
      `${field} is ${Buffer.byteLength(value)} bytes; cap is ${maxBytes}`
    );
  }
  assert.ok(LAUNCH_METADATA.assetUrl.startsWith("ipfs://"));
}

function assertUnsigned(quote: ExecutableQuote): void {
  for (const encoded of quote.encodedTransactions) {
    const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"));
    assert.ok(txn.group, "launch transaction is not grouped");
  }
}

async function resolveSender(algod: Algodv2): Promise<string> {
  const override = process.env.X402_HAYSTACK_LAUNCH_SENDER?.trim();
  const sender =
    override && override.length > 0 ? override : await readAppCreator(algod);
  const info = await algod.accountInformation(sender).do();
  const balance = BigInt(info.amount);
  assert.ok(
    balance >= MIN_SENDER_MICROALGOS,
    `${sender} holds ${balance} microALGO; a launch simulate needs the MBR (~2.35 ALGO). Set X402_HAYSTACK_LAUNCH_SENDER.`
  );
  return sender;
}

async function readAppCreator(algod: Algodv2): Promise<string> {
  const application = await algod.getApplicationByID(HAYSTACK_LAUNCH_APP_ID).do();
  return addressText(application.params?.creator);
}

function addressText(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return algosdk.encodeAddress(value);
  }
  if (value && typeof value === "object" && "publicKey" in value) {
    return algosdk.encodeAddress((value as { publicKey: Uint8Array }).publicKey);
  }
  throw new Error("HayLaunch application creator was not an address.");
}
