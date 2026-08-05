import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { Pool, PoolInfo, PoolManagerInfo } from "@folks-finance/algorand-sdk";
import { MainnetLoans, MainnetOpUp } from "@folks-finance/algorand-sdk";

import {
  InvalidShapeInputError,
  compileExecutableQuote,
  createExecutionRegistry,
  serializeTransaction
} from "../../src/execution/index.js";
import type { ShapeBuildContext } from "../../src/execution/index.js";
import {
  FOLKS_GENERAL_LOAN_APP_ID,
  folksFinanceBorrowVariableShape,
  folksFinanceCollateralReduceShape,
  folksFinanceCollateralSyncShape,
  folksFinanceRepayWithTxnShape,
  folksFinanceSetupAddCollateralShape,
  folksFinanceSetupLoanEscrowShape,
  setFolksBorrowVariableDependenciesForTests,
  setFolksCollateralReduceDependenciesForTests,
  setFolksCollateralSyncDependenciesForTests,
  setFolksRepayWithTxnDependenciesForTests,
  setFolksSetupAddCollateralDependenciesForTests,
  setFolksSetupLoanEscrowDependenciesForTests
} from "../../src/execution/shapes/folks-finance/index.js";
import type { FolksPoolState } from "../../src/execution/shapes/folks-finance/pool-state.js";

const USER = algosdk.generateAccount();
const ESCROW = algosdk.generateAccount();
const POOL_APP = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const ESCROW_ADDRESS = ESCROW.addr.toString();
const POOL_APP_ADDRESS = POOL_APP.addr.toString();
const USDC_POOL_APP_ID = 971372237;
const USDC_ASSET_ID = 31566704;
const FUSDC_ASSET_ID = 971384592;
const LOAN_APP_ID = MainnetLoans.GENERAL ?? FOLKS_GENERAL_LOAN_APP_ID;
const GENESIS_HASH = new Uint8Array(32).fill(17);

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
    now: () => Date.UTC(2026, 7, 3, 10, 0, 0),
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
    loans: {
      [LOAN_APP_ID]: 2n
    }
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

function buildCreateLoanGroup(): algosdk.Transaction[] {
  const userTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: algosdk.getApplicationAddress(LOAN_APP_ID),
    amount: 0n,
    suggestedParams: suggestedParams(2000)
  });
  const escrowTxn = algosdk.makeApplicationOptInTxnFromObject({
    sender: ESCROW.addr,
    appIndex: BigInt(LOAN_APP_ID),
    suggestedParams: suggestedParams(0)
  });
  const group = [userTxn, escrowTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildBorrowGroup(includeOpUp: boolean): algosdk.Transaction[] {
  const txns: algosdk.Transaction[] = [];
  if (includeOpUp) {
    txns.push(
      algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER.addr,
        appIndex: BigInt(MainnetOpUp.callerAppId),
        foreignApps: [BigInt(MainnetOpUp.baseAppId)],
        appArgs: [algosdk.encodeUint64(0)],
        suggestedParams: suggestedParams(1000)
      })
    );
  }
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(MainnetOpUp.baseAppId),
      suggestedParams: suggestedParams(1000)
    })
  );
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(LOAN_APP_ID),
      suggestedParams: suggestedParams(8000)
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}

function buildRepayGroup(): algosdk.Transaction[] {
  const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL_APP.addr,
    amount: 500_000n,
    assetIndex: USDC_ASSET_ID,
    suggestedParams: suggestedParams(0)
  });
  const appCall = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(LOAN_APP_ID),
    suggestedParams: suggestedParams(10_000)
  });
  const group = [transfer, appCall];
  algosdk.assignGroupID(group);
  return group;
}

function buildSyncGroup(includeOpUp: boolean): algosdk.Transaction[] {
  const txns: algosdk.Transaction[] = [];
  if (includeOpUp) {
    txns.push(
      algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER.addr,
        appIndex: BigInt(MainnetOpUp.callerAppId),
        foreignApps: [BigInt(MainnetOpUp.baseAppId)],
        appArgs: [algosdk.encodeUint64(0)],
        suggestedParams: suggestedParams(1000)
      })
    );
  }
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: USER.addr,
      appIndex: BigInt(LOAN_APP_ID),
      suggestedParams: suggestedParams(1000)
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}

test.afterEach(() => {
  setFolksSetupLoanEscrowDependenciesForTests(undefined);
  setFolksSetupAddCollateralDependenciesForTests(undefined);
  setFolksCollateralSyncDependenciesForTests(undefined);
  setFolksBorrowVariableDependenciesForTests(undefined);
  setFolksRepayWithTxnDependenciesForTests(undefined);
  setFolksCollateralReduceDependenciesForTests(undefined);
});

test("loan shapes default loanAppId to GENERAL", () => {
  const parsed = folksFinanceSetupLoanEscrowShape.parseInput({
    userAddress: USER_ADDRESS
  });
  assert.equal(parsed.loanAppId, LOAN_APP_ID);
});

test("borrow shape rejects missing pool selector", () => {
  assert.throws(
    () =>
      folksFinanceBorrowVariableShape.parseInput({
        userAddress: USER_ADDRESS,
        escrowAddress: ESCROW_ADDRESS,
        borrowAmount: "1000"
      }),
    InvalidShapeInputError
  );
});

test("setup loan escrow builds funded 3-txn group with escrow metadata", async () => {
  setFolksSetupLoanEscrowDependenciesForTests({
    getSuggestedParams: async () => suggestedParams(1000),
    prepareCreateUserLoan: () => ({
      txns: buildCreateLoanGroup(),
      escrow: ESCROW
    })
  });

  const result = await folksFinanceSetupLoanEscrowShape.build(
    buildContext(),
    { userAddress: USER_ADDRESS, loanAppId: LOAN_APP_ID },
    { loanAppId: LOAN_APP_ID }
  );

  assert.equal(result.transactions.length, 3);
  assert.equal(result.metadata.escrowAddress, ESCROW_ADDRESS);
  assert.equal(typeof result.metadata.escrowPrivateKeyBase64, "string");
  const validation = folksFinanceSetupLoanEscrowShape.validate(
    result.transactions.map(serializeTransaction),
    { userAddress: USER_ADDRESS, loanAppId: LOAN_APP_ID },
    { loanAppId: LOAN_APP_ID }
  );
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("add collateral shape builds and validates single app call", async () => {
  setFolksSetupAddCollateralDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareAddCollateralToLoan: () =>
      algosdk.makeApplicationNoOpTxnFromObject({
        sender: USER.addr,
        appIndex: BigInt(LOAN_APP_ID),
        suggestedParams: suggestedParams(2000)
      })
  });

  const registry = createExecutionRegistry();
  const quote = await compileExecutableQuote(
    registry,
    folksFinanceSetupAddCollateralShape.key,
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      poolAppId: USDC_POOL_APP_ID
    },
    buildContext()
  );
  assert.equal(quote.transactions.length, 1);
});

test("collateral sync shape validates OpUp + loan app call", () => {
  const group = buildSyncGroup(true).map(serializeTransaction);
  const result = folksFinanceCollateralSyncShape.validate(
    group,
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      loanAppId: LOAN_APP_ID,
      poolAppId: USDC_POOL_APP_ID,
      includeOpUp: true
    },
    { poolState: poolState(), loanAppId: LOAN_APP_ID }
  );
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("borrow variable shape compiles executable quote", async () => {
  const group = buildBorrowGroup(true);
  setFolksBorrowVariableDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareBorrowFromLoan: () => group.slice(1),
    prefixWithOpUp: () => group
  });

  const registry = createExecutionRegistry();
  const quote = await compileExecutableQuote(
    registry,
    folksFinanceBorrowVariableShape.key,
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      poolAppId: USDC_POOL_APP_ID,
      borrowAmount: "1000000"
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 3);
  assert.equal(quote.metadata.borrowType, "variable");
  const validation = folksFinanceBorrowVariableShape.validate(
    quote.transactions,
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      loanAppId: LOAN_APP_ID,
      borrowAmount: 1_000_000n,
      receiverAddress: USER_ADDRESS,
      poolAppId: USDC_POOL_APP_ID,
      includeOpUp: true
    },
    { poolState: poolState(), loanAppId: LOAN_APP_ID }
  );
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("repay withTxn shape compiles executable quote", async () => {
  const group = buildRepayGroup();
  setFolksRepayWithTxnDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareRepayLoanWithTxn: () => group
  });

  const registry = createExecutionRegistry();
  const quote = await compileExecutableQuote(
    registry,
    folksFinanceRepayWithTxnShape.key,
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      poolAppId: USDC_POOL_APP_ID,
      repayAmount: "500000"
    },
    buildContext()
  );

  assert.equal(quote.transactions.length, 2);
  assert.equal(quote.metadata.isStable, false);
  const validation = folksFinanceRepayWithTxnShape.validate(
    quote.transactions,
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      loanAppId: LOAN_APP_ID,
      repayAmount: 500_000n,
      receiverAddress: USER_ADDRESS,
      isStable: false,
      poolAppId: USDC_POOL_APP_ID
    },
    { poolState: poolState(), loanAppId: LOAN_APP_ID }
  );
  assert.equal(validation.valid, true, validation.errors.join("; "));
});

test("reduce collateral shape validates OpUp + loan app call", () => {
  const group = buildBorrowGroup(true).map(serializeTransaction);
  // Reuse borrow-shaped group (OpUp + filler + loan app call with fee 8000 >= 6000).
  const result = folksFinanceCollateralReduceShape.validate(
    group,
    {
      userAddress: USER_ADDRESS,
      escrowAddress: ESCROW_ADDRESS,
      loanAppId: LOAN_APP_ID,
      amount: 100_000n,
      amountDenomination: "fAsset",
      receiverAddress: USER_ADDRESS,
      poolAppId: USDC_POOL_APP_ID,
      includeOpUp: true
    },
    { poolState: poolState(), loanAppId: LOAN_APP_ID }
  );
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("registry includes all Folks loan credit shapes", () => {
  const registry = createExecutionRegistry();
  assert.equal(registry.has("mainnet:folks-finance:v2:setup:loanEscrow"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:setup:addCollateral"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:collateral:sync"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:borrow:variable"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:repay:withTxn"), true);
  assert.equal(registry.has("mainnet:folks-finance:v2:collateral:reduce"), true);
});
