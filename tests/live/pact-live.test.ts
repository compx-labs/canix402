import assert from "node:assert/strict";
import test from "node:test";

import { fetchPactOpportunities } from "../../src/adapters/index.js";

test("Pact live fetch returns LP/farm opportunities with numeric APY and TVL", async () => {
  const originalBaseUrl = process.env.PACT_API_BASE_URL;
  const originalOnlyVerified = process.env.PACT_ONLY_VERIFIED;

  process.env.PACT_API_BASE_URL = "https://api.pact.fi/api";
  process.env.PACT_ONLY_VERIFIED = "true";

  try {
    const data = await fetchPactOpportunities();

    assert.equal(Array.isArray(data), true);
    assert.ok(data.length > 0, "Expected at least one Pact opportunity from live source.");

    const lp = data.find((opportunity) => opportunity.opportunityType === "lp");
    assert.ok(lp, "Expected at least one LP opportunity from Pact.");
    assert.equal(lp?.protocol, "pact");
    assert.equal(Number.isFinite(lp?.apy), true);
    assert.equal(Number.isFinite(lp?.tvlUsd), true);

    const farm = data.find((opportunity) => opportunity.opportunityType === "farm");
    if (farm) {
      assert.equal(farm.protocol, "pact");
      assert.equal(Number.isFinite(farm.apy), true);
      assert.equal(Number.isFinite(farm.tvlUsd), true);
      assert.equal(farm.opportunityId.endsWith(":farm"), true);
    }
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.PACT_API_BASE_URL;
    } else {
      process.env.PACT_API_BASE_URL = originalBaseUrl;
    }

    if (originalOnlyVerified === undefined) {
      delete process.env.PACT_ONLY_VERIFIED;
    } else {
      process.env.PACT_ONLY_VERIFIED = originalOnlyVerified;
    }
  }
});
