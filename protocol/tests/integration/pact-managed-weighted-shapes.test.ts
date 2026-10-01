import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import { InvalidShapeInputError, ShapeStateError } from "../../src/execution/errors.js";
import { serializeTransaction } from "../../src/execution/types.js";
import type { SerializedTransaction, ShapeBuildContext } from "../../src/execution/types.js";
import {
  assetIdBoxName,
  pactManagedWeightedAddLiquidityShape,
  pactManagedWeightedRemoveLiquidityShape,
  proportionalMinimumOuts,
  setPactManagedWeightedAddLiquidityDependenciesForTests,
  setPactManagedWeightedRemoveLiquidityDependenciesForTests,
  setPactManagedWeightedStateDependenciesForTests
} from "../../src/execution/shapes/pact/index.js";
import { attachExecutionShapesToPosition } from "../../src/services/position-execution-shapes.js";
import type { PositionMarketRecord } from "../../src/services/position-execution-shapes.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const POOL_APP_ID = 3662410374;
const VAULT_APP_ID = 3656084807;
const LP_ASSET_ID = 3662410377;
const USDC_ID = 31566704;
const ALGO_ID = 0;
const GENESIS_HASH = new Uint8Array(32).fill(9);

const RESERVE_A = 10_000_000_000n;
const RESERVE_B = 1_000_000_000n;
const ISSUED_LP = 5_000_000_000n;

function suggestedParams(): algosdk.SuggestedParams {
  return {
    fee: 1000n,
    minFee: 1000n,
    firstValid: 1000n,
    lastValid: 2000n,
    genesisID: "mainnet-v1.0",
    genesisHash: GENESIS_HASH,
    flatFee: true
  };
}

function buildContext(): ShapeBuildContext {
  return {
    network: "mainnet",
    algod: new algosdk.Algodv2("", "http://localhost", ""),
    now: () => Date.UTC(2026, 6, 13, 9, 0, 0),
    quoteTtlMs: 30_000
  };
}

function stateKey(name: string): Uint8Array {
  return new TextEncoder().encode(name);
}

function uintEntry(name: string, value: bigint): {
  key: Uint8Array;
  value: { uint: bigint };
} {
  return { key: stateKey(name), value: { uint: value } };
}

function poolGlobalState(overrides: { bootstrapped?: bigint } = {}): Array<{
  key: Uint8Array;
  value: { uint: bigint };
}> {
  return [
    uintEntry("asset_a", BigInt(ALGO_ID)),
    uintEntry("asset_b", BigInt(USDC_ID)),
    uintEntry("reserve_a", RESERVE_A),
    uintEntry("reserve_b", RESERVE_B),
    uintEntry("issued_lp", ISSUED_LP),
    uintEntry("lp_asset", BigInt(LP_ASSET_ID)),
    uintEntry("weight_a", 5000n),
    uintEntry("vault", BigInt(VAULT_APP_ID)),
    uintEntry("swap_fee_bps", 30n),
    uintEntry("bootstrapped", overrides.bootstrapped ?? 1n)
  ];
}

function installPoolState(globalState = poolGlobalState()): void {
  setPactManagedWeightedStateDependenciesForTests({
    getApplication: async () => ({ params: { globalState } }),
    getApplicationAddress: (appId) => algosdk.getApplicationAddress(appId).toString()
  });
  setPactManagedWeightedAddLiquidityDependenciesForTests({
    getSuggestedParams: async () => suggestedParams(),
    isLpOptedIn: async () => false
  });
  setPactManagedWeightedRemoveLiquidityDependenciesForTests({
    getSuggestedParams: async () => suggestedParams()
  });
}

function serializedGroup(
  transactions: readonly algosdk.Transaction[]
): SerializedTransaction[] {
  return transactions.map((txn) => serializeTransaction(txn));
}

function clearOverrides(): void {
  setPactManagedWeightedStateDependenciesForTests(undefined);
  setPactManagedWeightedAddLiquidityDependenciesForTests(undefined);
  setPactManagedWeightedRemoveLiquidityDependenciesForTests(undefined);
}

test("managed-weighted reader rejects a pool that is not bootstrapped", async () => {
  installPoolState(poolGlobalState({ bootstrapped: 0n }));
  try {
    const input = pactManagedWeightedAddLiquidityShape.parseInput({
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      assetAId: ALGO_ID,
      assetAAmount: "1000000",
      assetBId: USDC_ID,
      assetBAmount: "100000",
      maxSlippageBps: 50
    });
    await assert.rejects(
      () => pactManagedWeightedAddLiquidityShape.resolveState(buildContext(), input),
      (error: unknown) => {
        assert.ok(error instanceof ShapeStateError);
        assert.match(error.message, /not bootstrapped/);
        return true;
      }
    );
  } finally {
    clearOverrides();
  }
});

test("managed-weighted add deposits to the vault and refs asset boxes", async () => {
  installPoolState();
  try {
    const input = pactManagedWeightedAddLiquidityShape.parseInput({
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      assetAId: ALGO_ID,
      assetAAmount: "1000000",
      assetBId: USDC_ID,
      assetBAmount: "100000",
      maxSlippageBps: 50
    });
    const state = await pactManagedWeightedAddLiquidityShape.resolveState(buildContext(), input);
    const built = await pactManagedWeightedAddLiquidityShape.build(buildContext(), input, state);
    const group = serializedGroup(built.transactions);
    const vaultAddress = algosdk.getApplicationAddress(VAULT_APP_ID).toString();

    assert.equal(group.length, 4);
    assert.equal(group[0]?.type, "axfer");
    assert.equal(group[0]?.assetTransfer?.receiver, USER_ADDRESS);
    assert.equal(group[0]?.assetTransfer?.assetIndex, String(LP_ASSET_ID));
    assert.equal(group[0]?.assetTransfer?.amount, "0");

    assert.equal(group[1]?.type, "pay");
    assert.equal(group[1]?.payment?.receiver, vaultAddress);
    assert.equal(group[1]?.payment?.amount, "1000000");

    assert.equal(group[2]?.type, "axfer");
    assert.equal(group[2]?.assetTransfer?.receiver, vaultAddress);
    assert.equal(group[2]?.assetTransfer?.assetIndex, String(USDC_ID));
    assert.equal(group[2]?.assetTransfer?.amount, "100000");

    const call = group[3]?.applicationCall;
    assert.ok(call);
    assert.equal(call.appArgsBase64[0], "ZEkhvw==");
    assert.equal(call.appArgsBase64.length, 1);
    assert.deepEqual(call.foreignApps, [String(VAULT_APP_ID)]);
    assert.deepEqual(call.foreignAssets, [String(USDC_ID), String(LP_ASSET_ID)]);
    assert.deepEqual(
      call.boxes.map((box) => box.nameBase64),
      [ALGO_ID, USDC_ID].map((assetId) => Buffer.from(assetIdBoxName(assetId)).toString("base64"))
    );
    assert.ok(call.boxes.every((box) => box.appIndex === String(VAULT_APP_ID)));
    assert.equal(group[3]?.fee, "3000");
    assert.ok(group.every((txn) => txn.groupPresent));
    assert.equal(built.metadata.expectedMintedLiquidityTokens, "500000");
    assert.equal(built.metadata.includedLpOptIn, true);

    const valid = pactManagedWeightedAddLiquidityShape.validate(group, input, state);
    assert.deepEqual(valid.errors, []);
    assert.equal(valid.valid, true);
  } finally {
    clearOverrides();
  }
});

test("managed-weighted add skips the LP opt-in when the wallet already holds it", async () => {
  installPoolState();
  setPactManagedWeightedAddLiquidityDependenciesForTests({
    getSuggestedParams: async () => suggestedParams(),
    isLpOptedIn: async () => true
  });
  try {
    const input = pactManagedWeightedAddLiquidityShape.parseInput({
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      assetAId: USDC_ID,
      assetAAmount: "100000",
      assetBId: ALGO_ID,
      assetBAmount: "1000000",
      maxSlippageBps: 50
    });
    const state = await pactManagedWeightedAddLiquidityShape.resolveState(buildContext(), input);
    const built = await pactManagedWeightedAddLiquidityShape.build(buildContext(), input, state);
    const group = serializedGroup(built.transactions);
    assert.equal(group.length, 3);
    assert.equal(group[0]?.type, "pay");
    assert.equal(built.metadata.includedLpOptIn, false);
    const valid = pactManagedWeightedAddLiquidityShape.validate(group, input, state);
    assert.equal(valid.valid, true);
  } finally {
    clearOverrides();
  }
});

test("managed-weighted add rejects a deposit ratio outside maxSlippageBps", async () => {
  installPoolState();
  try {
    const input = pactManagedWeightedAddLiquidityShape.parseInput({
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      assetAId: ALGO_ID,
      assetAAmount: "1000000",
      assetBId: USDC_ID,
      assetBAmount: "200000",
      maxSlippageBps: 50
    });
    const state = await pactManagedWeightedAddLiquidityShape.resolveState(buildContext(), input);
    await assert.rejects(
      () => pactManagedWeightedAddLiquidityShape.build(buildContext(), input, state),
      (error: unknown) => {
        assert.ok(error instanceof InvalidShapeInputError);
        assert.match(error.message, /maxSlippageBps/);
        return true;
      }
    );
  } finally {
    clearOverrides();
  }
});

test("managed-weighted remove sends LP to the pool and encodes both minimums", async () => {
  installPoolState();
  try {
    const input = pactManagedWeightedRemoveLiquidityShape.parseInput({
      userAddress: USER_ADDRESS,
      poolAppId: POOL_APP_ID,
      liquidityAmount: "1000000",
      maxSlippageBps: 50
    });
    const state = await pactManagedWeightedRemoveLiquidityShape.resolveState(buildContext(), input);
    const built = await pactManagedWeightedRemoveLiquidityShape.build(buildContext(), input, state);
    const group = serializedGroup(built.transactions);
    const [lpTxn, appTxn] = group;
    const poolAddress = algosdk.getApplicationAddress(POOL_APP_ID).toString();
    const mins = proportionalMinimumOuts({
      liquidityAmount: 1_000_000n,
      reserveA: RESERVE_A,
      reserveB: RESERVE_B,
      issuedLp: ISSUED_LP,
      maxSlippageBps: 50
    });

    assert.equal(group.length, 2);
    assert.equal(lpTxn?.type, "axfer");
    assert.equal(lpTxn?.assetTransfer?.receiver, poolAddress);
    assert.equal(lpTxn?.assetTransfer?.assetIndex, String(LP_ASSET_ID));
    assert.equal(lpTxn?.assetTransfer?.amount, "1000000");

    const call = appTxn?.applicationCall;
    assert.ok(call);
    assert.equal(call.appArgsBase64[0], "U6NrJA==");
    assert.equal(algosdk.decodeUint64(Buffer.from(call.appArgsBase64[1]!, "base64"), "bigint"), mins.minA);
    assert.equal(algosdk.decodeUint64(Buffer.from(call.appArgsBase64[2]!, "base64"), "bigint"), mins.minB);
    assert.deepEqual(call.foreignApps, [String(VAULT_APP_ID)]);
    assert.deepEqual(call.foreignAssets, [String(USDC_ID)]);
    assert.equal(appTxn?.fee, "3000");
    assert.ok(group.every((txn) => txn.groupPresent));
    assert.equal(built.metadata.minimumAssetAOut, mins.minA.toString());
    assert.equal(built.metadata.minimumAssetBOut, mins.minB.toString());

    const valid = pactManagedWeightedRemoveLiquidityShape.validate(group, input, state);
    assert.deepEqual(valid.errors, []);
    assert.equal(valid.valid, true);
  } finally {
    clearOverrides();
  }
});

test("Pact LP positions expose one exit shape for the pool generation", () => {
  const live: PositionMarketRecord = {
    protocol: "pact",
    positionType: "lp",
    positionId: "pact:lp:1",
    opportunityId: "3662410374:lp",
    assetId: LP_ASSET_ID,
    assetSymbol: "ALGO/USDC LP",
    amountRaw: "1",
    amount: "0.000001",
    usdValue: null,
    pactPoolDeprecated: false
  };
  const legacy: PositionMarketRecord = {
    ...live,
    positionId: "pact:lp:2",
    pactPoolDeprecated: true
  };

  const livePublic = attachExecutionShapesToPosition(live);
  const legacyPublic = attachExecutionShapesToPosition(legacy);

  assert.deepEqual(livePublic.compatibleExitShapeKeys, [
    "mainnet:pact:v201:removeLiquidity:proportional"
  ]);
  assert.deepEqual(legacyPublic.compatibleExitShapeKeys, [
    "mainnet:pact:v1:removeLiquidity:proportional"
  ]);
  assert.equal("pactPoolDeprecated" in livePublic, false);
  assert.equal("pactPoolDeprecated" in legacyPublic, false);
});
