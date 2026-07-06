import assert from "node:assert/strict";
import test from "node:test";

import { fetchTinymanOpportunities } from "../../src/adapters/index.js";

test("Tinyman live fetch returns real APY and TVL USD data", async () => {
  const data = await fetchTinymanOpportunities();

  assert.equal(Array.isArray(data), true);
  assert.ok(data.length > 0, "Expected at least one Tinyman opportunity from live source.");

  const sample = data[0];
  assert.ok(sample, "Expected first Tinyman record to exist.");
  assert.equal(sample?.protocol, "tinyman");
  assert.equal(typeof sample?.apy, "number");
  assert.equal(typeof sample?.tvlUsd, "number");
  assert.equal(Number.isFinite(sample?.apy), true);
  assert.equal(Number.isFinite(sample?.tvlUsd), true);
  assert.equal(sample!.assetPair.length > 0, true);
  assert.equal(sample!.opportunityId.length > 0, true);
});
