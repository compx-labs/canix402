import assert from "node:assert/strict";
import test from "node:test";

import { USDC_ASSET_ID } from "../../src/execution/shapes/haystack/constants.js";
import type { ClaimableRewardRecord } from "../../src/types/claimable.js";
import type { PositionRecordV1 } from "../../src/types/position.js";
import {
  computeRebalanceDeltas,
  resolveIdleAlgoMicro
} from "../../src/services/rebalance-graph.js";

function position(
  overrides: Partial<PositionRecordV1> &
    Pick<PositionRecordV1, "positionId" | "opportunityId" | "usdValue" | "amountRaw">
): PositionRecordV1 {
  return {
    protocol: "reti",
    positionType: "staked",
    assetId: 0,
    assetSymbol: "ALGO",
    amount: "1",
    compatibleExitShapeKeys: ["mainnet:reti:v1:unstake:algo"],
    compatibleManageShapeKeys: [],
    ...overrides
  };
}

test("idle ALGO subtracts the reserve and never goes negative", () => {
  assert.equal(resolveIdleAlgoMicro(5_000_000n, 1_000_000n), 4_000_000n);
  assert.equal(resolveIdleAlgoMicro(500_000n, 1_000_000n), 0n);
});

test("target-weight overweight emits a partial exit, not a full unwind", () => {
  const result = computeRebalanceDeltas({
    positions: [
      position({
        positionId: "reti:a",
        opportunityId: "reti-staking-12",
        usdValue: 70,
        amountRaw: "7000000"
      }),
      position({
        positionId: "reti:b",
        opportunityId: "reti-staking-1",
        protocol: "reti",
        usdValue: 30,
        amountRaw: "3000000"
      })
    ],
    claimable: [],
    idleAlgoMicro: 0n,
    targetWeights: [
      { opportunityId: "reti-staking-12", weightBps: 5_000 },
      { opportunityId: "reti-staking-1", weightBps: 5_000 }
    ],
    harvestIdle: false,
    includeClaims: false,
    minDeltaBps: 50
  });

  const exits = result.intents.filter((intent) => intent.kind === "exit");
  const enters = result.intents.filter((intent) => intent.kind === "enter");
  assert.equal(exits.length, 1);
  assert.equal(exits[0]?.opportunityId, "reti-staking-12");
  assert.equal(exits[0]?.amountRaw, "2000000");
  assert.equal(exits[0]?.compileNow, true);
  assert.equal(enters.length, 1);
  assert.equal(enters[0]?.opportunityId, "reti-staking-1");
  assert.equal(enters[0]?.compileNow, false);
  assert.equal(enters[0]?.reason, "underweight-awaiting-exit-proceeds");
});

test("positions outside targetWeights are not unwound", () => {
  const result = computeRebalanceDeltas({
    positions: [
      position({
        positionId: "reti:keep",
        opportunityId: "reti-staking-99",
        usdValue: 100,
        amountRaw: "10000000"
      }),
      position({
        positionId: "reti:a",
        opportunityId: "reti-staking-12",
        usdValue: 50,
        amountRaw: "5000000"
      })
    ],
    claimable: [],
    idleAlgoMicro: 0n,
    targetWeights: [{ opportunityId: "reti-staking-12", weightBps: 10_000 }],
    harvestIdle: false,
    includeClaims: false,
    minDeltaBps: 50
  });

  assert.equal(result.intents.filter((intent) => intent.kind === "exit").length, 0);
  assert.equal(result.book.unweightedUsd, 100);
  assert.match(result.warnings.join(" "), /not in targetWeights/);
});

test("target weight zero fully exits that opportunity", () => {
  const result = computeRebalanceDeltas({
    positions: [
      position({
        positionId: "reti:a",
        opportunityId: "reti-staking-12",
        usdValue: 80,
        amountRaw: "8000000"
      }),
      position({
        positionId: "reti:b",
        opportunityId: "reti-staking-1",
        usdValue: 20,
        amountRaw: "2000000"
      })
    ],
    claimable: [],
    idleAlgoMicro: 0n,
    targetWeights: [
      { opportunityId: "reti-staking-12", weightBps: 0 },
      { opportunityId: "reti-staking-1", weightBps: 10_000 }
    ],
    harvestIdle: false,
    includeClaims: false,
    minDeltaBps: 50
  });

  const exit = result.intents.find((intent) => intent.kind === "exit");
  assert.equal(exit?.amountRaw, "8000000");
  assert.equal(exit?.reason, "target-weight-zero");
});

test("minDeltaBps skips dust gaps", () => {
  const result = computeRebalanceDeltas({
    positions: [
      position({
        positionId: "reti:a",
        opportunityId: "reti-staking-12",
        usdValue: 50.2,
        amountRaw: "5020000"
      }),
      position({
        positionId: "reti:b",
        opportunityId: "reti-staking-1",
        usdValue: 49.8,
        amountRaw: "4980000"
      })
    ],
    claimable: [],
    idleAlgoMicro: 0n,
    targetWeights: [
      { opportunityId: "reti-staking-12", weightBps: 5_000 },
      { opportunityId: "reti-staking-1", weightBps: 5_000 }
    ],
    harvestIdle: false,
    includeClaims: false,
    minDeltaBps: 50
  });

  assert.equal(result.intents.length, 0);
  assert.match(result.warnings.join(" "), /already matches target weights/);
});

test("harvest-idle emits worth-claiming claims then idle ALGO enter", () => {
  const claimable: ClaimableRewardRecord[] = [
    {
      protocol: "haystack",
      positionId: "haystack:reward:usdc",
      opportunityId: "haystack-staking-hay",
      positionType: "reward",
      assetId: USDC_ASSET_ID,
      assetSymbol: "USDC",
      amountRaw: "1500000",
      amount: "1.5",
      usdValue: 1.5,
      claimKey: "haystack:claim:addr",
      compatibleClaimShapeKeys: ["mainnet:haystack:v1:claim:rewards"],
      quote: {
        shapeKey: "mainnet:haystack:v1:claim:rewards",
        input: { userAddress: "ADDR" }
      },
      estimatedNetworkFeeMicroAlgos: "2000",
      estimatedNetworkFeeUsd: 0.0004,
      worthClaiming: true
    },
    {
      protocol: "compx",
      positionId: "compx:reward:skip",
      opportunityId: "compx-farm-1",
      positionType: "reward",
      assetId: 1,
      assetSymbol: "ASA",
      amountRaw: "1",
      amount: "1",
      usdValue: 0.0001,
      claimKey: "compx:claim:skip",
      compatibleClaimShapeKeys: ["mainnet:compx:v1:claim:rewards"],
      quote: {
        shapeKey: "mainnet:compx:v1:claim:rewards",
        input: { userAddress: "ADDR", poolAppId: 1 }
      },
      estimatedNetworkFeeMicroAlgos: "5000",
      estimatedNetworkFeeUsd: 0.001,
      worthClaiming: false
    }
  ];

  const result = computeRebalanceDeltas({
    positions: [],
    claimable,
    idleAlgoMicro: 4_000_000n,
    harvestIdle: true,
    includeClaims: true,
    minDeltaBps: 50
  });

  assert.deepEqual(
    result.intents.map((intent) => intent.kind),
    ["claim", "enter"]
  );
  assert.equal(result.intents[0]?.shapeKey, "mainnet:haystack:v1:claim:rewards");
  assert.equal(result.intents[1]?.amountRaw, "4000000");
  assert.equal(result.intents[1]?.opportunityId, null);
  assert.equal(result.intents[1]?.compileNow, true);
});

test("harvest-idle with idle ALGO funds underweight enters instead of deferring", () => {
  const result = computeRebalanceDeltas({
    positions: [
      position({
        positionId: "reti:a",
        opportunityId: "reti-staking-12",
        usdValue: 80,
        amountRaw: "8000000"
      }),
      position({
        positionId: "reti:b",
        opportunityId: "reti-staking-1",
        usdValue: 20,
        amountRaw: "2000000"
      })
    ],
    claimable: [],
    idleAlgoMicro: 3_000_000n,
    targetWeights: [
      { opportunityId: "reti-staking-12", weightBps: 5_000 },
      { opportunityId: "reti-staking-1", weightBps: 5_000 }
    ],
    harvestIdle: true,
    includeClaims: false,
    minDeltaBps: 50
  });

  const enters = result.intents.filter((intent) => intent.kind === "enter");
  assert.equal(enters.length, 1);
  assert.equal(enters[0]?.opportunityId, "reti-staking-1");
  assert.equal(enters[0]?.compileNow, true);
  assert.equal(enters[0]?.amountRaw, "3000000");
  assert.equal(enters[0]?.reason, "underweight-idle-algo");
});
