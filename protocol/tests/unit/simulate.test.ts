import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import type { AccountHoldings } from "../../src/services/account-assets.js";
import {
  executableQuoteToSimulateGroup,
  setSimulateDependenciesForTests,
  simulateCompiledGroups,
  simulateQuotesForPlan
} from "../../src/services/simulate.js";
import { encodeUnsignedTransactionBase64 } from "../../src/execution/types.js";
import type { ExecutableQuote, SerializedTransaction } from "../../src/execution/types.js";
import type { PositionRecordV1 } from "../../src/types/position.js";

const VALID_ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const NOW = new Date("2026-08-21T12:00:00.000Z");
const USDC_ASSET_ID = 31566704; // pragma: allowlist secret

function holdings(algoMicro: bigint, extras: Array<[number, bigint]> = []): AccountHoldings {
  const balances = new Map<number, bigint>([[0, algoMicro], ...extras]);
  const heldAssetIds = new Set<number>();
  for (const [assetId, amount] of balances) {
    if (amount > 0n) {
      heldAssetIds.add(assetId);
    }
  }
  return { heldAssetIds, balances };
}

function payTxn(amount: string, fee = "1000"): SerializedTransaction {
  return {
    type: "pay",
    sender: VALID_ADDRESS,
    fee,
    groupPresent: true,
    payment: {
      receiver: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
      amount
    }
  };
}

function axferTxn(assetId: number, amount: string, receiver = VALID_ADDRESS): SerializedTransaction {
  return {
    type: "axfer",
    sender: VALID_ADDRESS,
    fee: "1000",
    groupPresent: true,
    assetTransfer: {
      assetIndex: String(assetId),
      amount,
      receiver
    }
  };
}

function stakeQuote(overrides: Partial<ExecutableQuote> = {}): ExecutableQuote {
  return {
    shapeKey: "mainnet:reti:v1:stake:algo",
    shapeVersion: "1.0.0",
    identity: {
      network: "mainnet",
      protocol: "reti",
      protocolVersion: "v1",
      action: "stake",
      variant: "algo"
    },
    createdAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
    transactions: [payTxn("1000000")],
    encodedTransactions: ["AAAA"],
    warnings: [],
    metadata: {},
    ...overrides
  };
}

function installStubs(options: {
  holdings?: AccountHoldings;
  positions?: PositionRecordV1[];
} = {}): void {
  setSimulateDependenciesForTests({
    now: () => NOW,
    fetchHoldings: async () => options.holdings ?? holdings(5_000_000n),
    fetchPositions: async () => options.positions ?? []
  });
}

test.afterEach(() => {
  setSimulateDependenciesForTests(undefined);
});

test("happy-path ALGO stake predicts fee + stake deltas and succeeds", async () => {
  installStubs({ holdings: holdings(5_000_000n) });

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      {
        ...executableQuoteToSimulateGroup(stakeQuote(), {
          opportunityId: "reti-staking-12",
          capacity: {
            acceptingStake: true,
            stakerSlotsRemaining: 20,
            algoRoomMicroAlgos: "50000000000"
          }
        })
      }
    ]
  });

  assert.equal(response.meta.executionSubmitted, false);
  assert.equal(response.meta.signed, false);
  assert.equal(response.data.signed, false);
  assert.equal(response.data.submitted, false);
  assert.equal(response.data.wouldSucceed, true);
  assert.equal(response.data.reasons.length, 0);
  const algo = response.data.balanceDeltas.find((row) => row.assetId === 0);
  assert.ok(algo);
  assert.equal(algo.delta, "-1001000");
  assert.equal(algo.after, "3999000");
  assert.equal(response.data.expectedPositionDelta.entries[0]?.action, "enter");
  assert.equal(response.data.expectedPositionDelta.entries[0]?.amount, "1000000");
  assert.equal(response.data.expectedPositionDelta.entries[0]?.opportunityId, "reti-staking-12");
});

test("stale quote fails closed with stale-quote", async () => {
  installStubs();

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      executableQuoteToSimulateGroup(
        stakeQuote({
          expiresAt: new Date(NOW.getTime() - 1_000).toISOString()
        }),
        {
          opportunityId: "reti-staking-12",
          capacity: {
            acceptingStake: true,
            stakerSlotsRemaining: 5,
            algoRoomMicroAlgos: "50000000000"
          }
        }
      )
    ]
  });

  assert.equal(response.data.wouldSucceed, false);
  assert.ok(response.data.reasons.some((reason) => reason.code === "stale-quote"));
});

test("not opted in fails closed when spending an ASA the wallet does not hold", async () => {
  installStubs({ holdings: holdings(5_000_000n) });

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      {
        shapeKey: "mainnet:compx:v1:deposit:asa",
        identity: {
          network: "mainnet",
          protocol: "compx",
          protocolVersion: "v1",
          action: "deposit",
          variant: "asa"
        },
        expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
        transactions: [axferTxn(USDC_ASSET_ID, "1000000", "COMPXRECEIVERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")],
        encodedTransactions: ["AAAA"]
      }
    ]
  });

  assert.equal(response.data.wouldSucceed, false);
  assert.ok(response.data.reasons.some((reason) => reason.code === "not-opted-in"));
  assert.ok(response.data.reasons.some((reason) => reason.assetId === USDC_ASSET_ID));
});

test("min-balance fails closed when remaining ALGO would drop below MBR", async () => {
  installStubs({ holdings: holdings(150_000n) });

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      executableQuoteToSimulateGroup(stakeQuote({ transactions: [payTxn("50000")] }), {
        opportunityId: "reti-staking-12",
        capacity: {
          acceptingStake: true,
          stakerSlotsRemaining: 5,
          algoRoomMicroAlgos: "50000000000"
        }
      })
    ]
  });

  assert.equal(response.data.wouldSucceed, false);
  assert.ok(response.data.reasons.some((reason) => reason.code === "min-balance"));
});

test("health factor too low fails closed on borrow when HF is at or below 1", async () => {
  const debt: PositionRecordV1 = {
    protocol: "compx",
    positionType: "debt",
    positionId: "compx:debt:1",
    opportunityId: "compx-lending-1",
    assetId: USDC_ASSET_ID,
    assetSymbol: "USDC",
    amountRaw: "1000000",
    amount: "1",
    usdValue: 1,
    healthFactor: 0.9,
    compatibleExitShapeKeys: ["mainnet:compx:v1:repay:asa"],
    compatibleManageShapeKeys: []
  };
  installStubs({
    holdings: holdings(5_000_000n, [[USDC_ASSET_ID, 2_000_000n]]),
    positions: [debt]
  });

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      {
        shapeKey: "mainnet:compx:v1:borrow:asa",
        identity: {
          network: "mainnet",
          protocol: "compx",
          protocolVersion: "v1",
          action: "borrow",
          variant: "asa"
        },
        expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
        transactions: [
          {
            type: "appl",
            sender: VALID_ADDRESS,
            fee: "2000",
            groupPresent: true,
            applicationCall: {
              appIndex: "1",
              onComplete: 0,
              appArgsBase64: [],
              appArgsText: [],
              accounts: [],
              foreignApps: [],
              foreignAssets: [String(USDC_ASSET_ID)],
              boxes: []
            }
          }
        ],
        encodedTransactions: ["AAAA"]
      }
    ]
  });

  assert.equal(response.data.wouldSucceed, false);
  assert.ok(
    response.data.reasons.some((reason) => reason.code === "health-factor-too-low")
  );
});

test("borrow without a health factor fails closed", async () => {
  installStubs({ holdings: holdings(5_000_000n) });

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      {
        shapeKey: "mainnet:dorkfi:v1:borrow:asa",
        identity: {
          network: "mainnet",
          protocol: "dorkfi",
          protocolVersion: "v1",
          action: "borrow",
          variant: "asa"
        },
        expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
        transactions: [payTxn("0", "2000")],
        encodedTransactions: ["AAAA"]
      }
    ]
  });

  assert.equal(response.data.wouldSucceed, false);
  assert.ok(
    response.data.reasons.some((reason) => reason.code === "health-factor-too-low")
  );
});

test("Réti capacity fail-closed when validator is not accepting stake", async () => {
  installStubs();

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      executableQuoteToSimulateGroup(stakeQuote(), {
        opportunityId: "reti-staking-12",
        capacity: {
          acceptingStake: false,
          stakerSlotsRemaining: 20,
          algoRoomMicroAlgos: "50000000000"
        }
      })
    ]
  });

  assert.equal(response.data.wouldSucceed, false);
  assert.ok(response.data.reasons.some((reason) => reason.code === "capacity"));
});

test("Réti stake without capacity info fails closed", async () => {
  installStubs();

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [executableQuoteToSimulateGroup(stakeQuote())]
  });

  assert.equal(response.data.wouldSucceed, false);
  assert.ok(response.data.reasons.some((reason) => reason.code === "capacity"));
});

test("malformed encodedTransactions fails closed", async () => {
  installStubs();

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      {
        encodedTransactions: ["%%%not-base64-txn%%%"]
      }
    ]
  });

  assert.equal(response.data.wouldSucceed, false);
  assert.ok(response.data.reasons.some((reason) => reason.code === "malformed-group"));
});

test("unsigned encoded payment group predicts ALGO delta without signing", async () => {
  installStubs({ holdings: holdings(5_000_000n) });
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: VALID_ADDRESS,
    receiver: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
    amount: 1_000_000,
    suggestedParams: {
      fee: 1000n,
      minFee: 1000n,
      firstValid: 1n,
      lastValid: 1001n,
      genesisID: "mainnet-v1.0",
      genesisHash: new Uint8Array(32).fill(9),
      flatFee: true
    }
  });

  const response = await simulateCompiledGroups({
    address: VALID_ADDRESS,
    groups: [
      {
        shapeKey: "mainnet:reti:v1:stake:algo",
        identity: {
          network: "mainnet",
          protocol: "reti",
          protocolVersion: "v1",
          action: "stake",
          variant: "algo"
        },
        expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
        encodedTransactions: [encodeUnsignedTransactionBase64(txn)],
        capacity: {
          acceptingStake: true,
          stakerSlotsRemaining: 3,
          algoRoomMicroAlgos: "50000000000"
        }
      }
    ]
  });

  assert.equal(response.data.wouldSucceed, true);
  assert.equal(response.data.signed, false);
  assert.equal(response.data.submitted, false);
  const algo = response.data.balanceDeltas.find((row) => row.assetId === 0);
  assert.equal(algo?.delta, "-1001000");
});

test("simulateQuotesForPlan attaches the same fail-closed summary used by POST /plans", () => {
  const summary = simulateQuotesForPlan({
    address: VALID_ADDRESS,
    holdings: holdings(5_000_000n),
    now: NOW,
    groups: [
      executableQuoteToSimulateGroup(stakeQuote(), {
        opportunityId: "reti-staking-12",
        capacity: {
          acceptingStake: true,
          stakerSlotsRemaining: 20,
          algoRoomMicroAlgos: "50000000000"
        }
      })
    ]
  });

  assert.equal(summary.wouldSucceed, true);
  assert.equal(summary.signed, false);
  assert.equal(summary.submitted, false);
  assert.equal(summary.expectedPositionDelta.entries[0]?.action, "enter");
});
