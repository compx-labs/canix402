import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { startCaddyHarness } from "../helpers/caddyHarness.js";
import {
  FacilitatorMock,
  FacilitatorMockOptions,
  startFacilitatorMock
} from "../helpers/facilitatorMock.js";
import {
  X402PaymentSignaturePayload
} from "../helpers/x402Payload.js";

const CADDY_BINARY = resolve(process.cwd(), ".bin/caddy-x402");
const fixtures = readFixtures();

test("paid endpoint returns 402 and PAYMENT-REQUIRED without signature", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/opportunities`);
    assert.equal(response.status, 402);
    assert.ok(response.headers.get("payment-required"));
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("valid PAYMENT-SIGNATURE triggers verify then settle and returns 200", async () => {
  const context = await setup();
  try {
    const preflight = await fetch(`${context.baseUrl}/opportunities`);
    assert.equal(preflight.status, 402);
    const paymentRequired = preflight.headers.get("payment-required");
    assert.ok(paymentRequired);

    const paid = await fetch(`${context.baseUrl}/opportunities`, {
      headers: {
        "PAYMENT-SIGNATURE": buildSignatureFromPaymentRequired(paymentRequired)
      }
    });

    assert.equal(paid.status, 200);
    const paymentResponseHeader = paid.headers.get("payment-response");
    assert.equal(
      paymentResponseHeader === null || typeof paymentResponseHeader === "string",
      true
    );

    const calls = context.facilitator.calls;
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.endpoint, "/verify");
    assert.equal(calls[1]?.endpoint, "/settle");

    const verifyBody = calls[0]?.body as Record<string, unknown>;
    const paymentPayload = verifyBody.paymentPayload as Record<string, unknown>;
    const nestedPayload = paymentPayload.payload as Record<string, unknown> | undefined;
    const paymentRequirements = verifyBody.paymentRequirements as Record<string, unknown>;

    assert.equal(verifyBody.x402Version, 2);
    assert.equal(
      typeof (nestedPayload?.paymentGroup ?? paymentPayload.paymentGroup),
      "string"
    );
    assert.equal(
      nestedPayload?.paymentIndex ?? paymentPayload.paymentIndex,
      0
    );
    assert.equal(
      paymentRequirements.network === "algorand-mainnet" ||
        paymentRequirements.network ===
          "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
      true
    );
    assert.equal(paymentRequirements.asset, "31566704");
    assert.equal(paymentRequirements.payTo, "REPLACE_WITH_PAYTO_ADDRESS");
    assert.equal(
      paymentRequirements.maxAmountRequired ?? paymentRequirements.amount,
      "10000"
    );
  } finally {
    await context.teardown();
  }
});

test("malformed PAYMENT-SIGNATURE is rejected with payment error", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/opportunities`, {
      headers: {
        "PAYMENT-SIGNATURE": "!!!not-valid-base64!!!"
      }
    });

    assert.equal(response.status === 400 || response.status === 402, true);
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("invalid verify response from facilitator returns payment error", async () => {
  const context = await setup({
    verifyResult: {
      isValid: false,
      invalidReason: "EXPIRED_PAYMENT_PROOF",
      invalidMessage: "proof expired"
    }
  });
  try {
    const preflight = await fetch(`${context.baseUrl}/protocols/tinyman/opportunities`);
    assert.equal(preflight.status, 402);
    const paymentRequired = preflight.headers.get("payment-required");
    assert.ok(paymentRequired);

    const response = await fetch(`${context.baseUrl}/protocols/tinyman/opportunities`, {
      headers: {
        "PAYMENT-SIGNATURE": buildSignatureFromPaymentRequired(paymentRequired)
      }
    });

    assert.equal(response.status, 402);
    assert.equal(context.facilitator.calls.length, 1);
    assert.equal(context.facilitator.calls[0]?.endpoint, "/verify");
  } finally {
    await context.teardown();
  }
});

test("free endpoints bypass validator and remain accessible", async () => {
  const context = await setup();
  try {
    const health = await fetch(`${context.baseUrl}/health`);
    const metadata = await fetch(`${context.baseUrl}/metadata`);

    assert.equal(health.status, 200);
    assert.equal(metadata.status, 200);
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

interface TestContext {
  baseUrl: string;
  facilitator: FacilitatorMock;
  teardown: () => Promise<void>;
}

async function setup(options: FacilitatorMockOptions = {}): Promise<TestContext> {
  const facilitator = await startFacilitatorMock(options);
  let harness: Awaited<ReturnType<typeof startCaddyHarness>> | undefined;
  try {
    harness = await startCaddyHarness(facilitator, CADDY_BINARY);
  } catch (error) {
    await facilitator.close();
    throw error;
  }
  return {
    baseUrl: harness.caddyBaseUrl,
    facilitator,
    teardown: async () => {
      await harness.stop();
      await facilitator.close();
    }
  };
}

function readFixtures(): { valid: X402PaymentSignaturePayload } {
  const filePath = resolve(
    process.cwd(),
    "tests/fixtures/x402/payment-signature.samples.json"
  );
  return JSON.parse(readFileSync(filePath, "utf-8")) as {
    valid: X402PaymentSignaturePayload;
  };
}

function buildSignatureFromPaymentRequired(headerValue: string): string {
  const decoded = JSON.parse(
    Buffer.from(headerValue, "base64").toString("utf-8")
  ) as {
    accepts: Array<Record<string, unknown>>;
  };

  const accepted = decoded.accepts[0] ?? {};
  const payload = {
    x402Version: 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network ?? "algorand-mainnet",
    resource: {
      url: "https://api.canix402.local/opportunities"
    },
    accepted: {
      ...accepted,
      amount: accepted.maxAmountRequired ?? "10000"
    },
    extensions: {},
    outputSchema: null,
    payload: {
      paymentGroup: fixtures.valid.paymentPayload.paymentGroup,
      paymentIndex: fixtures.valid.paymentPayload.paymentIndex
    },
    paymentRequired: decoded
  };

  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}
