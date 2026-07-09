import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig, hasWallet } from "../../src/lib/config.js";
import {
  decodePaymentRequiredHeader,
  microUsdcToUsdc,
  WalletRequiredError,
  X402Client
} from "../../src/lib/x402-client.js";
import { errorResult, jsonResult } from "../../src/lib/tool-result.js";
import { EXECUTION_SHAPES } from "../../src/lib/execution-shapes.js";

test("loadConfig defaults to production gateway", () => {
  const config = loadConfig({});
  assert.equal(config.apiUrl, "https://canix402-api.compx.io");
  assert.equal(config.network, "algorand-mainnet");
  assert.equal(hasWallet(config), false);
});

test("loadConfig accepts CANIX402 and X402 mnemonic aliases", () => {
  const config = loadConfig({
    CANIX402_API_URL: "http://localhost:8080/",
    X402_CLIENT_MNEMONIC: "abandon abandon abandon"
  });
  assert.equal(config.apiUrl, "http://localhost:8080");
  assert.equal(hasWallet(config), true);
});

test("microUsdcToUsdc converts integer micro amounts", () => {
  assert.equal(microUsdcToUsdc("10000"), "0.01");
  assert.equal(microUsdcToUsdc("100000"), "0.1");
  assert.equal(microUsdcToUsdc("0.05"), "0.05");
});

test("decodePaymentRequiredHeader requires accepts", () => {
  const payload = Buffer.from(
    JSON.stringify({
      accepts: [
        {
          scheme: "exact",
          network: "algorand-mainnet",
          asset: "31566704",
          payTo: "PAYTO",
          maxAmountRequired: "10000"
        }
      ]
    }),
    "utf-8"
  ).toString("base64");

  const decoded = decodePaymentRequiredHeader(payload);
  assert.equal(decoded.accepts[0]?.payTo, "PAYTO");
});

test("jsonResult and errorResult shapes", () => {
  const ok = jsonResult({ hello: "world" });
  assert.equal(ok.content[0]?.type, "text");
  assert.match(ok.content[0]?.text ?? "", /hello/);

  const walletError = errorResult(
    new WalletRequiredError("need wallet", null, "0.01")
  );
  assert.equal(walletError.isError, true);
  assert.match(walletError.content[0]?.text ?? "", /WALLET_REQUIRED/);
});

test("execution shapes catalog includes tinyman add and remove", () => {
  const keys = EXECUTION_SHAPES.map((shape) => shape.shapeKey);
  assert.ok(keys.includes("mainnet:tinyman:v2:addLiquidity:flexible"));
  assert.ok(keys.includes("mainnet:tinyman:v2:removeLiquidity:multipleAssetsOut"));
});

test("X402Client fetchFree returns JSON on 200", async () => {
  const client = new X402Client(
    {
      apiUrl: "https://example.test",
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
    },
    async () =>
      new Response(JSON.stringify({ data: { status: "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  );

  const body = (await client.fetchFree("/health")) as {
    data: { status: string };
  };
  assert.equal(body.data.status, "ok");
});

test("X402Client fetchPaid without wallet throws WalletRequiredError", async () => {
  const paymentRequired = {
    accepts: [
      {
        scheme: "exact",
        network: "algorand-mainnet",
        asset: "31566704",
        payTo: "PAYTO",
        maxAmountRequired: "10000"
      }
    ]
  };
  const header = Buffer.from(JSON.stringify(paymentRequired), "utf-8").toString(
    "base64"
  );

  const client = new X402Client(
    {
      apiUrl: "https://example.test",
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
    },
    async () =>
      new Response("payment required", {
        status: 402,
        headers: { "payment-required": header }
      })
  );

  await assert.rejects(
    () => client.fetchPaid("/opportunities", { estimatedPriceUsdc: "0.01" }),
    (error: unknown) => {
      assert.ok(error instanceof WalletRequiredError);
      assert.equal(error.estimatedPriceUsdc, "0.01");
      return true;
    }
  );
});

test("X402Client fetchPaid returns body when gateway allows unpaid 200", async () => {
  const client = new X402Client(
    {
      apiUrl: "https://example.test",
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
    },
    async () =>
      new Response(JSON.stringify({ data: [{ id: "opp-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  );

  const result = await client.fetchPaid("/opportunities");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { data: [{ id: "opp-1" }] });
});

test("X402Client fetchPaid POST preserves JSON body on unpaid 200", async () => {
  let seenMethod: string | undefined;
  let seenBody: string | undefined;

  const client = new X402Client(
    {
      apiUrl: "https://example.test",
      algodUrl: "https://algod.test",
      network: "algorand-mainnet",
      walletMnemonic: undefined
    },
    async (_input, init) => {
      seenMethod = init?.method;
      seenBody = typeof init?.body === "string" ? init.body : undefined;
      return new Response(JSON.stringify({ data: { shapeKey: "x" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  );

  const result = await client.fetchPaid("/execution/quotes", {
    method: "POST",
    body: { shapeKey: "mainnet:tinyman:v2:addLiquidity:flexible", input: {} }
  });

  assert.equal(seenMethod, "POST");
  assert.match(seenBody ?? "", /shapeKey/);
  assert.equal(result.status, 200);
});
