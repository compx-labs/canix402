import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import algosdk from "algosdk";

import { buildApp } from "../../src/app.js";
import {
  buildStrategyPaymentNote,
  buildStrategyPayoutNote,
  resetStrategyServiceForTests,
  StrategyConflictError,
  StrategyForbiddenError,
  StrategyService,
  StrategyValidationError
} from "../../src/services/strategies.js";
import { LocalFilesystemStrategyStore } from "../../src/services/strategy-store.js";
import {
  holderShareMicroUsdc,
  parseStrategyIdFromAccessNote,
  parseStrategyIdFromPayoutNote
} from "../../src/services/strategy-fee-payout.js";
import {
  STRATEGY_HOLDER_FEE_SHARE_BPS,
  STRATEGY_WEIGHT_BPS_TOTAL
} from "../../src/types/strategy-schema.js";
import { classifyEndpointAccess } from "../../src/services/payment-policy.js";

const CREATOR = algosdk.generateAccount().addr.toString();
const HOLDER = algosdk.generateAccount().addr.toString();

function validLeg(weightBps = STRATEGY_WEIGHT_BPS_TOTAL, opportunityId = "tinyman:demo") {
  return {
    shapeKey: "mainnet:tinyman:v2:addLiquidity:flexible",
    opportunityId,
    weightBps
  };
}

test("strategy payment and payout notes encode strategyId", () => {
  assert.equal(buildStrategyPaymentNote(42), "x402:v2:strategy:42");
  assert.equal(
    buildStrategyPayoutNote("2026-W29", 42),
    "x402:v2:strategy-payout:2026-W29:42"
  );
  assert.equal(parseStrategyIdFromAccessNote("x402:v2:strategy:99"), 99);
  assert.equal(
    parseStrategyIdFromPayoutNote("x402:v2:strategy-payout:2026-W29:7", "2026-W29"),
    7
  );
  assert.equal(holderShareMicroUsdc(100_000n), 50_000n);
  assert.equal(STRATEGY_HOLDER_FEE_SHARE_BPS, 5_000);
});

test("strategy endpoint access is method-aware", () => {
  assert.equal(classifyEndpointAccess("/strategies", "GET"), "free");
  assert.equal(classifyEndpointAccess("/strategies", "POST"), "paid");
  assert.equal(classifyEndpointAccess("/strategies/123", "GET"), "free");
  assert.equal(classifyEndpointAccess("/strategies/123", "POST"), "paid");
  assert.equal(classifyEndpointAccess("/strategies/123/compile", "POST"), "paid");
});

test("local strategy store put/get/list round-trips", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "canix-strategy-"));
  try {
    const store = new LocalFilesystemStrategyStore({ rootDir });
    const document = {
      schemaVersion: 1 as const,
      strategyId: 900001,
      creatorAddress: CREATOR,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastRevisedAt: "2026-01-01T00:00:00.000Z",
      name: "Demo",
      description: "Demo strategy",
      tags: ["demo"],
      status: "published" as const,
      legs: [validLeg()],
      holderFeeShareBps: STRATEGY_HOLDER_FEE_SHARE_BPS
    };
    await store.put(document);
    assert.deepEqual(await store.get(900001), document);
    assert.deepEqual(await store.listIds(), [900001]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("StrategyService validates weights and rejects raw txn groups", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "canix-strategy-"));
  try {
    const service = new StrategyService({
      store: new LocalFilesystemStrategyStore({ rootDir }),
      mintStrategyNft: async () => 900002,
      resolveNftHolder: async () => CREATOR
    });

    assert.throws(
      () => service.validateLegs([validLeg(5_000)]),
      StrategyValidationError
    );

    await assert.rejects(
      () =>
        service.publish({
          creatorAddress: CREATOR,
          name: "Bad",
          description: "bad",
          legs: [validLeg()],
          encodedTransactions: ["deadbeef"]
        } as never),
      StrategyValidationError
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("publish + revise cooldown + holder-only revise", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "canix-strategy-"));
  let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  try {
    const service = new StrategyService({
      store: new LocalFilesystemStrategyStore({ rootDir }),
      now: () => new Date(nowMs),
      mintStrategyNft: async () => 900003,
      resolveNftHolder: async () => HOLDER
    });

    const published = await service.publish({
      creatorAddress: CREATOR,
      name: "Weighted",
      description: "A strategy",
      tags: ["lp"],
      legs: [validLeg()]
    });
    assert.equal(published.strategyId, 900003);
    assert.equal(published.creatorAddress, CREATOR);
    assert.equal(published.lastRevisedAt, published.createdAt);

    await assert.rejects(
      () =>
        service.revise(900003, {
          holderAddress: CREATOR,
          legs: [validLeg()]
        }),
      StrategyForbiddenError
    );

    await assert.rejects(
      () =>
        service.revise(900003, {
          holderAddress: HOLDER,
          legs: [validLeg(4_000, "a"), validLeg(6_000, "b")]
        }),
      StrategyConflictError
    );

    nowMs = Date.parse("2026-01-16T00:00:00.000Z");
    const revised = await service.revise(900003, {
      holderAddress: HOLDER,
      name: "Weighted v2",
      legs: [validLeg(4_000, "a"), validLeg(6_000, "b")]
    });
    assert.equal(revised.name, "Weighted v2");
    assert.equal(revised.createdAt, published.createdAt);
    assert.notEqual(revised.lastRevisedAt, published.lastRevisedAt);
    assert.equal(revised.legs.length, 2);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("strategy HTTP routes list/detail/publish", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "canix-strategy-"));
  process.env.STRATEGY_DATA_DIR = rootDir;
  process.env.STRATEGY_STUB_ID_PATH = join(rootDir, "next-id.json");
  delete process.env.STRATEGY_MINT_MNEMONIC;
  delete process.env.DO_SPACES_ENDPOINT;
  delete process.env.DO_SPACES_BUCKET;
  delete process.env.DO_SPACES_KEY;
  delete process.env.DO_SPACES_SECRET;
  resetStrategyServiceForTests();

  const app = buildApp();
  await app.ready();

  try {
    const publish = await app.inject({
      method: "POST",
      url: "/strategies",
      payload: {
        creatorAddress: CREATOR,
        name: "Listed",
        description: "Listed strategy",
        legs: [validLeg()]
      }
    });
    assert.equal(publish.statusCode, 200, publish.body);
    const strategyId = publish.json().data.strategyId as number;
    assert.ok(strategyId > 0);

    const list = await app.inject({ method: "GET", url: "/strategies" });
    assert.equal(list.statusCode, 200);
    const listBody = list.json() as {
      data: { items: Array<{ strategyId: number }>; total: number };
    };
    assert.ok(listBody.data.items.some((item) => item.strategyId === strategyId));

    const detail = await app.inject({
      method: "GET",
      url: `/strategies/${strategyId}`
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().data.strategyId, strategyId);

    const missing = await app.inject({
      method: "GET",
      url: "/strategies/1"
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
    resetStrategyServiceForTests();
    await rm(rootDir, { recursive: true, force: true });
  }
});
