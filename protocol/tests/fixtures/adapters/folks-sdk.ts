import type { normalizeFolksLendingOpportunity } from "../../../src/adapters/folksFinance.js";

type FolksLendingInput = Parameters<typeof normalizeFolksLendingOpportunity>[0];

/** Recorded Folks SDK-shaped inputs (no live algod). */
export const FOLKS_FETCHED_AT = "2026-06-17T21:05:00.000Z";
export const FOLKS_XALGO_ASSET_ID = 1_134_696_561;
export const FOLKS_ALGO_POOL_APP_ID = 42;

function emptyVariableBorrow(): FolksLendingInput["poolInfo"]["variableBorrow"] {
  return {
    vr0: 0n,
    vr1: 0n,
    vr2: 0n,
    totalVariableBorrowAmount: 0n,
    variableBorrowInterestRate: 0n,
    variableBorrowInterestYield: 0n,
    variableBorrowInterestIndex: 0n
  };
}

function emptyStableBorrow(): FolksLendingInput["poolInfo"]["stableBorrow"] {
  return {
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
  };
}

export function folksAlgoPool(): FolksLendingInput["pool"] {
  return {
    appId: FOLKS_ALGO_POOL_APP_ID,
    assetId: 0,
    fAssetId: 1,
    frAssetId: 2,
    assetDecimals: 6,
    poolManagerIndex: 0,
    loans: {}
  };
}

export function folksPoolInfo(
  totalDeposits: bigint,
  latestUpdate: bigint = 0n
): FolksLendingInput["poolInfo"] {
  return {
    poolManagerAppId: 1,
    poolAdminAddress: "A",
    paramsAdminAddress: "B",
    configAdminAddress: "C",
    loansAdminAddress: "D",
    variableBorrow: emptyVariableBorrow(),
    stableBorrow: emptyStableBorrow(),
    interest: {
      retentionRate: 0n,
      flashLoanFee: 0n,
      optimalUtilisationRatio: 0n,
      totalDeposits,
      depositInterestRate: 0n,
      depositInterestYield: 0n,
      depositInterestIndex: 0n,
      latestUpdate
    },
    caps: {
      borrowCap: 0n,
      stableBorrowPercentageCap: 0n
    },
    config: {
      depreciated: false,
      rewardsPaused: false,
      stableBorrowSupported: false,
      flashLoanSupported: false
    }
  };
}

export function folksPoolManagerInfo(
  appId: number,
  values: {
    depositInterestRate: bigint;
    depositInterestYield: bigint;
    variableBorrowInterestYield?: bigint;
  }
): FolksLendingInput["poolManagerInfo"] {
  return {
    adminAddress: "ADMIN",
    pools: {
      [appId]: {
        variableBorrowInterestRate: 0n,
        variableBorrowInterestYield: values.variableBorrowInterestYield ?? 0n,
        variableBorrowInterestIndex: 0n,
        depositInterestRate: values.depositInterestRate,
        depositInterestYield: values.depositInterestYield,
        metadata: {
          oldVariableBorrowInterestIndex: 0n,
          oldDepositInterestIndex: 0n,
          oldTimestamp: 0n
        }
      }
    }
  };
}

/**
 * Recorded lending snapshot: 5.5% deposit yield, 4.5% deposit rate,
 * 1.25e9 ALGO base units at $0.22 → $275 TVL.
 */
export function folksAlgoLendingFixture(): FolksLendingInput {
  return {
    symbol: "ALGO",
    pool: folksAlgoPool(),
    poolInfo: folksPoolInfo(1_250_000_000n),
    poolManagerInfo: folksPoolManagerInfo(FOLKS_ALGO_POOL_APP_ID, {
      depositInterestRate: 450_000_000_000_000n,
      depositInterestYield: 550_000_000_000_000n,
      variableBorrowInterestYield: 900_000_000_000_000n
    }),
    oraclePrice: 22_000_000n,
    assetDecimals: 6,
    fetchedAtIso: FOLKS_FETCHED_AT
  };
}

export function folksXAlgoStakingFixture() {
  return {
    consensusState: {
      algoBalance: 1_250_000_000n,
      fee: 500_000_000_000_000n
    },
    consensusApr: 10,
    oraclePrice: 22_000_000n,
    xAlgoId: FOLKS_XALGO_ASSET_ID,
    sampleSize: 16,
    fetchedAtIso: "2026-07-17T12:00:00.000Z"
  };
}
