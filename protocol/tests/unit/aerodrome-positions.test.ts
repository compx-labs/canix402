import assert from "node:assert/strict";
import test from "node:test";

import { collectAerodromePositions } from "../../src/services/aerodrome-positions.js";
import { setAerodromePositionDependenciesForTests } from "../../src/services/aerodrome-positions.js";
import type { AerodromePoolSnapshot } from "../../src/adapters/aerodrome.js";
import {
  AERO_GAUGE,
  AERO_POOL
} from "../fixtures/adapters/aerodrome-pools.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_POOL = "0x9999999999999999999999999999999999999999";
const OTHER_GAUGE = "0x8888888888888888888888888888888888888888";

const POOLS: AerodromePoolSnapshot[] = [
  {
    pool: AERO_POOL,
    gauge: AERO_GAUGE,
    stable: false,
    assetPair: "WETH/USDC",
    lpDecimals: 18,
    totalSupply: 1_000n,
    tvlUsd: 12_000
  },
  {
    pool: OTHER_POOL,
    gauge: OTHER_GAUGE,
    stable: true,
    assetPair: "USDC/DAI",
    lpDecimals: 18,
    totalSupply: 500n,
    tvlUsd: 4_000
  }
];

test.afterEach(() => {
  setAerodromePositionDependenciesForTests(undefined);
});

test("collectAerodromePositions emits staked LP only", async () => {
  setAerodromePositionDependenciesForTests({
    listPools: async () => POOLS,
    readStake: async (gauge) => (gauge === AERO_GAUGE ? 250n : 0n)
  });

  const collection = await collectAerodromePositions(USER);
  assert.equal(collection.positions.length, 1);
  const position = collection.positions[0];
  assert.ok(position);
  assert.equal(position.positionType, "staked");
  assert.equal(position.positionId, `aerodrome:staked:${AERO_POOL}`);
  assert.equal(position.opportunityId, `aerodrome-farm-${AERO_POOL}`);
  assert.equal(position.amountRaw, "250");
  assert.equal(position.usdValue, 3_000);
  assert.equal(position.inputHints?.poolId, AERO_POOL);
  assert.equal(position.healthFactor, undefined);
  assert.equal(collection.coverage?.suppliedUsdComplete, true);
  assert.equal(collection.warnings.length, 0);
});

test("a failed gauge read is a warning and does not invent a position", async () => {
  setAerodromePositionDependenciesForTests({
    listPools: async () => POOLS.slice(0, 1),
    readStake: async () => {
      throw new Error("rpc down");
    }
  });
  const collection = await collectAerodromePositions(USER);
  assert.equal(collection.positions.length, 0);
  assert.equal(collection.coverage?.suppliedUsdComplete, false);
  assert.match(collection.warnings[0] ?? "", /rpc down/);
});
