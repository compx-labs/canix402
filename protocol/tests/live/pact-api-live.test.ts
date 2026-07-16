import assert from "node:assert/strict";
import test from "node:test";

const DEFAULT_PACT_API_BASE_URL = "https://api.pact.fi/api";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function pactApiUrls(): { poolsUrl: string; farmsUrl: string } {
  const base = trimTrailingSlash(process.env.PACT_API_BASE_URL ?? DEFAULT_PACT_API_BASE_URL);
  return {
    poolsUrl: `${base}/pools/all?ordering=-tvl_usd&deprecated=false`,
    farmsUrl: `${base}/farms/all?ordering=-tvl_usd`
  };
}

function pactRequestInit(): RequestInit {
  const apiKey = process.env.PACT_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    return {};
  }
  return { headers: { authorization: `Bearer ${apiKey}` } };
}

async function fetchPactApiArray(url: string): Promise<unknown[]> {
  const response = await fetch(url, pactRequestInit());
  assert.equal(
    response.ok,
    true,
    `Expected 2xx from ${url}, got HTTP ${response.status}.`
  );

  const payload = await response.json();
  assert.equal(Array.isArray(payload), true, `Expected JSON array from ${url}.`);
  return payload;
}

test("Pact pools API is reachable and returns a JSON array", async () => {
  const { poolsUrl } = pactApiUrls();
  const pools = await fetchPactApiArray(poolsUrl);

  assert.ok(pools.length > 0, "Expected at least one pool from Pact pools API.");

  const sample = pools[0];
  assert.equal(typeof sample, "object");
  assert.notEqual(sample, null);
});

test("Pact farms API is reachable and returns a JSON array", async () => {
  const { farmsUrl } = pactApiUrls();
  const farms = await fetchPactApiArray(farmsUrl);

  assert.equal(Array.isArray(farms), true);
});
