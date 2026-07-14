import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FastifyInstance } from "fastify";

import { buildApp } from "../../src/app.js";
import { isPaidEndpoint } from "../../src/services/payment-policy.js";
import {
  X402PaymentSignaturePayload,
  encodePaymentSignature,
  validatePaymentSignatureHeader
} from "../helpers/x402Payload.js";

interface PaymentFixtureSet {
  valid: X402PaymentSignaturePayload;
  expired: X402PaymentSignaturePayload;
  malformedMissingPaymentGroup: unknown;
}

const PAYMENT_REQUIRED_REQUIREMENTS = {
  scheme: "exact",
  network: "algorand-mainnet",
  asset: "31566704",
  payTo: "REPLACE_WITH_PAYTO_ADDRESS",
  maxAmountRequired: "10000",
  resource: "https://api.canix402.local/opportunities"
};

const fixtures = readFixtureSet();

test("successful paid request with valid PAYMENT-SIGNATURE returns 200", async () => {
  const app = await buildEdgeGatedApp();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities",
    headers: {
      "payment-signature": encodePaymentSignature(fixtures.valid)
    }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().meta.paymentRequired, true);

  await app.close();
});

test("missing payment signature on paid route returns 402", async () => {
  const app = await buildEdgeGatedApp();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities"
  });

  assert.equal(response.statusCode, 402);
  assert.equal(response.headers["payment-required"] !== undefined, true);
  assert.equal(response.json().error.code, "MISSING_PAYMENT_SIGNATURE");

  await app.close();
});

test("filtered opportunities route requires payment signature", async () => {
  const app = await buildEdgeGatedApp();

  const response = await app.inject({
    method: "GET",
    url: "/opportunities/search?platform=compx"
  });

  assert.equal(response.statusCode, 402);
  assert.equal(response.headers["payment-required"] !== undefined, true);
  assert.equal(response.json().error.code, "MISSING_PAYMENT_SIGNATURE");

  await app.close();
});

test("positions route requires payment signature", async () => {
  const app = await buildEdgeGatedApp();

  const response = await app.inject({
    method: "GET",
    url: "/positions?address=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"
  });

  assert.equal(response.statusCode, 402);
  assert.equal(response.headers["payment-required"] !== undefined, true);
  assert.equal(response.json().error.code, "MISSING_PAYMENT_SIGNATURE");

  await app.close();
});

test("malformed payment signature returns 402", async () => {
  const app = await buildEdgeGatedApp();

  const malformedHeader = Buffer.from(
    JSON.stringify(fixtures.malformedMissingPaymentGroup),
    "utf-8"
  ).toString("base64");

  const response = await app.inject({
    method: "GET",
    url: "/protocols/tinyman/opportunities",
    headers: {
      "payment-signature": malformedHeader
    }
  });

  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "MALFORMED_PAYMENT_SIGNATURE");

  await app.close();
});

test("expired payment proof returns 402", async () => {
  const app = await buildEdgeGatedApp();

  const response = await app.inject({
    method: "GET",
    url: "/protocols/pact/opportunities",
    headers: {
      "payment-signature": encodePaymentSignature(fixtures.expired)
    }
  });

  assert.equal(response.statusCode, 402);
  assert.equal(response.json().error.code, "EXPIRED_PAYMENT_PROOF");

  await app.close();
});

test("execution quote route requires payment signature", async () => {
  const app = await buildEdgeGatedApp();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: "mainnet:tinyman:v2:addLiquidity:flexible",
      input: {
        userAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        assetAId: 31566704,
        assetAAmount: "1000000",
        assetBId: 0,
        assetBAmount: "2000000",
        maxSlippageBps: 50
      }
    }
  });

  assert.equal(response.statusCode, 402);
  assert.equal(response.headers["payment-required"] !== undefined, true);
  assert.equal(response.json().error.code, "MISSING_PAYMENT_SIGNATURE");

  await app.close();
});

test("free routes remain accessible without payment signature", async () => {
  const app = await buildEdgeGatedApp();

  const health = await app.inject({
    method: "GET",
    url: "/health"
  });
  const manifest = await app.inject({
    method: "GET",
    url: "/.well-known/x402.json"
  });

  assert.equal(health.statusCode, 200);
  assert.equal(health.json().data.status, "ok");
  assert.equal(manifest.statusCode, 200);
  assert.equal(manifest.json().service, "canix402");

  await app.close();
});

async function buildEdgeGatedApp(): Promise<FastifyInstance> {
  const app = buildApp();

  app.addHook("onRequest", async (request, reply) => {
    if (!isPaidEndpoint(request.url.split("?")[0])) {
      return;
    }

    const result = validatePaymentSignatureHeader(
      headerValue(request.headers["payment-signature"])
    );
    if (result.ok) {
      return;
    }

    reply
      .status(result.statusCode)
      .header(
        "PAYMENT-REQUIRED",
        Buffer.from(JSON.stringify(PAYMENT_REQUIRED_REQUIREMENTS), "utf-8").toString(
          "base64"
        )
      )
      .send({
        error: {
          code: result.errorCode,
          message: result.message
        }
      });
  });

  await app.ready();
  return app;
}

function readFixtureSet(): PaymentFixtureSet {
  const filePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../fixtures/x402/payment-signature.samples.json"
  );
  const text = readFileSync(filePath, "utf-8");
  return JSON.parse(text) as PaymentFixtureSet;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  return undefined;
}
