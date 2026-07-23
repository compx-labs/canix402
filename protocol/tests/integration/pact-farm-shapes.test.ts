import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { Escrow, Farm, LiquidityAddition, Pool } from "@pactfi/pactsdk";

import { buildApp } from "../../src/app.js";
import {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import {
  pactAddLiquidityAndFarmTwoSidedShape,
  pactFarmClaimRewardsShape,
  pactFarmDeployEscrowShape,
  pactFarmStakeShape,
  pactFarmUnstakeShape,
  setPactAddLiquidityAndFarmTwoSidedDependenciesForTests,
  setPactFarmClaimRewardsDependenciesForTests,
  setPactFarmDeployEscrowDependenciesForTests,
  setPactFarmStakeDependenciesForTests,
  setPactFarmUnstakeDependenciesForTests,
  type PactFarmState,
  type PactPoolState
} from "../../src/execution/shapes/pact/index.js";

const USER = algosdk.generateAccount();
const FARM_ESCROW = algosdk.generateAccount();
const POOL_ESCROW = algosdk.generateAccount();
const GAS_STATION = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const FARM_ESCROW_ADDRESS = FARM_ESCROW.addr.toString();
const POOL_ESCROW_ADDRESS = POOL_ESCROW.addr.toString();

const USDC_ID = 31566704;
const ALGO_ID = 0;
const PACT_POOL_APP_ID = 1072843805;
const PACT_LP_TOKEN_ID = 900002;
const PACT_FARM_APP_ID = 3625283323;
const PACT_FARM_ESCROW_APP_ID = 4_200_001;
const REWARD_ASSET_ID = 271_659_54;
const GENESIS_HASH = new Uint8Array(32).fill(7);

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

function farmState(options?: {
  hasEscrow?: boolean;
  userLpBalance?: bigint;
  userStaked?: bigint;
}): PactFarmState {
  const hasEscrow = options?.hasEscrow ?? true;
  const farm = {
    appId: PACT_FARM_APP_ID,
    stakedAsset: { index: PACT_LP_TOKEN_ID },
    state: { rewardAssets: [{ index: REWARD_ASSET_ID }] },
    setSuggestedParams: () => undefined,
    prepareDeployEscrowTxs: async () => [],
    fetchAllAssets: async () => undefined,
    getUserStateFromAccountInfo: () => null
  } as unknown as Farm;

  const escrow = hasEscrow
    ? ({
        appId: PACT_FARM_ESCROW_APP_ID,
        address: FARM_ESCROW_ADDRESS,
        userAddress: USER_ADDRESS,
        setSuggestedParams: () => undefined,
        buildStakeTxs: () => [],
        buildUnstakeTxs: () => [],
        buildClaimRewardsTx: () =>
          algosdk.makeApplicationNoOpTxnFromObject({
            sender: USER.addr,
            appIndex: BigInt(PACT_FARM_APP_ID),
            suggestedParams: suggestedParams(2000)
          })
      } as unknown as Escrow)
    : null;

  return {
    network: "mainnet",
    farmAppId: PACT_FARM_APP_ID,
    stakedAssetId: PACT_LP_TOKEN_ID,
    rewardAssetIds: [REWARD_ASSET_ID],
    userStaked: options?.userStaked ?? 5_000_000n,
    userLpBalance: options?.userLpBalance ?? 10_000_000n,
    escrowAppId: hasEscrow ? PACT_FARM_ESCROW_APP_ID : null,
    escrowAddress: hasEscrow ? FARM_ESCROW_ADDRESS : null,
    hasEscrow,
    farm,
    escrow
  };
}

function pactPoolState(): PactPoolState {
  const pool = {
    appId: PACT_POOL_APP_ID,
    primaryAsset: { index: ALGO_ID },
    secondaryAsset: { index: USDC_ID },
    liquidityAsset: { index: PACT_LP_TOKEN_ID },
    poolType: "CONSTANT_PRODUCT",
    version: 1,
    feeBps: 30,
    state: {
      totalLiquidity: 1_000_000,
      totalPrimary: 5_000_000,
      totalSecondary: 2_500_000,
      primaryAssetPrice: 1,
      secondaryAssetPrice: 1
    },
    getEscrowAddress: () => POOL_ESCROW_ADDRESS
  } as unknown as Pool;

  return {
    network: "mainnet",
    poolAppId: PACT_POOL_APP_ID,
    escrowAddress: POOL_ESCROW_ADDRESS,
    primaryAssetId: ALGO_ID,
    secondaryAssetId: USDC_ID,
    liquidityAssetId: PACT_LP_TOKEN_ID,
    poolType: "CONSTANT_PRODUCT",
    contractVersion: 1,
    feeBps: 30,
    reserves: pool.state,
    pool
  };
}

function buildDeployEscrowGroup(): algosdk.Transaction[] {
  const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: GAS_STATION.addr,
    amount: 200_000n,
    suggestedParams: suggestedParams(1000)
  });
  const createTxn = algosdk.makeApplicationCreateTxnFromObject({
    sender: USER.addr,
    approvalProgram: new Uint8Array([1, 32, 1, 1, 34]),
    clearProgram: new Uint8Array([1, 32, 1, 1, 34]),
    numGlobalInts: 1,
    numGlobalByteSlices: 0,
    numLocalInts: 0,
    numLocalByteSlices: 0,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [new Uint8Array([56, 136, 26, 113])],
    foreignApps: [PACT_FARM_APP_ID],
    foreignAssets: [PACT_LP_TOKEN_ID],
    suggestedParams: suggestedParams(5000)
  });
  const optInTxn = algosdk.makeApplicationOptInTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(PACT_FARM_APP_ID),
    suggestedParams: suggestedParams(1000)
  });
  const group = [fundTxn, createTxn, optInTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildStakeGroup(amount: bigint): algosdk.Transaction[] {
  const transferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: FARM_ESCROW.addr,
    amount,
    assetIndex: PACT_LP_TOKEN_ID,
    suggestedParams: suggestedParams(1000)
  });
  const updateTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(PACT_FARM_APP_ID),
    foreignApps: [PACT_FARM_ESCROW_APP_ID],
    foreignAssets: [PACT_LP_TOKEN_ID],
    accounts: [FARM_ESCROW_ADDRESS],
    suggestedParams: suggestedParams(3000)
  });
  const group = [transferTxn, updateTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildUnstakeGroup(): algosdk.Transaction[] {
  const unstakeTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(PACT_FARM_ESCROW_APP_ID),
    foreignApps: [PACT_FARM_APP_ID],
    foreignAssets: [PACT_LP_TOKEN_ID],
    suggestedParams: suggestedParams(3000)
  });
  return [unstakeTxn];
}

function buildClaimTxn(): algosdk.Transaction {
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(PACT_FARM_APP_ID),
    foreignApps: [PACT_FARM_ESCROW_APP_ID],
    foreignAssets: [REWARD_ASSET_ID],
    accounts: [USER_ADDRESS],
    suggestedParams: suggestedParams(2000)
  });
}

function buildAddLiquidityGroup(): algosdk.Transaction[] {
  const primaryTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL_ESCROW.addr,
    amount: 50_000n,
    suggestedParams: suggestedParams(1000)
  });
  const secondaryTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL_ESCROW.addr,
    amount: 100_000n,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(PACT_POOL_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [new TextEncoder().encode("ADDLIQ"), algosdk.encodeUint64(69_650n)],
    foreignAssets: [ALGO_ID, USDC_ID, PACT_LP_TOKEN_ID],
    suggestedParams: suggestedParams(3000)
  });
  return [primaryTxn, secondaryTxn, appTxn];
}

test.afterEach(() => {
  setPactFarmDeployEscrowDependenciesForTests(undefined);
  setPactFarmStakeDependenciesForTests(undefined);
  setPactFarmUnstakeDependenciesForTests(undefined);
  setPactFarmClaimRewardsDependenciesForTests(undefined);
  setPactAddLiquidityAndFarmTwoSidedDependenciesForTests(undefined);
});

test("POST /execution/quotes returns Pact farm deployEscrow quote", async () => {
  setPactFarmDeployEscrowDependenciesForTests({
    resolveFarmState: async () => farmState({ hasEscrow: false }),
    prepareDeployEscrowTxs: async () => buildDeployEscrowGroup(),
    getSuggestedParams: async () => suggestedParams(1000)
  });

  const app = buildApp();
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      quotes: [
        {
          shapeKey: pactFarmDeployEscrowShape.key,
          input: { userAddress: USER_ADDRESS, farmAppId: PACT_FARM_APP_ID }
        }
      ]
    }
  });

  assert.equal(
    response.statusCode,
    200,
    `unexpected status ${response.statusCode}: ${response.body}`
  );
  const body = response.json() as {
    data: Array<{ shapeKey: string; transactions: Array<{ type: string }> }>;
  };
  assert.equal(body.data[0]?.shapeKey, pactFarmDeployEscrowShape.key);
  assert.equal(body.data[0]?.transactions.length, 3);
  assert.deepEqual(
    body.data[0]?.transactions.map((txn) => txn.type),
    ["pay", "appl", "appl"]
  );
  await app.close();
});

test("POST /execution/quotes returns Pact farm stake quote with LP transfer to escrow", async () => {
  setPactFarmStakeDependenciesForTests({
    resolveFarmState: async () => farmState(),
    buildStakeTxs: (_escrow, amount) => buildStakeGroup(BigInt(amount)),
    getSuggestedParams: async () => suggestedParams(1000)
  });

  const app = buildApp();
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      quotes: [
        {
          shapeKey: pactFarmStakeShape.key,
          input: {
            userAddress: USER_ADDRESS,
            farmAppId: PACT_FARM_APP_ID,
            amount: "500000"
          }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: Array<{
      shapeKey: string;
      transactions: Array<{
        type: string;
        assetTransfer?: { receiver: string; amount: string; assetIndex: string };
      }>;
      metadata: { escrowAddress?: string };
    }>;
  };
  assert.equal(body.data[0]?.shapeKey, pactFarmStakeShape.key);
  assert.equal(body.data[0]?.transactions.length, 2);
  assert.equal(body.data[0]?.transactions[0]?.type, "axfer");
  assert.equal(body.data[0]?.transactions[0]?.assetTransfer?.receiver, FARM_ESCROW_ADDRESS);
  assert.equal(body.data[0]?.transactions[0]?.assetTransfer?.amount, "500000");
  assert.equal(body.data[0]?.transactions[0]?.assetTransfer?.assetIndex, String(PACT_LP_TOKEN_ID));
  assert.equal(body.data[0]?.metadata.escrowAddress, FARM_ESCROW_ADDRESS);
  await app.close();
});

test("POST /execution/quotes returns 400 when Pact farm stake has no escrow", async () => {
  setPactFarmStakeDependenciesForTests({
    resolveFarmState: async () => farmState({ hasEscrow: false }),
    buildStakeTxs: () => [],
    getSuggestedParams: async () => suggestedParams(1000)
  });

  const app = buildApp();
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      quotes: [
        {
          shapeKey: pactFarmStakeShape.key,
          input: {
            userAddress: USER_ADDRESS,
            farmAppId: PACT_FARM_APP_ID,
            amount: "500000"
          }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 400);
  const body = response.json() as { error?: { message?: string } };
  assert.match(body.error?.message ?? "", /deployEscrow/i);
  await app.close();
});

test("POST /execution/quotes returns Pact farm unstake quote", async () => {
  setPactFarmUnstakeDependenciesForTests({
    resolveFarmState: async () => farmState(),
    buildUnstakeTxs: () => buildUnstakeGroup(),
    getSuggestedParams: async () => suggestedParams(1000)
  });

  const app = buildApp();
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      quotes: [
        {
          shapeKey: pactFarmUnstakeShape.key,
          input: {
            userAddress: USER_ADDRESS,
            farmAppId: PACT_FARM_APP_ID,
            amount: "100000"
          }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: Array<{
      shapeKey: string;
      transactions: Array<{ type: string; applicationCall?: { appIndex: string } }>;
    }>;
  };
  assert.equal(body.data[0]?.shapeKey, pactFarmUnstakeShape.key);
  assert.equal(body.data[0]?.transactions.length, 1);
  assert.equal(
    body.data[0]?.transactions[0]?.applicationCall?.appIndex,
    String(PACT_FARM_ESCROW_APP_ID)
  );
  await app.close();
});

test("POST /execution/quotes returns Pact farm claimRewards quote", async () => {
  setPactFarmClaimRewardsDependenciesForTests({
    resolveFarmState: async () => farmState(),
    buildClaimRewardsTx: () => buildClaimTxn(),
    getSuggestedParams: async () => suggestedParams(1000),
    getAccountAssetIds: async () => new Set([0, REWARD_ASSET_ID, PACT_LP_TOKEN_ID])
  });

  const app = buildApp();
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      quotes: [
        {
          shapeKey: pactFarmClaimRewardsShape.key,
          input: { userAddress: USER_ADDRESS, farmAppId: PACT_FARM_APP_ID }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: Array<{
      shapeKey: string;
      transactions: Array<{ type: string; applicationCall?: { appIndex: string } }>;
    }>;
  };
  assert.equal(body.data[0]?.shapeKey, pactFarmClaimRewardsShape.key);
  assert.equal(body.data[0]?.transactions.length, 1);
  assert.equal(
    body.data[0]?.transactions[0]?.applicationCall?.appIndex,
    String(PACT_FARM_APP_ID)
  );
  await app.close();
});

test("POST /execution/quotes returns Pact addLiquidityAndFarm quote", async () => {
  const liquidityAddition = {
    primaryAssetAmount: 50_000,
    secondaryAssetAmount: 100_000,
    slippagePct: 0.5,
    effect: {
      mintedLiquidityTokens: 70_000,
      minimumMintedLiquidityTokens: 69_650,
      amplifier: 0,
      bonusPct: 0,
      txFee: 3000
    }
  } as LiquidityAddition;

  setPactAddLiquidityAndFarmTwoSidedDependenciesForTests({
    resolvePoolState: async () => pactPoolState(),
    resolveFarmState: async () => farmState(),
    prepareAddLiquidity: () => liquidityAddition,
    buildAddLiquidityTxs: () => buildAddLiquidityGroup(),
    buildStakeTxs: (_escrow, amount) => buildStakeGroup(BigInt(amount)),
    getSuggestedParams: async () => suggestedParams(1000)
  });

  const app = buildApp();
  await app.ready();
  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      quotes: [
        {
          shapeKey: pactAddLiquidityAndFarmTwoSidedShape.key,
          input: {
            userAddress: USER_ADDRESS,
            farmAppId: PACT_FARM_APP_ID,
            poolAppId: PACT_POOL_APP_ID,
            assetAId: USDC_ID,
            assetAAmount: "100000",
            assetBId: ALGO_ID,
            assetBAmount: "50000",
            maxSlippageBps: 50
          }
        }
      ]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: Array<{
      shapeKey: string;
      transactions: Array<{ type: string }>;
      metadata: { stakeAmount?: string };
    }>;
  };
  assert.equal(body.data[0]?.shapeKey, pactAddLiquidityAndFarmTwoSidedShape.key);
  assert.equal(body.data[0]?.transactions.length, 5);
  assert.equal(body.data[0]?.metadata.stakeAmount, "69650");
  await app.close();
});

test("addLiquidityAndFarm coerces algosdk v3 Address fields before Pact stake builders", async () => {
  const liquidityAddition = {
    primaryAssetAmount: 50_000,
    secondaryAssetAmount: 100_000,
    slippagePct: 0.5,
    effect: {
      mintedLiquidityTokens: 70_000,
      minimumMintedLiquidityTokens: 69_650,
      amplifier: 0,
      bonusPct: 0,
      txFee: 3000
    }
  } as LiquidityAddition;

  const state = farmState();
  // Simulate the dual-algosdk bug: Escrow fields arrived as algosdk v3 Address objects.
  (state.escrow as { userAddress: unknown }).userAddress = USER.addr;
  (state.escrow as { address: unknown }).address = FARM_ESCROW.addr;
  state.escrowAddress = FARM_ESCROW.addr as unknown as string;

  let observedUserAddress: unknown;
  let observedEscrowAddress: unknown;

  const pool = pactPoolState();
  (pool as { escrowAddress: unknown }).escrowAddress = POOL_ESCROW.addr;

  setPactAddLiquidityAndFarmTwoSidedDependenciesForTests({
    resolvePoolState: async () => pool,
    resolveFarmState: async () => state,
    prepareAddLiquidity: () => liquidityAddition,
    buildAddLiquidityTxs: () => buildAddLiquidityGroup(),
    buildStakeTxs: (escrow, amount) => {
      observedUserAddress = escrow.userAddress;
      observedEscrowAddress = escrow.address;
      return buildStakeGroup(BigInt(amount));
    },
    getSuggestedParams: async () => suggestedParams(1000)
  });

  const registry = new TransactionShapeRegistry();
  registry.register(pactAddLiquidityAndFarmTwoSidedShape);
  const quote = await compileExecutableQuote(
    registry,
    pactAddLiquidityAndFarmTwoSidedShape.key,
    {
      userAddress: USER_ADDRESS,
      farmAppId: PACT_FARM_APP_ID,
      poolAppId: PACT_POOL_APP_ID,
      assetAId: USDC_ID,
      assetAAmount: "100000",
      assetBId: ALGO_ID,
      assetBAmount: "50000",
      maxSlippageBps: 50
    },
    {
      network: "mainnet",
      algod: new algosdk.Algodv2("", "http://localhost", ""),
      now: () => Date.UTC(2026, 6, 23, 12, 0, 0),
      quoteTtlMs: 30_000
    }
  );

  assert.equal(typeof observedUserAddress, "string");
  assert.equal(typeof observedEscrowAddress, "string");
  assert.equal(observedUserAddress, USER_ADDRESS);
  assert.equal(observedEscrowAddress, FARM_ESCROW_ADDRESS);
  assert.equal(typeof pool.escrowAddress, "string");
  assert.equal(pool.escrowAddress, POOL_ESCROW_ADDRESS);
  assert.equal(quote.transactions.length, 5);
});
