import assert from "node:assert/strict";
import test from "node:test";

import { productionPaidEndpoints } from "../helpers/productionEndpoints.js";
import {
  assertPaidPreflight,
  assertProductionFreeEndpoints,
  executePaidRequest,
  getLiveEnv,
  getProductionBaseUrl,
  loadLiveEnvFiles,
  requireClientMnemonic
} from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

test("production free endpoints return 200", async () => {
  await assertProductionFreeEndpoints(getProductionBaseUrl());
});

test("production paid endpoints return 402 preflight", async () => {
  const baseUrl = getProductionBaseUrl();

  for (const endpoint of productionPaidEndpoints) {
    const paymentRequest = await assertPaidPreflight(baseUrl, endpoint.path, {
      method: endpoint.method,
      body: endpoint.body
    });
    assert.ok(
      Array.isArray(paymentRequest.accepts) && paymentRequest.accepts.length > 0,
      `${endpoint.path}: PAYMENT-REQUIRED missing accepts`
    );
  }
});

test(
  "production paid endpoints settle via deployed gateway when opted in",
  async (t) => {
    if (process.env.X402_PRODUCTION_PAID_TEST !== "1") {
      t.skip("Set X402_PRODUCTION_PAID_TEST=1 to run real paid production requests.");
      return;
    }

    const env = getLiveEnv();
    const clientMnemonic = requireClientMnemonic("npm run test:x402-production");
    const baseUrl = getProductionBaseUrl();

    for (const endpoint of productionPaidEndpoints) {
      const result = await executePaidRequest({
        baseUrl,
        path: endpoint.path,
        clientMnemonic,
        algodUrl: env.algodUrl
      });

      assert.equal(result.status, 200);
      assert.ok(result.paymentResponseHeader);
    }
  }
);
