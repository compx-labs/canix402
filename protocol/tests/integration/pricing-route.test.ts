import assert from "node:assert/strict";
import test from "node:test";

import { setCompXSdkDependenciesForTests } from "../../src/adapters/index.js";
import { buildApp } from "../../src/app.js";

test("POST /pricing returns ordered CompX prices without payment", async () => {
  setCompXSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    createSdk: () => ({ pricing: {} }) as never,
    getTokenPricesFn: async (assetIds) => {
      assert.deepEqual(assetIds, [31566704, 0, 12345]);
      return {
        "0": 0.12,
        "31566704": 1
      };
    }
  });
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/pricing",
      payload: { assetIds: [31566704, 0, 12345, 31566704] }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().data.prices, [
      { assetId: "31566704", priceUsd: 1 },
      { assetId: "0", priceUsd: 0.12 },
      { assetId: "12345", priceUsd: null },
      { assetId: "31566704", priceUsd: 1 }
    ]);
    assert.equal(response.json().data.source, "compx");
    assert.match(response.json().data.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(response.json().meta, {
      paymentRequired: false,
      executionSubmitted: false
    });
  } finally {
    await app.close();
    setCompXSdkDependenciesForTests(undefined);
  }
});

test("POST /pricing rejects invalid asset IDs", async () => {
  const app = buildApp();
  await app.ready();

  try {
    for (const payload of [
      { assetIds: [] },
      { assetIds: [-1] },
      { assetIds: ["invalid"] }
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/pricing",
        payload
      });
      assert.equal(response.statusCode, 400);
    }
  } finally {
    await app.close();
  }
});

test("POST /pricing returns 502 when CompX pricing fails", async () => {
  setCompXSdkDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    createSdk: () => ({ pricing: {} }) as never,
    getTokenPricesFn: async () => {
      throw new Error("pricing upstream unavailable");
    }
  });
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/pricing",
      payload: { assetIds: [31566704] }
    });

    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error.code, "INTERNAL_ERROR");
    assert.equal(response.json().error.message, "CompX pricing request failed.");
  } finally {
    await app.close();
    setCompXSdkDependenciesForTests(undefined);
  }
});
