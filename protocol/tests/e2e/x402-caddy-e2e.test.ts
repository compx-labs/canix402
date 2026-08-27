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
import {
  MemorySessionStore,
  resetSessionStoreForTests,
  setSessionStoreForTests
} from "../../src/services/session-store.js";

const CADDY_BINARY = resolve(process.cwd(), ".bin/caddy-x402");
const fixtures = readFixtures();

test("paid endpoint returns 402 and PAYMENT-REQUIRED without signature", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/opportunities`);
    assert.equal(response.status, 402);
    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("paid endpoint 402 includes compact extensions.bazaar discovery metadata", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/opportunities`);
    assert.equal(response.status, 402);
    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    assert.ok(
      paymentRequired.length < 12_000,
      `PAYMENT-REQUIRED header too large: ${paymentRequired.length}`
    );

    const decoded = decodePaymentRequired(paymentRequired);
    const bazaar = decoded.extensions?.bazaar as
      | { info?: unknown; schema?: unknown }
      | undefined;
    assert.ok(bazaar, "expected extensions.bazaar");
    assert.ok(bazaar.info, "expected extensions.bazaar.info");
    assert.ok(bazaar.schema, "expected extensions.bazaar.schema");
    assert.equal(
      (decoded.accepts[0]?.extra as { tag?: string } | undefined)?.tag,
      "x402-global-challenge"
    );
  } finally {
    await context.teardown();
  }
});

test("positions endpoint advertises exactly 5000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(
      `${context.baseUrl}/positions?address=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ`
    );
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "5000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("eligibility endpoint advertises exactly 10000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/eligibility`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        opportunityIds: ["reti-staking-1"]
      })
    });
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "10000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("plans endpoint advertises exactly 250000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        budget: { assetId: 0, amount: "1000000" }
      })
    });
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "250000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("plans rebalance endpoint advertises exactly 250000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/plans/rebalance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        harvestIdle: true
      })
    });
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "250000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("execution compose endpoint advertises exactly 100000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/execution/compose`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        opportunityId: "reti-staking-12",
        fromAssetId: 0,
        amount: "1000000"
      })
    });
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "100000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("execution simulate endpoint advertises exactly 100000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/execution/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
        groups: [{ encodedTransactions: ["AAAA"] }]
      })
    });
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "100000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("positions/claimable endpoint advertises exactly 1000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(
      `${context.baseUrl}/positions/claimable?address=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ`
    );
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "1000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("sessions create advertises exactly 250000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(response.status, 402);
    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "250000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("sessions refresh advertises exactly 250000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/sessions/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(response.status, 402);
    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "250000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("session header skips facilitator and fail-closes at the app", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/opportunities`, {
      headers: { "X-Canix-Session": "csess_invalid" }
    });
    assert.equal(response.status, 402);
    const body = (await response.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, "SESSION_INVALID");
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("empty or whitespace session header does not skip x402", async () => {
  const context = await setup();
  try {
    for (const value of ["", "   "]) {
      const response = await fetch(`${context.baseUrl}/opportunities`, {
        headers: { "X-Canix-Session": value }
      });
      assert.equal(response.status, 402, `header ${JSON.stringify(value)}`);
      const paymentRequired = response.headers.get("payment-required");
      assert.ok(paymentRequired, `expected PAYMENT-REQUIRED for ${JSON.stringify(value)}`);
      const text = await response.text();
      if (text) {
        const body = JSON.parse(text) as { error?: { code?: string } };
        assert.equal(
          body.error?.code?.startsWith("SESSION_") ?? false,
          false,
          `header ${JSON.stringify(value)} should not be a SESSION_* 402`
        );
      }
    }
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("valid session header skips facilitator without a SESSION_* 402", async () => {
  const store = new MemorySessionStore();
  setSessionStoreForTests(store);
  const created = await store.create();
  assert.equal(created.ok, true);
  if (!created.ok) {
    resetSessionStoreForTests();
    return;
  }

  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/opportunities`, {
      headers: { "X-Canix-Session": created.receipt.sessionId }
    });
    assert.notEqual(response.status, 402);
    assert.equal(response.headers.get("payment-required"), null);
    assert.equal(context.facilitator.calls.length, 0);
    const remaining = response.headers.get("x-canix-session-remaining-research");
    assert.equal(remaining, String(created.receipt.budget.research - 1));
  } finally {
    await context.teardown();
    resetSessionStoreForTests();
  }
});

test("positions endpoint verifies and settles a 5000 micro-USDC payment", async () => {
  const context = await setup();
  const path =
    "/positions?address=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
  try {
    const preflight = await fetch(`${context.baseUrl}${path}`);
    assert.equal(preflight.status, 402);
    const paymentRequired = preflight.headers.get("payment-required");
    assert.ok(paymentRequired);

    const paid = await fetch(`${context.baseUrl}${path}`, {
      headers: {
        "PAYMENT-SIGNATURE": buildSignatureFromPaymentRequired(
          paymentRequired,
          "/positions"
        )
      }
    });

    assert.equal(paid.status, 200);
    assert.deepEqual(
      context.facilitator.calls.map(({ endpoint }) => endpoint),
      ["/verify", "/settle"]
    );
    const verifyBody = context.facilitator.calls[0]?.body as Record<string, unknown>;
    const requirements = verifyBody.paymentRequirements as Record<string, unknown>;
    assert.equal(
      requirements.maxAmountRequired ?? requirements.amount,
      "5000"
    );
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
      Array.isArray(nestedPayload?.paymentGroup ?? paymentPayload.paymentGroup),
      true
    );
    assert.equal(
      nestedPayload?.paymentIndex ?? paymentPayload.paymentIndex,
      0
    );
    const payloadExtensions = paymentPayload.extensions as
      | Record<string, unknown>
      | undefined;
    assert.ok(
      payloadExtensions?.bazaar,
      "PAYMENT-SIGNATURE should echo extensions.bazaar from the 402"
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

test("execution quote endpoint returns 402 and PAYMENT-REQUIRED without signature", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/execution/quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quotes: [
          {
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
        ]
      })
    });
    assert.equal(response.status, 402);
    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("Haystack quote and opt-in endpoints bypass x402", async () => {
  const context = await setup();
  try {
    for (const path of ["/swaps/quote", "/swaps/optin"]) {
      const response = await fetch(`${context.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });

      assert.notEqual(response.status, 402, `${path} must remain free`);
    }
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("Haystack transaction endpoint advertises exactly 5000 micro-USDC", async () => {
  const context = await setup();
  try {
    const response = await fetch(`${context.baseUrl}/swaps/transactions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(response.status, 402);

    const paymentRequired = response.headers.get("payment-required");
    assert.ok(paymentRequired);
    const decoded = decodePaymentRequired(paymentRequired);
    assert.equal(
      decoded.accepts[0]?.maxAmountRequired ?? decoded.accepts[0]?.amount,
      "5000"
    );
    assert.equal(context.facilitator.calls.length, 0);
  } finally {
    await context.teardown();
  }
});

test("free endpoints bypass validator and remain accessible", async () => {
  const context = await setup();
  try {
    const health = await fetch(`${context.baseUrl}/health`);
    const metadata = await fetch(`${context.baseUrl}/metadata`);
    const manifest = await fetch(`${context.baseUrl}/.well-known/x402.json`);

    assert.equal(health.status, 200);
    assert.equal(metadata.status, 200);
    assert.equal(manifest.status, 200);
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

function buildSignatureFromPaymentRequired(
  headerValue: string,
  resourcePath = "/opportunities"
): string {
  const decoded = decodePaymentRequired(headerValue);

  const accepted = decoded.accepts[0] ?? {};
  const payload = {
    x402Version: 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network ?? "algorand-mainnet",
    resource: {
      url: `https://api.canix402.local${resourcePath}`
    },
    accepted: {
      ...accepted,
      amount: accepted.maxAmountRequired ?? accepted.amount ?? "10000"
    },
    extensions: decoded.extensions ?? {},
    outputSchema: null,
    payload: {
      paymentGroup: fixtures.valid.paymentPayload.paymentGroup,
      paymentIndex: fixtures.valid.paymentPayload.paymentIndex
    },
    paymentRequired: decoded
  };

  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64");
}

function decodePaymentRequired(headerValue: string): {
  accepts: Array<Record<string, unknown>>;
  extensions?: Record<string, unknown>;
} {
  return JSON.parse(Buffer.from(headerValue, "base64").toString("utf-8")) as {
    accepts: Array<Record<string, unknown>>;
    extensions?: Record<string, unknown>;
  };
}
