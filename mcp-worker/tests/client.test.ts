import assert from "node:assert/strict";
import test from "node:test";

import { GatewayClient } from "../src/client.js";

function encodePaymentRequired(amount = "10000"): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "algorand-mainnet",
          asset: "31566704",
          payTo: "PAYTO",
          maxAmountRequired: amount
        }
      ]
    }),
    "utf-8"
  ).toString("base64");
}

test("default fetch preserves the Cloudflare runtime receiver", async () => {
  const originalFetch = globalThis.fetch;
  let fetchThis: unknown;

  globalThis.fetch = (async function (this: unknown) {
    fetchThis = this;
    return new Response(JSON.stringify({ data: { status: "ok" } }), { status: 200 });
  }) as typeof fetch;

  try {
    const client = new GatewayClient({ gatewayUrl: "https://gateway.example" });
    const result = await client.fetchFree("/health");

    assert.notEqual(fetchThis, client);
    assert.deepEqual(result, { data: { status: "ok" } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchPaid decodes payment requirements without Node Buffer", async () => {
  const paymentHeader = encodePaymentRequired();
  const bufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  assert.ok(bufferDescriptor);
  Object.defineProperty(globalThis, "Buffer", {
    value: undefined,
    configurable: true,
    writable: true
  });

  try {
    const client = new GatewayClient(
      { gatewayUrl: "https://gateway.example" },
      async () =>
        ({
          status: 402,
          text: async () => "payment required",
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "payment-required" ? paymentHeader : null
          }
        }) as Response
    );

    const result = await client.fetchPaid("/opportunities");
    assert.equal(result.paymentRequired?.accepts[0]?.payTo, "PAYTO");
  } finally {
    Object.defineProperty(globalThis, "Buffer", bufferDescriptor);
  }
});

test("fetchPaid returns 402 payment requirement details", async () => {
  const paymentHeader = encodePaymentRequired();
  const client = new GatewayClient(
    { gatewayUrl: "https://gateway.example" },
    async () =>
      new Response("payment required", {
        status: 402,
        headers: { "payment-required": paymentHeader }
      })
  );

  const result = await client.fetchPaid("/opportunities");
  assert.equal(result.status, 402);
  assert.equal(result.paymentRequiredHeader, paymentHeader);
  assert.equal(result.paymentRequired?.accepts[0]?.payTo, "PAYTO");
});

test("fetchPaid forwards PAYMENT-SIGNATURE on retry", async () => {
  let seenSignature = "";
  const client = new GatewayClient(
    { gatewayUrl: "https://gateway.example" },
    async (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seenSignature = headers?.["PAYMENT-SIGNATURE"] ?? "";
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
