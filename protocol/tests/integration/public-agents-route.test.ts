import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import {
  BROWNIE_BOT_AGENT_ID,
  BROWNIE_BOT_WALLET,
  PUBLIC_BROWNIE_POSITIONS_PATH
} from "../../src/constants/public-agents.js";
import {
  setPositionCollectorsForTests,
  SUPPORTED_POSITION_PROTOCOLS
} from "../../src/services/aggregate-positions.js";
import {
  classifyEndpointAccess,
  endpointPolicyMatrix
} from "../../src/services/payment-policy.js";

const COMPLETE_COVERAGE = {
  suppliedUsdComplete: true,
  borrowedUsdComplete: true,
  rewardsUsdComplete: true
} as const;

test.afterEach(() => {
  setPositionCollectorsForTests(undefined);
});

function setAllCollectors(
  collector: () => Promise<{
    positions: [];
    warnings: string[];
    coverage: typeof COMPLETE_COVERAGE;
  }>
): void {
  setPositionCollectorsForTests(
    Object.fromEntries(
      SUPPORTED_POSITION_PROTOCOLS.map((protocol) => [protocol, collector])
    ) as Parameters<typeof setPositionCollectorsForTests>[0]
  );
}

test("public Brownie positions route is free while /positions stays paid", () => {
  assert.equal(
    classifyEndpointAccess(PUBLIC_BROWNIE_POSITIONS_PATH, "GET"),
    "free"
  );
  assert.equal(classifyEndpointAccess("/positions", "GET"), "paid");

  const showcase = endpointPolicyMatrix.find(
    (endpoint) => endpoint.id === "publicBrowniePositions"
  );
  const paid = endpointPolicyMatrix.find((endpoint) => endpoint.id === "positions");
  assert.equal(showcase?.access, "free");
  assert.equal(showcase?.pathPattern, PUBLIC_BROWNIE_POSITIONS_PATH);
  assert.equal(paid?.access, "paid");
});

test("GET /public/agents/brownie/positions returns hardcoded treasury wallet", async () => {
  setAllCollectors(async () => ({
    positions: [],
    warnings: [],
    coverage: COMPLETE_COVERAGE
  }));
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "GET",
      url: PUBLIC_BROWNIE_POSITIONS_PATH
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: unknown[];
      protocols: Array<{ status: string }>;
      meta: { address: string; agentId?: string; fetchedAt: string };
    };
    assert.deepEqual(body.data, []);
    assert.equal(body.protocols.length, SUPPORTED_POSITION_PROTOCOLS.length);
    assert.equal(body.meta.address, BROWNIE_BOT_WALLET);
    assert.equal(body.meta.agentId, BROWNIE_BOT_AGENT_ID);
    assert.ok(typeof body.meta.fetchedAt === "string");
  } finally {
    await app.close();
  }
});
