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
