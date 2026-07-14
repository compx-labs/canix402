import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";
import type { SignerTransaction, V2PoolInfo } from "@tinymanorg/tinyman-js-sdk";

import { buildApp } from "../../src/app.js";
import {
  setTinymanFlexibleAddLiquidityDependenciesForTests,
  setTinymanInitialAddLiquidityDependenciesForTests,
  setTinymanRemoveLiquidityDependenciesForTests,
  setTinymanRemoveLiquiditySingleAssetOutDependenciesForTests,
  setTinymanSingleAssetAddLiquidityDependenciesForTests,
  tinymanAddLiquidityFlexibleShape,
  tinymanAddLiquidityInitialShape,
  tinymanAddLiquiditySingleAssetShape,
  tinymanRemoveLiquidityMultipleAssetsOutShape,
  tinymanRemoveLiquiditySingleAssetOutShape
} from "../../src/execution/shapes/tinyman/index.js";
import type { TinymanV2PoolState } from "../../src/execution/shapes/tinyman/pool-state.js";
import {
  folksFinanceDepositEscrowShape,
  folksFinanceWithdrawEscrowShape,
  setFolksDepositEscrowDependenciesForTests,
  setFolksWithdrawEscrowDependenciesForTests
} from "../../src/execution/shapes/folks-finance/index.js";
import type { FolksPoolState } from "../../src/execution/shapes/folks-finance/pool-state.js";
import {
  pactAddLiquidityTwoSidedShape,
  pactRemoveLiquidityProportionalShape,
  setPactAddLiquidityTwoSidedDependenciesForTests,
  setPactRemoveLiquidityProportionalDependenciesForTests,
  type PactPoolState
} from "../../src/execution/shapes/pact/index.js";
import type { LiquidityAddition, Pool } from "@pactfi/pactsdk";
import type { MarketData } from "@compx/sdk";

import { MainnetDepositsAppId, MainnetOpUp } from "@folks-finance/algorand-sdk";
import {
  buildMockDepositGroup,
  buildMockStakeGroup,
  compxDepositAsaShape,
  compxStakeAsaShape,
  createStakerBoxName,
  setCompXDepositAsaDependenciesForTests,
  setCompXStakeAsaDependenciesForTests,
  setCompXLendingMarketStateDependenciesForTests,
  setCompXStakingPoolStateDependenciesForTests,
  type CompXLendingMarketState,
  type CompXStakingPoolState
} from "../../src/execution/shapes/compx/index.js";
import {
  buildMockDorkFiDepositGroup,
  buildMockDorkFiWithdrawGroup,
  dorkfiDepositAsaShape,
  dorkfiWithdrawAsaShape,
  DORKFI_MAINNET_USDC_ASA_ID,
  DORKFI_MAINNET_USDC_MARKET_APP_ID,
  DORKFI_MAINNET_USDC_POOL_APP_ID,
  setDorkFiDepositAsaDependenciesForTests,
  setDorkFiLendingMarketStateDependenciesForTests,
  setDorkFiWithdrawAsaDependenciesForTests,
  type DorkFiLendingMarketState
} from "../../src/execution/shapes/dorkfi/index.js";

const FOLKS_USDC_POOL_APP_ID = 971372237;
const FOLKS_FUSDC_ASSET_ID = 971384592;
const FOLKS_DEPOSITS_APP_ID = MainnetDepositsAppId;
const FOLKS_DEPOSIT_INTEREST_INDEX = 1_050_000_000_000_000n;

const USER = algosdk.generateAccount();
const ESCROW = algosdk.generateAccount();
const POOL = algosdk.generateAccount();
const USER_ADDRESS = USER.addr.toString();
const ESCROW_ADDRESS = ESCROW.addr.toString();
const POOL_ADDRESS = POOL.addr.toString();
const VALIDATOR_APP_ID = 1002541853;
const USDC_ID = 31566704;
const ALGO_ID = 0;
const POOL_TOKEN_ID = 900001;
const PACT_POOL_APP_ID = 1072843805;
const PACT_LP_TOKEN_ID = 900002;
const COMPX_MARKET_APP_ID = 3491050310;
const COMPX_LST_ID = 3491050538;
const COMPX_STAKING_POOL_APP_ID = 3500000001;
const COMPX_STAKED_ID = 1058926737;
const COMPX_REWARD_ID = 793124631;
const GENESIS_HASH = new Uint8Array(32).fill(9);

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

function buildFlexibleGroup(): algosdk.Transaction[] {
  const asset1Txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 1_000_000n,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(1000)
  });
  const asset2Txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 2_000_000n,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("add_liquidity"),
      new TextEncoder().encode("flexible"),
      algosdk.encodeUint64(1_407_142n)
    ],
    foreignAssets: [POOL_TOKEN_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(3000)
  });
  const group = [asset1Txn, asset2Txn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildSingleAssetAddGroup(): algosdk.Transaction[] {
  const assetInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 1_000_000n,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("add_liquidity"),
      new TextEncoder().encode("single"),
      algosdk.encodeUint64(895_500n)
    ],
    foreignAssets: [POOL_TOKEN_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(3000)
  });
  const group = [assetInTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildInitialAddGroup(): algosdk.Transaction[] {
  const asset1Txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 1_000_000n,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(1000)
  });
  const asset2Txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 2_000_000n,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [new TextEncoder().encode("add_initial_liquidity")],
    foreignAssets: [POOL_TOKEN_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(2000)
  });
  const group = [asset1Txn, asset2Txn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildSingleAssetOutRemoveGroup(): algosdk.Transaction[] {
  const poolTokenTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 500_000n,
    assetIndex: POOL_TOKEN_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("remove_liquidity"),
      algosdk.encodeUint64(398_000n),
      algosdk.encodeUint64(0n)
    ],
    foreignAssets: [USDC_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(3000)
  });
  const group = [poolTokenTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildRemoveLiquidityGroup(): algosdk.Transaction[] {
  const poolTokenTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 500_000n,
    assetIndex: POOL_TOKEN_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(VALIDATOR_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("remove_liquidity"),
      algosdk.encodeUint64(248_750n),
      algosdk.encodeUint64(497_500n)
    ],
    foreignAssets: [USDC_ID, ALGO_ID],
    accounts: [POOL.addr],
    suggestedParams: suggestedParams(3000)
  });
  const group = [poolTokenTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function poolState(): TinymanV2PoolState {
  return {
    network: "mainnet",
    validatorAppId: VALIDATOR_APP_ID,
    poolAddress: POOL_ADDRESS,
    poolTokenId: POOL_TOKEN_ID,
    asset1Id: USDC_ID,
    asset2Id: ALGO_ID,
    asset1Decimals: 6,
    asset2Decimals: 6,
    poolInfo: {} as unknown as V2PoolInfo
  };
}

function installTinymanMocks(): void {
  setTinymanFlexibleAddLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getFlexibleQuote: () => ({
      asset1In: { id: USDC_ID, amount: 1_000_000n },
      asset2In: { id: ALGO_ID, amount: 2_000_000n },
      poolTokenOut: { id: POOL_TOKEN_ID, amount: 1_414_213n },
      share: 0.01,
      slippage: 0.005,
      internalSwapQuote: {
        assetIn: { id: USDC_ID, amount: 0n, decimals: 6 },
        assetOut: { id: ALGO_ID, amount: 0n, decimals: 6 },
        swapFees: 0n,
        priceImpact: 0
      },
      minPoolTokenAssetAmountWithSlippage: 1_407_142n
    }),
    generateFlexibleTxns: async (): Promise<SignerTransaction[]> =>
      buildFlexibleGroup().map((txn) => ({ txn }))
  });
}

function installRemoveLiquidityMocks(): void {
  setTinymanRemoveLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    resolvePoolReserves: async () => ({
      asset1: 10_000_000_000n,
      asset2: 20_000_000_000n,
      issuedLiquidity: 1_000_000_000n,
      round: 50_000_000n
    }),
    getRemoveLiquidityQuote: () => ({
      round: 50_000_000,
      asset1Out: { assetId: USDC_ID, amount: 250_000n },
      asset2Out: { assetId: ALGO_ID, amount: 500_000n },
      poolTokenIn: { assetId: POOL_TOKEN_ID, amount: 500_000n }
    }),
    generateRemoveLiquidityTxns: async (): Promise<SignerTransaction[]> =>
      buildRemoveLiquidityGroup().map((txn) => ({ txn }))
  });
}

function installSingleAssetAddMocks(): void {
  setTinymanSingleAssetAddLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getSingleAssetQuote: () => ({
      assetIn: { id: USDC_ID, amount: 1_000_000n },
      poolTokenOut: { id: POOL_TOKEN_ID, amount: 900_000n },
      share: 0.01,
      slippage: 0.005,
      internalSwapQuote: {
        assetIn: { id: USDC_ID, amount: 100_000n, decimals: 6 },
        assetOut: { id: ALGO_ID, amount: 50_000n, decimals: 6 },
        swapFees: 500n,
        priceImpact: 0.001
      },
      minPoolTokenAssetAmountWithSlippage: 895_500n
    }),
    generateSingleAssetTxns: async (): Promise<SignerTransaction[]> =>
      buildSingleAssetAddGroup().map((txn) => ({ txn }))
  });
}

function installInitialAddMocks(): void {
  setTinymanInitialAddLiquidityDependenciesForTests({
    resolvePoolState: async () => poolState(),
    getInitialQuote: () => ({
      asset1In: { id: USDC_ID, amount: 1_000_000n },
      asset2In: { id: ALGO_ID, amount: 2_000_000n },
      poolTokenOut: { id: POOL_TOKEN_ID, amount: 1_414_213n },
      slippage: 0.005
    }),
    generateInitialTxns: async (): Promise<SignerTransaction[]> =>
      buildInitialAddGroup().map((txn) => ({ txn }))
  });
}

function installSingleAssetOutRemoveMocks(): void {
  setTinymanRemoveLiquiditySingleAssetOutDependenciesForTests({
    resolvePoolState: async () => poolState(),
    resolvePoolReserves: async () => ({
      asset1: 10_000_000_000n,
      asset2: 20_000_000_000n,
      issuedLiquidity: 1_000_000_000n,
      round: 50_000_000n
    }),
    getSingleAssetRemoveLiquidityQuote: () => ({
      round: 50_000_000,
      assetOut: { assetId: USDC_ID, amount: 400_000n },
      poolTokenIn: { assetId: POOL_TOKEN_ID, amount: 500_000n },
      internalSwapQuote: {
        amountIn: { assetId: ALGO_ID, amount: 100_000n },
        amountOut: { assetId: USDC_ID, amount: 50_000n },
        swapFees: { assetId: ALGO_ID, amount: 500n },
        priceImpact: 0.001
      }
    }),
    generateSingleAssetOutTxns: async (): Promise<SignerTransaction[]> =>
      buildSingleAssetOutRemoveGroup().map((txn) => ({ txn }))
  });
}

function folksPoolState(): FolksPoolState {
  return {
    network: "mainnet",
    symbol: "USDC",
    pool: {
      appId: FOLKS_USDC_POOL_APP_ID,
      assetId: USDC_ID,
      fAssetId: FOLKS_FUSDC_ASSET_ID,
      frAssetId: 971384593,
      assetDecimals: 6,
      poolManagerIndex: 2,
      loans: {}
    },
    poolInfo: {
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
        depositInterestIndex: FOLKS_DEPOSIT_INTEREST_INDEX,
        latestUpdate: 1_700_000_000n
      },
      caps: { borrowCap: 0n, stableBorrowPercentageCap: 0n },
      config: {
        depreciated: false,
        rewardsPaused: false,
        stableBorrowSupported: true,
        flashLoanSupported: true
      }
    } as FolksPoolState["poolInfo"],
    poolManagerInfo: { currentRound: 1, adminAddress: USER_ADDRESS, pools: {} } as FolksPoolState["poolManagerInfo"],
    depositInterestIndex: FOLKS_DEPOSIT_INTEREST_INDEX,
    poolAppAddress: POOL_ADDRESS
  };
}

function buildFolksDepositGroup(): algosdk.Transaction[] {
  const opUp = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(MainnetOpUp.callerAppId),
    foreignApps: [BigInt(MainnetOpUp.baseAppId)],
    appArgs: [algosdk.encodeUint64(0)],
    suggestedParams: suggestedParams(1000)
  });
  const assetTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: POOL.addr,
    amount: 1_000_000n,
    assetIndex: USDC_ID,
    suggestedParams: suggestedParams(0)
  });
  const appTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(FOLKS_USDC_POOL_APP_ID),
    suggestedParams: suggestedParams(4000)
  });
  const group = [opUp, assetTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildFolksWithdrawEscrowGroup(): algosdk.Transaction[] {
  const appTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(FOLKS_DEPOSITS_APP_ID),
    suggestedParams: suggestedParams(6000)
  });
  return [appTxn];
}

function installFolksDepositMocks(): void {
  setFolksDepositEscrowDependenciesForTests({
    resolvePoolState: async () => folksPoolState(),
    resolveEscrowContext: async () => ({
      escrowAddress: ESCROW_ADDRESS,
      optedIntoFAsset: true,
      fAssetBalance: 2_000_000n
    }),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareDepositIntoPool: () => buildFolksDepositGroup().slice(1),
    prefixWithOpUp: () => buildFolksDepositGroup(),
    getAccountAssetBalance: async () => 5_000_000n
  });
}

function installFolksWithdrawMocks(): void {
  setFolksWithdrawEscrowDependenciesForTests({
    resolvePoolState: async () => folksPoolState(),
    resolveEscrowContext: async () => ({
      escrowAddress: ESCROW_ADDRESS,
      optedIntoFAsset: true,
      fAssetBalance: 2_000_000n
    }),
    getSuggestedParams: async () => suggestedParams(1000),
    prepareWithdrawFromDepositEscrowInDeposits: () => buildFolksWithdrawEscrowGroup()[0]!
  });
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
    getEscrowAddress: () => ESCROW_ADDRESS
  } as unknown as Pool;

  return {
    network: "mainnet",
    poolAppId: PACT_POOL_APP_ID,
    escrowAddress: ESCROW_ADDRESS,
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

function buildPactAddLiquidityGroup(): algosdk.Transaction[] {
  const primaryTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: ESCROW.addr,
    amount: 50_000n,
    suggestedParams: suggestedParams(1000)
  });
  const secondaryTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: ESCROW.addr,
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
  const group = [primaryTxn, secondaryTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function buildPactRemoveLiquidityGroup(): algosdk.Transaction[] {
  const lpTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: USER.addr,
    receiver: ESCROW.addr,
    amount: 25_000n,
    assetIndex: PACT_LP_TOKEN_ID,
    suggestedParams: suggestedParams(1000)
  });
  const appTxn = algosdk.makeApplicationCallTxnFromObject({
    sender: USER.addr,
    appIndex: BigInt(PACT_POOL_APP_ID),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [
      new TextEncoder().encode("REMLIQ"),
      algosdk.encodeUint64(0),
      algosdk.encodeUint64(0)
    ],
    foreignAssets: [ALGO_ID, USDC_ID],
    suggestedParams: suggestedParams(3000)
  });
  const group = [lpTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}

function installPactAddMocks(): void {
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

  setPactAddLiquidityTwoSidedDependenciesForTests({
    resolvePoolState: async () => pactPoolState(),
    prepareAddLiquidity: () => liquidityAddition,
    buildAddLiquidityTxs: () => buildPactAddLiquidityGroup(),
    getSuggestedParams: async () => suggestedParams(1000)
  });
}

function installPactRemoveMocks(): void {
  setPactRemoveLiquidityProportionalDependenciesForTests({
    resolvePoolState: async () => pactPoolState(),
    buildRemoveLiquidityTxs: () => buildPactRemoveLiquidityGroup(),
    getSuggestedParams: async () => suggestedParams(1000)
  });
}

function compxMarketState(): CompXLendingMarketState {
  return {
    network: "mainnet",
    marketAppId: COMPX_MARKET_APP_ID,
    marketAppAddress: POOL_ADDRESS,
    baseTokenId: USDC_ID,
    lstTokenId: COMPX_LST_ID,
    contractState: 1,
    market: { appId: COMPX_MARKET_APP_ID, baseTokenId: USDC_ID, lstTokenId: COMPX_LST_ID } as MarketData,
    userBaseBalance: 5_000_000n,
    userLstBalance: 1_000_000n,
    userOptedIntoBase: true,
    userOptedIntoLst: true
  };
}

function compxStakingState(): CompXStakingPoolState {
  return {
    network: "mainnet",
    poolAppId: COMPX_STAKING_POOL_APP_ID,
    poolAppAddress: POOL_ADDRESS,
    stakedAssetId: COMPX_STAKED_ID,
    rewardAssetId: COMPX_REWARD_ID,
    contractState: 1,
    initialized: true,
    rewardsFunded: true,
    endTime: 1_900_000_000,
    pool: {
      appId: COMPX_STAKING_POOL_APP_ID,
      stakedAssetId: COMPX_STAKED_ID,
      rewardAssetId: COMPX_REWARD_ID,
      totalStaked: 10_000_000n,
      rewardsRemaining: 1_000_000n,
      contractState: 1,
      initialized: true,
      rewardsFunded: true,
      endTime: 1_900_000_000,
      lastUpdateTime: 1_783_450_230
    },
    staker: { stake: 0n, rewardDebt: 0n, hasBox: false },
    userStakedBalance: 5_000_000n,
    userOptedIntoRewardAsset: true,
    stakerBoxName: createStakerBoxName(USER_ADDRESS)
  };
}

function installCompXDepositMocks(): void {
  setCompXLendingMarketStateDependenciesForTests({
    getMarket: async () => compxMarketState().market,
    getAccountAssetBalance: async () => 5_000_000n,
    isAssetOptedIn: async () => true,
    getApplicationAddress: () => POOL_ADDRESS
  });
  setCompXDepositAsaDependenciesForTests({
    resolveMarketState: async () => compxMarketState(),
    buildDepositTransactions: async () => ({
      transactions: buildMockDepositGroup({
        user: USER,
        marketAppId: COMPX_MARKET_APP_ID,
        marketAppAddress: POOL_ADDRESS,
        baseTokenId: USDC_ID,
        lstTokenId: COMPX_LST_ID,
        amount: 100_000n,
        includeLstOptIn: false,
        suggestedParams: suggestedParams(1000)
      }),
      signers: [{ address: USER_ADDRESS, transactionIndexes: [0, 1] }],
      metadata: { optInsIncluded: [] }
    })
  });
}

function installCompXStakeMocks(): void {
  setCompXStakingPoolStateDependenciesForTests({
    getPool: async () => compxStakingState().pool,
    getStakerInfo: async () => null,
    getAccountAssetBalance: async () => 5_000_000n,
    isAssetOptedIn: async () => true,
    getApplicationAddress: () => POOL_ADDRESS,
    nowSeconds: () => 1_800_000_000
  });
  setCompXStakeAsaDependenciesForTests({
    resolvePoolState: async () => compxStakingState(),
    getSuggestedParams: async () => suggestedParams(1000),
    finalizeComposerGroup: async () =>
      buildMockStakeGroup({
        user: USER,
        poolAppId: COMPX_STAKING_POOL_APP_ID,
        poolAppAddress: POOL_ADDRESS,
        stakedAssetId: COMPX_STAKED_ID,
        rewardAssetId: COMPX_REWARD_ID,
        amount: 100_000n,
        mbrAmount: 22_500n,
        stakerBoxName: createStakerBoxName(USER_ADDRESS),
        suggestedParams: suggestedParams(1000)
      })
  });
}

function dorkfiMarketState(): DorkFiLendingMarketState {
  return {
    network: "mainnet",
    poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
    marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
    assetId: DORKFI_MAINNET_USDC_ASA_ID,
    nTokenAppId: 3_333_764_003,
    poolAppAddress: POOL_ADDRESS,
    decimals: 6,
    tokenStandard: "asa",
    symbol: "USDC",
    paused: false,
    userAssetBalance: 5_000_000n,
    userNTokenBalance: 1_000_000n,
    userOptedIntoAsset: true,
    catalogMarket: {
      symbol: "USDC",
      poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
      marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
      nTokenAppId: 3_333_764_003,
      assetId: DORKFI_MAINNET_USDC_ASA_ID,
      decimals: 6,
      tokenStandard: "asa"
    }
  };
}

function installDorkFiDepositMocks(): void {
  setDorkFiDepositAsaDependenciesForTests({
    resolveMarketState: async () => dorkfiMarketState(),
    buildDepositTransactions: async () =>
      buildMockDorkFiDepositGroup({
        user: USER,
        poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
        marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
        assetId: DORKFI_MAINNET_USDC_ASA_ID,
        amount: 100_000n,
        suggestedParams: suggestedParams(20_000)
      })
  });
}

function installDorkFiWithdrawMocks(): void {
  setDorkFiWithdrawAsaDependenciesForTests({
    resolveMarketState: async () => dorkfiMarketState(),
    buildWithdrawTransactions: async () =>
      buildMockDorkFiWithdrawGroup({
        user: USER,
        poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
        marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
        assetId: DORKFI_MAINNET_USDC_ASA_ID,
        nTokenAmount: 100_000n,
        suggestedParams: suggestedParams(20_000)
      }),
    simulateWithdrawUnderlyingAmount: async () => 99_500n
  });
}

const quoteRequestBody = {
  shapeKey: tinymanAddLiquidityFlexibleShape.key,
  input: {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetAAmount: "1000000",
    assetBId: ALGO_ID,
    assetBAmount: "2000000",
    maxSlippageBps: 50
  }
};

const removeQuoteRequestBody = {
  shapeKey: tinymanRemoveLiquidityMultipleAssetsOutShape.key,
  input: {
    userAddress: USER_ADDRESS,
    assetAId: USDC_ID,
    assetBId: ALGO_ID,
    poolTokenAmount: "500000",
    maxSlippageBps: 50
  }
};

test.afterEach(() => {
  setTinymanFlexibleAddLiquidityDependenciesForTests(undefined);
  setTinymanRemoveLiquidityDependenciesForTests(undefined);
  setTinymanSingleAssetAddLiquidityDependenciesForTests(undefined);
  setTinymanInitialAddLiquidityDependenciesForTests(undefined);
  setTinymanRemoveLiquiditySingleAssetOutDependenciesForTests(undefined);
  setFolksDepositEscrowDependenciesForTests(undefined);
  setFolksWithdrawEscrowDependenciesForTests(undefined);
  setPactAddLiquidityTwoSidedDependenciesForTests(undefined);
  setPactRemoveLiquidityProportionalDependenciesForTests(undefined);
  setCompXDepositAsaDependenciesForTests(undefined);
  setCompXStakeAsaDependenciesForTests(undefined);
  setCompXLendingMarketStateDependenciesForTests(undefined);
  setCompXStakingPoolStateDependenciesForTests(undefined);
  setDorkFiDepositAsaDependenciesForTests(undefined);
  setDorkFiWithdrawAsaDependenciesForTests(undefined);
  setDorkFiLendingMarketStateDependenciesForTests(undefined);
});

test("POST /execution/quotes returns unsigned executable quote", async () => {
  installTinymanMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: quoteRequestBody
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      shapeKey: string;
      encodedTransactions: string[];
      transactions: Array<{ type: string }>;
      expiresAt: string;
    };
    meta: { paymentRequired: boolean; executionSubmitted: boolean };
  };

  assert.equal(body.data.shapeKey, tinymanAddLiquidityFlexibleShape.key);
  assert.equal(body.data.encodedTransactions.length, 3);
  assert.equal(body.data.transactions.length, 3);
  assert.deepEqual(
    body.data.transactions.map((txn) => txn.type),
    ["axfer", "pay", "appl"]
  );
  assert.equal(body.meta.paymentRequired, true);
  assert.equal(body.meta.executionSubmitted, false);
  assert.ok(new Date(body.data.expiresAt).getTime() > Date.now() - 60_000);

  await app.close();
});

test("POST /execution/quotes returns remove-liquidity executable quote", async () => {
  installRemoveLiquidityMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: removeQuoteRequestBody
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      shapeKey: string;
      encodedTransactions: string[];
      transactions: Array<{ type: string }>;
    };
  };

  assert.equal(body.data.shapeKey, tinymanRemoveLiquidityMultipleAssetsOutShape.key);
  assert.equal(body.data.encodedTransactions.length, 2);
  assert.equal(body.data.transactions.length, 2);
  assert.deepEqual(
    body.data.transactions.map((txn) => txn.type),
    ["axfer", "appl"]
  );

  await app.close();
});

test("POST /execution/quotes returns 400 when remove-liquidity poolTokenAmount is missing", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: tinymanRemoveLiquidityMultipleAssetsOutShape.key,
      input: {
        userAddress: USER_ADDRESS,
        assetAId: USDC_ID,
        assetBId: ALGO_ID,
        maxSlippageBps: 50
      }
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");

  await app.close();
});

test("POST /execution/quotes returns initial add-liquidity executable quote", async () => {
  installInitialAddMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: tinymanAddLiquidityInitialShape.key,
      input: quoteRequestBody.input
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, tinymanAddLiquidityInitialShape.key);
  assert.equal(body.data.transactions.length, 3);

  await app.close();
});

test("POST /execution/quotes returns single-asset add-liquidity executable quote", async () => {
  installSingleAssetAddMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: tinymanAddLiquiditySingleAssetShape.key,
      input: {
        userAddress: USER_ADDRESS,
        assetAId: USDC_ID,
        assetBId: ALGO_ID,
        depositAssetId: USDC_ID,
        depositAmount: "1000000",
        maxSlippageBps: 50
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, tinymanAddLiquiditySingleAssetShape.key);
  assert.equal(body.data.transactions.length, 2);

  await app.close();
});

test("POST /execution/quotes returns single-asset-out remove-liquidity executable quote", async () => {
  installSingleAssetOutRemoveMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: tinymanRemoveLiquiditySingleAssetOutShape.key,
      input: {
        userAddress: USER_ADDRESS,
        assetAId: USDC_ID,
        assetBId: ALGO_ID,
        outputAssetId: USDC_ID,
        poolTokenAmount: "500000",
        maxSlippageBps: 50
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, tinymanRemoveLiquiditySingleAssetOutShape.key);
  assert.equal(body.data.transactions.length, 2);

  await app.close();
});

test("POST /execution/quotes returns Folks escrow deposit executable quote", async () => {
  installFolksDepositMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: folksFinanceDepositEscrowShape.key,
      input: {
        userAddress: USER_ADDRESS,
        poolAppId: FOLKS_USDC_POOL_APP_ID,
        escrowAddress: ESCROW_ADDRESS,
        assetAmount: "1000000"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
    meta: { executionSubmitted: boolean };
  };
  assert.equal(body.data.shapeKey, folksFinanceDepositEscrowShape.key);
  assert.equal(body.data.transactions.length, 3);
  assert.equal(body.meta.executionSubmitted, false);

  await app.close();
});

test("POST /execution/quotes returns Folks escrow withdraw executable quote", async () => {
  installFolksWithdrawMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: folksFinanceWithdrawEscrowShape.key,
      input: {
        userAddress: USER_ADDRESS,
        poolAppId: FOLKS_USDC_POOL_APP_ID,
        escrowAddress: ESCROW_ADDRESS,
        amount: "500000",
        amountDenomination: "fAsset"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, folksFinanceWithdrawEscrowShape.key);
  assert.equal(body.data.transactions.length, 1);

  await app.close();
});

test("POST /execution/quotes returns Pact two-sided add-liquidity executable quote", async () => {
  installPactAddMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: pactAddLiquidityTwoSidedShape.key,
      input: {
        userAddress: USER_ADDRESS,
        poolAppId: PACT_POOL_APP_ID,
        assetAId: USDC_ID,
        assetAAmount: "100000",
        assetBId: ALGO_ID,
        assetBAmount: "50000",
        maxSlippageBps: 50
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, pactAddLiquidityTwoSidedShape.key);
  assert.equal(body.data.transactions.length, 3);

  await app.close();
});

test("POST /execution/quotes returns Pact proportional remove-liquidity executable quote", async () => {
  installPactRemoveMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: pactRemoveLiquidityProportionalShape.key,
      input: {
        userAddress: USER_ADDRESS,
        poolAppId: PACT_POOL_APP_ID,
        poolTokenAmount: "25000"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, pactRemoveLiquidityProportionalShape.key);
  assert.equal(body.data.transactions.length, 2);

  await app.close();
});

test("POST /execution/quotes compiles CompX lending deposit shape", async () => {
  installCompXDepositMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: compxDepositAsaShape.key,
      input: {
        userAddress: USER_ADDRESS,
        marketAppId: COMPX_MARKET_APP_ID,
        amount: "100000"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, compxDepositAsaShape.key);
  assert.equal(body.data.transactions.length, 2);

  await app.close();
});

test("POST /execution/quotes includes underlying shape build error cause", async () => {
  setCompXDepositAsaDependenciesForTests({
    resolveMarketState: async () => compxMarketState(),
    buildDepositTransactions: async () => {
      const sdkError = new Error("CompX SDK raw failure") as Error & {
        code: string;
        context: { amount: bigint };
      };
      sdkError.code = "COMPX_SDK_FAILURE";
      sdkError.context = { amount: 100_000n };
      throw sdkError;
    }
  });

  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: compxDepositAsaShape.key,
      input: {
        userAddress: USER_ADDRESS,
        marketAppId: COMPX_MARKET_APP_ID,
        amount: "100000"
      }
    }
  });

  assert.equal(response.statusCode, 500);
  const body = response.json() as {
    error: {
      code: string;
      message: string;
      details?: {
        cause?: {
          name?: string;
          message?: string;
          code?: string;
          properties?: { context?: { amount?: string } };
        };
      };
    };
  };
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message, "Failed to generate CompX lending deposit transactions.");
  assert.equal(body.error.details?.cause?.name, "Error");
  assert.equal(body.error.details?.cause?.message, "CompX SDK raw failure");
  assert.equal(body.error.details?.cause?.code, "COMPX_SDK_FAILURE");
  assert.equal(body.error.details?.cause?.properties?.context?.amount, "100000");

  await app.close();
});

test("POST /execution/quotes compiles CompX staking stake shape", async () => {
  installCompXStakeMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: compxStakeAsaShape.key,
      input: {
        userAddress: USER_ADDRESS,
        poolAppId: COMPX_STAKING_POOL_APP_ID,
        amount: "100000"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, compxStakeAsaShape.key);
  assert.equal(body.data.transactions.length, 3);

  await app.close();
});

test("POST /execution/quotes compiles Dork.fi lending deposit shape", async () => {
  installDorkFiDepositMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: dorkfiDepositAsaShape.key,
      input: {
        userAddress: USER_ADDRESS,
        poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
        marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
        assetId: DORKFI_MAINNET_USDC_ASA_ID,
        amount: "100000"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, dorkfiDepositAsaShape.key);
  assert.equal(body.data.transactions.length, 2);

  await app.close();
});

test("POST /execution/quotes compiles Dork.fi lending withdraw shape", async () => {
  installDorkFiWithdrawMocks();
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: dorkfiWithdrawAsaShape.key,
      input: {
        userAddress: USER_ADDRESS,
        poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
        marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
        assetId: DORKFI_MAINNET_USDC_ASA_ID,
        amount: "100000"
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { shapeKey: string; transactions: Array<{ type: string }> };
  };
  assert.equal(body.data.shapeKey, dorkfiWithdrawAsaShape.key);
  assert.equal(body.data.transactions.length, 2);

  await app.close();
});

test("POST /execution/quotes returns 404 for unknown shape key", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: "mainnet:tinyman:v2:swap:fixedInput",
      input: quoteRequestBody.input
    }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, "NOT_FOUND");

  await app.close();
});

test("POST /execution/quotes returns 400 for invalid input", async () => {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "POST",
    url: "/execution/quotes",
    payload: {
      shapeKey: tinymanAddLiquidityFlexibleShape.key,
      input: {
        ...quoteRequestBody.input,
        maxSlippageBps: 20_000
      }
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");

  await app.close();
});
