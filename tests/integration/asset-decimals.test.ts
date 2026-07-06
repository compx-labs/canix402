import assert from "node:assert/strict";
import test from "node:test";

import {
  ALGO_ASSET_ID,
  ALGO_DECIMALS,
  resolveAssetDecimals,
  setAssetDecimalsDependenciesForTests
} from "../../src/services/asset-decimals.js";

test("resolveAssetDecimals hardcodes ALGO to 6 without algod lookup", async () => {
  let lookupCount = 0;

  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => {
      lookupCount += 1;
      return { params: { decimals: 8 } };
    }
  });

  try {
    const decimalsByAssetId = await resolveAssetDecimals([ALGO_ASSET_ID]);

    assert.equal(decimalsByAssetId.get(ALGO_ASSET_ID), ALGO_DECIMALS);
    assert.equal(lookupCount, 0);
  } finally {
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("resolveAssetDecimals reads ASA decimals from algod", async () => {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async (_client, assetId) => ({
      params: { decimals: assetId === 31566704 ? 6 : 8 }
    })
  });

  try {
    const decimalsByAssetId = await resolveAssetDecimals([31566704, 1058926737]);

    assert.equal(decimalsByAssetId.get(31566704), 6);
    assert.equal(decimalsByAssetId.get(1058926737), 8);
  } finally {
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("resolveAssetDecimals omits assets that do not exist without warning", async () => {
  const warnings: string[] = [];

  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => {
      throw Object.assign(new Error("asset does not exist"), { status: 404 });
    },
    logWarning: (message) => warnings.push(message)
  });

  try {
    const decimalsByAssetId = await resolveAssetDecimals([999_999_999]);

    assert.equal(decimalsByAssetId.has(999_999_999), false);
    assert.equal(warnings.length, 0);
  } finally {
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("resolveAssetDecimals warns and omits on transient lookup failures", async () => {
  const warnings: string[] = [];

  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => {
      throw Object.assign(new Error("rate limited"), { status: 429 });
    },
    logWarning: (message) => warnings.push(message)
  });

  try {
    const decimalsByAssetId = await resolveAssetDecimals([31566704]);

    assert.equal(decimalsByAssetId.has(31566704), false);
    assert.equal(warnings.length, 1);
  } finally {
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("resolveAssetDecimals converts bigint decimals from algod", async () => {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 8n } })
  });

  try {
    const decimalsByAssetId = await resolveAssetDecimals([1058926737]);

    assert.equal(decimalsByAssetId.get(1058926737), 8);
  } finally {
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("resolveAssetDecimals deduplicates asset ids", async () => {
  const lookedUp: number[] = [];

  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async (_client, assetId) => {
      lookedUp.push(assetId);
      return { params: { decimals: 6 } };
    }
  });

  try {
    await resolveAssetDecimals([31566704, 31566704, ALGO_ASSET_ID]);

    assert.deepEqual(lookedUp, [31566704]);
  } finally {
    setAssetDecimalsDependenciesForTests(undefined);
  }
});

test("resolveAssetDecimals caches results across calls", async () => {
  let lookupCount = 0;

  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => {
      lookupCount += 1;
      return { params: { decimals: 6 } };
    }
  });

  try {
    await resolveAssetDecimals([31566704]);
    const second = await resolveAssetDecimals([31566704]);

    assert.equal(second.get(31566704), 6);
    assert.equal(lookupCount, 1);
  } finally {
    setAssetDecimalsDependenciesForTests(undefined);
  }
});
