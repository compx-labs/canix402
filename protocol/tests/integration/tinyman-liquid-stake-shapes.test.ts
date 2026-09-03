import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  STALGO_ASSET_ID,
  TALGO_ASSET_ID,
  TINYMAN_RESTAKE_APP_ID,
  TINYMAN_STAKE_APP_ID,
  TINYMAN_VAULT_APP_ID,
  TINY_ASSET_ID,
  setTinymanBurnTAlgoDependenciesForTests,
  setTinymanClaimRewardsStAlgoDependenciesForTests,
  setTinymanDecreaseStakeStAlgoDependenciesForTests,
  setTinymanIncreaseStakeStAlgoDependenciesForTests,
  setTinymanMintTAlgoDependenciesForTests,
  tinymanBurnTAlgoShape,
  tinymanClaimRewardsStAlgoShape,
  tinymanDecreaseStakeStAlgoShape,
  tinymanIncreaseStakeStAlgoShape,
  tinymanMintTAlgoShape,
  type TinymanLiquidStakeState
} from "../../src/execution/shapes/tinyman/index.js";

const USER = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const GENESIS_HASH = new Uint8Array(32).fill(9);
const STAKE_APP_ID = TINYMAN_STAKE_APP_ID.mainnet;
const RESTAKE_APP_ID = TINYMAN_RESTAKE_APP_ID.mainnet;
const VAULT_APP_ID = TINYMAN_VAULT_APP_ID.mainnet;
const TALGO_ID = TALGO_ASSET_ID.mainnet;
const STALGO_ID = STALGO_ASSET_ID.mainnet;
const TINY_ID = TINY_ASSET_ID.mainnet;
const STAKE_APP_ADDRESS = algosdk.getApplicationAddress(STAKE_APP_ID).toString();
const RESTAKE_APP_ADDRESS = algosdk.getApplicationAddress(RESTAKE_APP_ID).toString();

function suggestedParams(fee: number): algosdk.SuggestedParams {
  return {
    fee: BigInt(fee),
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
    now: () => Date.UTC(2026, 6, 16, 12, 0, 0),
    quoteTtlMs: 30_000
  };
}

function liquidStakeState(
  overrides: Partial<TinymanLiquidStakeState> = {}
): TinymanLiquidStakeState {
  return {
    network: "mainnet",
    stakeAppId: STAKE_APP_ID,
    stakeAppAddress: STAKE_APP_ADDRESS,
    restakeAppId: RESTAKE_APP_ID,
    restakeAppAddress: RESTAKE_APP_ADDRESS,
    vaultAppId: VAULT_APP_ID,
    tAlgoAssetId: TALGO_ID,
    stAlgoAssetId: STALGO_ID,
    tinyAssetId: TINY_ID,
    userAlgoBalance: 10_000_000n,
    userTAlgoBalance: 5_000_000n,
    userStAlgoBalance: 2_000_000n,
    algoToTAlgoRatio: 1.05,
    needsTAlgoOptIn: false,
    needsStAlgoOptIn: false,
    needsTinyOptIn: false,
    needsUserBoxPayment: false,
    needsApplyRateChange: false,
    ...overrides
  };
}

function buildMintGroup(amount: bigint, includeOptIn = false): algosdk.Transaction[] {
  const txns: algosdk.Transaction[] = [];
  if (includeOptIn) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: USER.addr,
        receiver: USER.addr,
        amount: 0n,
        assetIndex: TALGO_ID,
        suggestedParams: suggestedParams(1000)
      })
    );
  }
  txns.push(
    algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: USER.addr,
      receiver: algosdk.getApplicationAddress(STAKE_APP_ID),
      amount,
      suggestedParams: suggestedParams(1000)
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(STAKE_APP_ID),
      appArgs: [new TextEncoder().encode("mint"), algosdk.encodeUint64(amount)],
      foreignAssets: [TALGO_ID],
      suggestedParams: suggestedParams(2000)
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}

function buildBurnGroup(amount: bigint): algosdk.Transaction[] {
  const txns = [
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: USER.addr,
      receiver: algosdk.getApplicationAddress(STAKE_APP_ID),
      amount,
      assetIndex: TALGO_ID,
      suggestedParams: suggestedParams(1000)
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(STAKE_APP_ID),
      appArgs: [new TextEncoder().encode("burn"), algosdk.encodeUint64(amount)],
      suggestedParams: suggestedParams(2000)
    })
  ];
  algosdk.assignGroupID(txns);
  return txns;
}

function buildIncreaseStakeGroup(amount: bigint): algosdk.Transaction[] {
  const txns = [
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: USER.addr,
      receiver: algosdk.getApplicationAddress(RESTAKE_APP_ID),
      amount,
      assetIndex: TALGO_ID,
      suggestedParams: suggestedParams(1000)
    }),
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(RESTAKE_APP_ID),
      appArgs: [new TextEncoder().encode("increase_stake"), algosdk.encodeUint64(amount)],
      foreignApps: [VAULT_APP_ID],
      foreignAssets: [STALGO_ID],
      boxes: [
        { appIndex: 0n, name: algosdk.decodeAddress(USER_ADDRESS).publicKey },
        {
          appIndex: BigInt(VAULT_APP_ID),
          name: algosdk.decodeAddress(USER_ADDRESS).publicKey
        }
      ],
      suggestedParams: suggestedParams(3000)
    })
  ];
  algosdk.assignGroupID(txns);
  return txns;
}

function buildDecreaseStakeGroup(amount: bigint): algosdk.Transaction[] {
  const txns = [
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(RESTAKE_APP_ID),
      appArgs: [new TextEncoder().encode("decrease_stake"), algosdk.encodeUint64(amount)],
      foreignAssets: [TALGO_ID, STALGO_ID],
      boxes: [{ appIndex: 0n, name: algosdk.decodeAddress(USER_ADDRESS).publicKey }],
      suggestedParams: suggestedParams(3000)
    })
  ];
  algosdk.assignGroupID(txns);
  return txns;
}

function buildClaimRewardsGroup(): algosdk.Transaction[] {
  const txns = [
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(RESTAKE_APP_ID),
      appArgs: [new TextEncoder().encode("claim_rewards")],
      foreignAssets: [TINY_ID],
      foreignApps: [VAULT_APP_ID],
      boxes: [
        { appIndex: 0n, name: algosdk.decodeAddress(USER_ADDRESS).publicKey },
        {
          appIndex: BigInt(VAULT_APP_ID),
          name: algosdk.decodeAddress(USER_ADDRESS).publicKey
        }
      ],
      suggestedParams: suggestedParams(4000)
    })
  ];
  algosdk.assignGroupID(txns);
  return txns;
}

test.afterEach(() => {
  setTinymanMintTAlgoDependenciesForTests(undefined);
  setTinymanBurnTAlgoDependenciesForTests(undefined);
  setTinymanIncreaseStakeStAlgoDependenciesForTests(undefined);
  setTinymanDecreaseStakeStAlgoDependenciesForTests(undefined);
  setTinymanClaimRewardsStAlgoDependenciesForTests(undefined);
});

test("compiles Tinyman tALGO mint quote with payment + mint app call", async () => {
  setTinymanMintTAlgoDependenciesForTests({
    resolveState: async () => liquidStakeState(),
    mint: async ({ amount }) => buildMintGroup(amount)
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanMintTAlgoShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanMintTAlgoShape.key,
    { userAddress: USER_ADDRESS, amount: "1000000" },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.deepEqual(
    quote.transactions.map((txn) => txn.type),
    ["pay", "appl"]
  );
  assert.equal(quote.transactions[1]?.applicationCall?.appArgsText[0], "mint");
  assert.equal(quote.metadata.expectedTAlgoOut, "952380");
});

test("compiles Tinyman tALGO burn quote with axfer + burn app call", async () => {
  setTinymanBurnTAlgoDependenciesForTests({
    resolveState: async () => liquidStakeState(),
    burn: async ({ amount }) => buildBurnGroup(amount)
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanBurnTAlgoShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanBurnTAlgoShape.key,
    { userAddress: USER_ADDRESS, amount: "500000" },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.deepEqual(
    quote.transactions.map((txn) => txn.type),
    ["axfer", "appl"]
  );
  assert.equal(quote.transactions[1]?.applicationCall?.appArgsText[0], "burn");
});

test("compiles Tinyman stALGO increaseStake quote", async () => {
  setTinymanIncreaseStakeStAlgoDependenciesForTests({
    resolveState: async () => liquidStakeState(),
    increaseStake: async ({ amount }) => buildIncreaseStakeGroup(amount)
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanIncreaseStakeStAlgoShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanIncreaseStakeStAlgoShape.key,
    { userAddress: USER_ADDRESS, amount: "250000" },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.transactions[0]?.type, "axfer");
  assert.equal(quote.transactions[1]?.applicationCall?.appArgsText[0], "increase_stake");
});

test("compiles Tinyman stALGO decreaseStake quote", async () => {
  setTinymanDecreaseStakeStAlgoDependenciesForTests({
    resolveState: async () => liquidStakeState(),
    decreaseStake: async ({ amount }) => buildDecreaseStakeGroup(amount)
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanDecreaseStakeStAlgoShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanDecreaseStakeStAlgoShape.key,
    { userAddress: USER_ADDRESS, amount: "100000" },
    buildContext()
  );

  assert.equal(quote.transactions.length, 1);
  assert.equal(quote.transactions[0]?.applicationCall?.appArgsText[0], "decrease_stake");
});

test("compiles Tinyman stALGO claimRewards quote", async () => {
  setTinymanClaimRewardsStAlgoDependenciesForTests({
    resolveState: async () => liquidStakeState(),
    claimRewards: async () => buildClaimRewardsGroup()
  });

  const registry = new TransactionShapeRegistry();
  registry.register(tinymanClaimRewardsStAlgoShape);
  const quote = await compileExecutableQuote(
    registry,
    tinymanClaimRewardsStAlgoShape.key,
    { userAddress: USER_ADDRESS },
    buildContext()
  );

  assert.equal(quote.transactions.length, 1);
  assert.equal(quote.transactions[0]?.applicationCall?.appArgsText[0], "claim_rewards");
});

test("rejects Tinyman tALGO mint when amount is missing", async () => {
  const registry = new TransactionShapeRegistry();
  registry.register(tinymanMintTAlgoShape);

  await assert.rejects(
    () =>
      compileExecutableQuote(
        registry,
        tinymanMintTAlgoShape.key,
        { userAddress: USER_ADDRESS },
        buildContext()
      ),
    (error: Error & { code?: string }) => {
      assert.match(error.message, /amount/i);
      return true;
    }
  );
});

test("Tinyman liquid-stake and restake shape keys", () => {
  assert.equal(tinymanMintTAlgoShape.key, "mainnet:tinyman:liquid-stake-v1:mint:tAlgo");
  assert.equal(tinymanBurnTAlgoShape.key, "mainnet:tinyman:liquid-stake-v1:burn:tAlgo");
  assert.equal(
    tinymanIncreaseStakeStAlgoShape.key,
    "mainnet:tinyman:restake-v1:increaseStake:stAlgo"
  );
  assert.equal(
    tinymanDecreaseStakeStAlgoShape.key,
    "mainnet:tinyman:restake-v1:decreaseStake:stAlgo"
  );
  assert.equal(
    tinymanClaimRewardsStAlgoShape.key,
    "mainnet:tinyman:restake-v1:claimRewards:stAlgo"
  );
});
