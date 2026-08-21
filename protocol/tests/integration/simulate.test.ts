import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import type { AccountHoldings } from "../../src/services/account-assets.js";
import { setSimulateDependenciesForTests } from "../../src/services/index.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const NOW = new Date("2026-08-21T12:00:00.000Z");

function holdings(algoMicro: bigint): AccountHoldings {
  return {
    heldAssetIds: algoMicro > 0n ? new Set([0]) : new Set(),
    balances: new Map([[0, algoMicro]])
  };
}

test.afterEach(() => {
  setSimulateDependenciesForTests(undefined);
});

test("POST /execution/simulate returns predicted deltas without signing", async () => {
  setSimulateDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => holdings(5_000_000n),
    fetchPositions: async () => []
  });
  const app = buildApp();
  await app.ready();

  try {
    const response = await app.inject({
      method: "POST",
      url: "/execution/simulate",
      payload: {
        address: VALID_ADDRESS,
        groups: [
          {
            shapeKey: "mainnet:reti:v1:stake:algo",
            opportunityId: "reti-staking-12",
            expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
            identity: {
              network: "mainnet",
              protocol: "reti",
              protocolVersion: "v1",
              action: "stake",
              variant: "algo"
            },
            transactions: [
              {
                type: "pay",
                sender: VALID_ADDRESS,
                fee: "1000",
                groupPresent: true,
                payment: {
                  receiver: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
                  amount: "1000000"
                }
              }
            ],
            encodedTransactions: ["AAAA"],
            capacity: {
              acceptingStake: true,
              stakerSlotsRemaining: 20,
              algoRoomMicroAlgos: "50000000000"
            }
          }
        ]
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: {
        wouldSucceed: boolean;
        signed: boolean;
        submitted: boolean;
        balanceDeltas: Array<{ assetId: number; delta: string }>;
      };
      meta: { executionSubmitted: boolean; signed: boolean; paymentRequired: boolean };
    };
    assert.equal(body.meta.paymentRequired, true);
    assert.equal(body.meta.executionSubmitted, false);
    assert.equal(body.meta.signed, false);
    assert.equal(body.data.signed, false);
    assert.equal(body.data.submitted, false);
    assert.equal(body.data.wouldSucceed, true);
    assert.equal(body.data.balanceDeltas[0]?.delta, "-1001000");
  } finally {
    await app.close();
  }
});

test("POST /execution/simulate rejects an invalid address with 400", async () => {
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/execution/simulate",
      payload: {
        address: "not-a-real-address",
        groups: [{ encodedTransactions: ["AAAA"] }]
      }
    });
    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
  }
});

test("POST /execution/simulate fails closed for a stale quote", async () => {
  setSimulateDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => holdings(5_000_000n)
  });
  const app = buildApp();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/execution/simulate",
      payload: {
        address: VALID_ADDRESS,
        groups: [
          {
            shapeKey: "mainnet:reti:v1:stake:algo",
            expiresAt: new Date(NOW.getTime() - 1_000).toISOString(),
            identity: {
              network: "mainnet",
              protocol: "reti",
              protocolVersion: "v1",
              action: "stake",
              variant: "algo"
            },
            transactions: [
              {
                type: "pay",
                sender: VALID_ADDRESS,
                fee: "1000",
                groupPresent: true,
                payment: {
                  receiver: VALID_ADDRESS,
                  amount: "1000"
                }
              }
            ],
            capacity: {
              acceptingStake: true,
              stakerSlotsRemaining: 1,
              algoRoomMicroAlgos: "50000000000"
            }
          }
        ]
      }
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: { wouldSucceed: boolean; reasons: Array<{ code: string }> };
    };
    assert.equal(body.data.wouldSucceed, false);
    assert.ok(body.data.reasons.some((reason) => reason.code === "stale-quote"));
  } finally {
    await app.close();
  }
});
