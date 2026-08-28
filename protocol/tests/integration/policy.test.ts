import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import { setPolicyDependenciesForTests } from "../../src/services/policy.js";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const FRESH = "2026-08-28T11:00:00.000Z";
const STALE = "2026-08-20T12:00:00.000Z";

const PASSING_QUOTE = {
  shapeKey: "mainnet:reti:v1:stake:algo",
  protocol: "reti",
  opportunityId: "reti-staking-12",
  weightBps: 4000,
  allocatedAmount: "1000000",
  allocatedAssetId: 0,
  tvlUsd: 1_000_000,
  sourceTimestamp: FRESH,
  executionReady: true
};

test.afterEach(() => {
  setPolicyDependenciesForTests(undefined);
});

test("POST /policy/validate returns pass without signing", async () => {
  setPolicyDependenciesForTests({ now: () => NOW });
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/policy/validate",
      payload: {
        policy: {
          schemaVersion: "1.0.0",
          maxProtocolWeightBps: 4000,
          minAlgoReserveMicroAlgos: "1000000",
          minTvlUsd: 25_000,
          maxSourceAgeSeconds: 86_400,
          noNewBorrows: true,
          executionReadyOnly: true
        },
        quotes: [PASSING_QUOTE],
        walletAlgoMicroAlgos: "5000000"
      }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: { pass: boolean; reasons: unknown[]; signed: boolean; submitted: boolean };
      meta: { paymentRequired: boolean; executionSubmitted: boolean; signed: boolean };
    };
    assert.equal(body.data.pass, true);
    assert.equal(body.data.reasons.length, 0);
    assert.equal(body.data.signed, false);
    assert.equal(body.data.submitted, false);
    assert.equal(body.meta.paymentRequired, true);
    assert.equal(body.meta.executionSubmitted, false);
    assert.equal(body.meta.signed, false);
  } finally {
    await app.close();
  }
});

test("POST /policy/validate fail-weight", async () => {
  setPolicyDependenciesForTests({ now: () => NOW });
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/policy/validate",
      payload: {
        policy: { schemaVersion: "1.0.0", maxProtocolWeightBps: 4000 },
        quotes: [{ ...PASSING_QUOTE, weightBps: 10_000 }]
      }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { data: { pass: boolean; reasons: Array<{ code: string }> } };
    assert.equal(body.data.pass, false);
    assert.equal(body.data.reasons.some((row) => row.code === "protocol-weight"), true);
  } finally {
    await app.close();
  }
});

test("POST /policy/validate fail-borrows", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/policy/validate",
      payload: {
        policy: { schemaVersion: "1.0.0", noNewBorrows: true },
        quotes: [
          {
            ...PASSING_QUOTE,
            shapeKey: "mainnet:compx:v1:borrow:asa",
            protocol: "compx",
            identity: { action: "borrow" }
          }
        ]
      }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { data: { pass: boolean; reasons: Array<{ code: string }> } };
    assert.equal(body.data.pass, false);
    assert.equal(body.data.reasons.some((row) => row.code === "new-borrow"), true);
  } finally {
    await app.close();
  }
});

test("POST /policy/validate stale TVL / freshness fail closed", async () => {
  setPolicyDependenciesForTests({ now: () => NOW });
  const app = buildApp();
  await app.ready();
  try {
    const missingTvl = await app.inject({
      method: "POST",
      url: "/policy/validate",
      payload: {
        policy: { schemaVersion: "1.0.0", minTvlUsd: 25_000 },
        quotes: [{ ...PASSING_QUOTE, tvlUsd: undefined }]
      }
    });
    assert.equal(missingTvl.statusCode, 200);
    const missingBody = missingTvl.json() as {
      data: { pass: boolean; reasons: Array<{ code: string }> };
    };
    assert.equal(missingBody.data.pass, false);
    assert.equal(missingBody.data.reasons.some((row) => row.code === "missing-tvl"), true);

    const stale = await app.inject({
      method: "POST",
      url: "/policy/validate",
      payload: {
        policy: { schemaVersion: "1.0.0", maxSourceAgeSeconds: 86_400 },
        quotes: [{ ...PASSING_QUOTE, sourceTimestamp: STALE }]
      }
    });
    assert.equal(stale.statusCode, 200);
    const staleBody = stale.json() as { data: { pass: boolean; reasons: Array<{ code: string }> } };
    assert.equal(staleBody.data.pass, false);
    assert.equal(staleBody.data.reasons.some((row) => row.code === "source-not-fresh"), true);
  } finally {
    await app.close();
  }
});

test("POST /policy/validate rejects missing plan and quotes with 400", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/policy/validate",
      payload: { policy: { schemaVersion: "1.0.0" } }
    });
    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
  }
});

test("POST /policy/validate rejects an unknown schemaVersion with 400", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/policy/validate",
      payload: {
        policy: { schemaVersion: "9.9.9" },
        quotes: [PASSING_QUOTE]
      }
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});
