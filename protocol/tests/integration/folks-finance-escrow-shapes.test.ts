import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { Pool, PoolInfo, PoolManagerInfo } from "@folks-finance/algorand-sdk";
import { MainnetDepositsAppId, MainnetOpUp } from "@folks-finance/algorand-sdk";

import {
  compileExecutableQuote,
  createExecutionRegistry,
  serializeTransaction
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  folksFinanceDepositEscrowShape,
  folksFinanceSetupDepositEscrowShape,
  folksFinanceSetupOptEscrowAssetShape,
  folksFinanceWithdrawEscrowShape,
  setFolksDepositEscrowDependenciesForTests,
  setFolksSetupDepositEscrowDependenciesForTests,
  setFolksSetupOptEscrowAssetDependenciesForTests,
  setFolksWithdrawEscrowDependenciesForTests
} from "../../src/execution/shapes/folks-finance/index.js";
import type { FolksPoolState } from "../../src/execution/shapes/folks-finance/pool-state.js";
import { computeEscrowWithdrawParams } from "../../src/execution/shapes/folks-finance/withdraw-escrow.js";

const USER = algosdk.generateAccount();
const ESCROW = algosdk.generateAccount();
const POOL_APP = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const ESCROW_ADDRESS = ESCROW.addr.toString();
const POOL_APP_ADDRESS = POOL_APP.addr.toString();
const USDC_POOL_APP_ID = 971372237;
const USDC_ASSET_ID = 31566704;
const FUSDC_ASSET_ID = 971384592;
const GENESIS_HASH = new Uint8Array(32).fill(13);

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
    now: () => Date.UTC(2026, 6, 10, 14, 0, 0),
    quoteTtlMs: 30_000
  };
}

function pool(): Pool {
  return {
    appId: USDC_POOL_APP_ID,
    assetId: USDC_ASSET_ID,
    fAssetId: FUSDC_ASSET_ID,
    frAssetId: 971384593,
    assetDecimals: 6,
    poolManagerIndex: 2,
    loans: {}
  };
}

function poolInfo(): PoolInfo {
  return {
    currentRound: 50_000_000,
    poolManagerAppId: 971350278,
    poolAdminAddress: USER_ADDRESS,
    paramsAdminAddress: USER_ADDRESS,
    configAdminAddress: USER_ADDRESS,
    loansAdminAddress: USER_ADDRESS,
    variableBorrow: {
      vr0: 0n,
      vr1: 0n,
      vr2: 0n,
      totalVariableBorrowAmount: 0n,
      variableBorrowInterestRate: 0n,
      variableBorrowInterestYield: 0n,
      variableBorrowInterestIndex: 0n
    },
    stableBorrow: {
      sr0: 0n,
      sr1: 0n,
      sr2: 0n,
      sr3: 0n,
      optimalStableToTotalDebtRatio: 0n,
      rebalanceUpUtilisationRatio: 0n,
      rebalanceUpDepositInterestRate: 0n,
      rebalanceDownDelta: 0n,
      totalStableBorrowAmount: 0n,
      stableBorrowInterestRate: 0n,
      stableBorrowInterestYield: 0n,
      overallStableBorrowInterestAmount: 0n
    },
    interest: {
      retentionRate: 0n,
      flashLoanFee: 0n,
      optimalUtilisationRatio: 0n,
      totalDeposits: 1_000_000_000_000n,
      depositInterestRate: 0n,
      depositInterestYield: 0n,
      depositInterestIndex: 1_050_000_000_000_000n,
      latestUpdate: 1_700_000_000n
    },
    caps: { borrowCap: 0n, stableBorrowPercentageCap: 0n },
    config: {
      depreciated: false,
      rewardsPaused: false,
      stableBorrowSupported: true,
      flashLoanSupported: true
    }
  };
}

function poolState(): FolksPoolState {
  return {
    network: "mainnet",
    symbol: "USDC",
    pool: pool(),
    poolInfo: poolInfo(),
    poolManagerInfo: { currentRound: 1, adminAddress: USER_ADDRESS, pools: {} } as PoolManagerInfo,
    depositInterestIndex: 1_050_000_000_000_000n,
    poolAppAddress: POOL_APP_ADDRESS
  };
}

function buildSetupEscrowGroup(): algosdk.Transaction[] {
  const userTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: algosdk.getApplicationAddress(MainnetDepositsAppId),
    amount: 0n,
    suggestedParams: suggestedParams(2000)
  });
  const escrowTxn = algosdk.makeApplicationOptInTxnFromObject({
    sender: ESCROW.addr,
    appIndex: BigInt(MainnetDepositsAppId),
    suggestedParams: suggestedParams(0)
  });
  const group = [userTxn, escrowTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildDepositEscrowGroup(): algosdk.Transaction[] {
  const opUp = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(MainnetOpUp.callerAppId),
    foreignApps: [BigInt(MainnetOpUp.baseAppId)],
    appArgs: [algosdk.encodeUint64(0)],
    suggestedParams: suggestedParams(1000)
  });
  const assetTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL_APP.addr,
    amount: 1_000_000n,
    assetIndex: USDC_ASSET_ID,
    suggestedParams: suggestedParams(0)
  });
  const appTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(USDC_POOL_APP_ID),
    suggestedParams: suggestedParams(4000)
  });
  const group = [opUp, assetTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

test("computeEscrowWithdrawParams maps amount denomination", () => {
  const fAssetParams = computeEscrowWithdrawParams({
    userAddress: USER_ADDRESS,
    amount: 500_000n,
    amountDenomination: "fAsset",
    poolAppId: USDC_POOL_APP_ID
  });
  assert.equal(fAssetParams.isfAssetAmount, true);
  assert.equal(fAssetParams.remainDeposited, false);

  const assetParams = computeEscrowWithdrawParams({
    userAddress: USER_ADDRESS,
    amount: 1_000_000n,
    amountDenomination: "asset",
    poolAppId: USDC_POOL_APP_ID
  });
  assert.equal(assetParams.isfAssetAmount, false);
});

test("setup deposit escrow shape builds funded 3-txn group with escrow metadata", async () => {
  setFolksSetupDepositEscrowDependenciesForTests({
    getSuggestedParams: async () => suggestedParams(1000),
    prepareAddDepositEscrowToDeposits: () => ({
      txns: buildSetupEscrowGroup(),
      escrow: ESCROW
    })
  });

  const result = await folksFinanceSetupDepositEscrowShape.build(
    buildContext(),
    { userAddress: USER_ADDRESS },
    { depositsAppId: MainnetDepositsAppId, depositsAppAddress: "DEPOSITS" }
  );

  assert.equal(result.transactions.length, 3);
  const fundingTxn = result.transactions[0]!;
  assert.equal(fundingTxn.payment?.receiver.toString(), ESCROW_ADDRESS);
  assert.equal(fundingTxn.payment?.amount, 250_000n);
  assert.equal(result.metadata.escrowAddress, ESCROW_ADDRESS);
  assert.equal(typeof result.metadata.escrowPrivateKeyBase64, "string");
  const validation = folksFinanceSetupDepositEscrowShape.validate(
    result.transactions.map(serializeTransaction),
    { userAddress: USER_ADDRESS },
    { depositsAppId: MainnetDepositsAppId, depositsAppAddress: "DEPOSITS" }
  );
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("deposit escrow shape validates 3-txn group", () => {
  const group = buildDepositEscrowGroup().map(serializeTransaction);
  const result = folksFinanceDepositEscrowShape.validate(
    group,
    {
      userAddress: USER_ADDRESS,
      assetAmount: 1_000_000n,
      poolAppId: USDC_POOL_APP_ID,
      escrowAddress: ESCROW_ADDRESS,
      includeOpUp: true
    },
    {
      poolState: poolState(),
      escrow: { escrowAddress: ESCROW_ADDRESS, optedIntoFAsset: true, fAssetBalance: 0n }
    }
  );
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("withdraw escrow shape validates single deposits-app call", () => {
  const withdrawTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(MainnetDepositsAppId),
    suggestedParams: suggestedParams(6000)
  });
  const group = [serializeTransaction(withdrawTxn)];

  const result = folksFinanceWithdrawEscrowShape.validate(
    group,
    {
      userAddress: USER_ADDRESS,
      amount: 500_000n,
      amountDenomination: "fAsset",
      poolAppId: USDC_POOL_APP_ID,
      escrowAddress: ESCROW_ADDRESS
    },
    {
      poolState: poolState(),
      escrow: { escrowAddress: ESCROW_ADDRESS, optedIntoFAsset: true, fAssetBalance: 2_000_000n }
    }
  );
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("registry includes all Folks escrow shapes", async () => {
  setFolksDepositEscrowDependenciesForTests({
    resolvePoolState: async () => poolState(),
    resolveEscrowContext: async () => ({
      escrowAddress: ESCROW_ADDRESS,
      optedIntoFAsset: true,
      fAssetBalance: 0n
    }),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareDepositIntoPool: () => buildDepositEscrowGroup().slice(1),
    prefixWithOpUp: () => buildDepositEscrowGroup(),
    getAccountAssetBalance: async () => 5_000_000n
  });

  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:folks-finance:v2:setup:depositEscrow"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:setup:optEscrowAsset"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:deposit:escrow"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:withdraw:escrow"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:deposit:wallet"), false);

  const quote = await compileExecutableQuote(
    registry,
    folksFinanceDepositEscrowShape.key,
    {
      userAddress: USER_ADDRESS,
      poolAppId: USDC_POOL_APP_ID,
      escrowAddress: ESCROW_ADDRESS,
      assetAmount: "1000000"
    },
    buildContext()
  );
  assert.equal(quote.transactions.length, 3);
});

test("opt escrow asset shape builds funded 2-transaction group", async () => {
  setFolksSetupOptEscrowAssetDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareOptDepositEscrowIntoAssetInDeposits: () =>
      algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER.addr,
        appIndex: BigInt(MainnetDepositsAppId),
        suggestedParams: suggestedParams(2000)
      }),
    isAccountOptedIntoAsset: async () => false
  });

  const result = await folksFinanceSetupOptEscrowAssetShape.build(
    buildContext(),
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      poolAppId: USDC_POOL_APP_ID
    },
    poolState()
  );

  assert.equal(result.transactions.length, 2);
  const fundingTxn = result.transactions[0]!;
  assert.equal(fundingTxn.payment?.receiver.toString(), ESCROW_ADDRESS);
  assert.equal(fundingTxn.payment?.amount, 100_000n);
  assert.equal(result.metadata.escrowAddress, ESCROW_ADDRESS);
  const validation = folksFinanceSetupOptEscrowAssetShape.validate(
    result.transactions.map(serializeTransaction),
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      poolAppId: USDC_POOL_APP_ID
    },
    poolState()
  );
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test.after(() => {
  setFolksSetupDepositEscrowDependenciesForTests(undefined);
  setFolksSetupOptEscrowAssetDependenciesForTests(undefined);
  setFolksDepositEscrowDependenciesForTests(undefined);
  setFolksWithdrawEscrowDependenciesForTests(undefined);
});
