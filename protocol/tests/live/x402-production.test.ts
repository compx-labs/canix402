import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLivePaymentSignature,
  decodePaymentRequiredHeader,
  getLiveEnv,
  getProductionBaseUrl,
  loadLiveEnvFiles,
  requireClientMnemonic
} from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

test("production x402 preflight returns 402 + payment requirements", async () => {
  const baseUrl = getProductionBaseUrl();
  const response = await fetch(`${baseUrl}/opportunities`);
  assert.equal(response.status, 402);

  const paymentRequiredHeader = response.headers.get("payment-required");
  assert.ok(paymentRequiredHeader);

  const paymentRequest = decodePaymentRequiredHeader(paymentRequiredHeader);
  assert.ok(Array.isArray(paymentRequest.accepts) && paymentRequest.accepts.length > 0);
});

test(
  "production x402 paid request settles via deployed gateway and returns data",
  async (t) => {
    if (process.env.X402_PRODUCTION_PAID_TEST !== "1") {
      t.skip("Set X402_PRODUCTION_PAID_TEST=1 to run a real paid production request.");
      return;
    }

    const env = getLiveEnv();
    const clientMnemonic = requireClientMnemonic("npm run test:x402-production");
    const baseUrl = getProductionBaseUrl();
    const paidPath = "/opportunities";
    const requestUrl = `${baseUrl}${paidPath}`;

    const preflight = await fetch(requestUrl);
    assert.equal(preflight.status, 402);

    const paymentRequiredHeader = preflight.headers.get("payment-required");
    assert.ok(paymentRequiredHeader);

    const paymentRequest = decodePaymentRequiredHeader(paymentRequiredHeader);
    const paymentSignature = await buildLivePaymentSignature({
      paymentRequest,
      requestUrl,
      clientMnemonic,
      algodUrl: env.algodUrl
    });

    const paidResponse = await fetch(requestUrl, {
      headers: {
        "PAYMENT-SIGNATURE": paymentSignature
      }
    });
    const paidBody = await paidResponse.text();

    assert.equal(
      paidResponse.status,
      200,
      `Expected paid response status 200; got ${paidResponse.status}. Body: ${paidBody.slice(0, 400)}`
    );
    assert.ok(paidResponse.headers.get("payment-response"));

    const parsed = JSON.parse(paidBody) as {
      data?: unknown[];
    };
    assert.ok(Array.isArray(parsed.data));
    assert.ok(parsed.data.length > 0);
  }
);
