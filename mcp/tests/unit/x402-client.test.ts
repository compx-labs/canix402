import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../../src/lib/config.js";
import {
  decodePaymentRequiredHeader,
  microUsdcToUsdc,
  X402Client
} from "../../src/lib/x402-client.js";
import { errorResult, jsonResult } from "../../src/lib/tool-result.js";
import { EXECUTION_SHAPES } from "../../src/lib/execution-shapes.js";

test("loadConfig defaults to production gateway", () => {
  const config = loadConfig({});
  assert.equal(config.apiUrl, "https://canix402-api.compx.io");
  assert.equal(config.network, "algorand-mainnet");
});

test("loadConfig accepts CANIX402 and X402 base URL aliases", () => {
  const config = loadConfig({
    CANIX402_API_URL: "http://localhost:8080/",
    X402_PRODUCTION_BASE_URL: "https://prod.example/"
  });
  assert.equal(config.apiUrl, "http://localhost:8080");
  assert.equal(loadConfig({ X402_PRODUCTION_BASE_URL: "https://prod.example/" }).apiUrl, "https://prod.example");
});

test("microUsdcToUsdc converts integer micro amounts", () => {
  assert.equal(microUsdcToUsdc("5000"), "0.005");
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

  const clientError = errorResult(new Error("boom"));
  assert.equal(clientError.isError, true);
  assert.match(clientError.content[0]?.text ?? "", /INTERNAL_ERROR/);
});

test("execution shapes catalog includes tinyman add and remove", () => {
  const keys = EXECUTION_SHAPES.map((shape) => shape.shapeKey);
  assert.ok(keys.includes("mainnet:tinyman:v2:addLiquidity:flexible"));
  assert.ok(keys.includes("mainnet:tinyman:v2:removeLiquidity:multipleAssetsOut"));
  assert.ok(keys.includes("mainnet:pact:v1:addLiquidity:twoSided"));
  assert.ok(keys.includes("mainnet:pact:v1:removeLiquidity:proportional"));
  assert.ok(keys.includes("mainnet:compx:v1:deposit:asa"));
  assert.ok(keys.includes("mainnet:compx:v1:withdraw:asa"));
  assert.ok(keys.includes("mainnet:compx:v1:stake:asa"));
  assert.ok(keys.includes("mainnet:compx:v1:unstake:asa"));
  assert.ok(keys.includes("mainnet:compx:v1:claim:rewards"));
  assert.ok(keys.includes("mainnet:dorkfi:v1:deposit:asa"));
  assert.ok(keys.includes("mainnet:dorkfi:v1:withdraw:asa"));
});

test("X402Client fetchFree returns JSON on 200", async () => {
  const client = new X402Client(
    {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
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

test("X402Client fetchPaid returns 402 preflight metadata", async () => {
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
      network: "algorand-mainnet"
    },
    async () =>
      new Response("payment required", {
        status: 402,
        headers: { "payment-required": header }
      })
  );

  const result = await client.fetchPaid("/opportunities");
  assert.equal(result.status, 402);
  assert.equal(result.paymentRequiredHeader, header);
  assert.equal(result.paymentRequired?.accepts[0]?.payTo, "PAYTO");
});

test("X402Client fetchPaid forwards provided payment signature", async () => {
  let seenSignature = "";
  const client = new X402Client(
    {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
    },
    async (_input, init) => {
      seenSignature = String(init?.headers && (init.headers as Record<string, string>)["PAYMENT-SIGNATURE"]);
      return new Response(JSON.stringify({ data: [{ id: "opp-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json", "payment-response": "ok" }
      });
    }
  );

  const result = await client.fetchPaid("/opportunities", {
    paymentSignature: "signed-payload"
  });
  assert.equal(seenSignature, "signed-payload");
  assert.equal(result.status, 200);
  assert.equal(result.paymentResponseHeader, "ok");
});

test("X402Client fetchPaid returns body when gateway allows unpaid 200", async () => {
  const client = new X402Client(
    {
      apiUrl: "https://example.test",
      network: "algorand-mainnet"
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
      network: "algorand-mainnet"
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
