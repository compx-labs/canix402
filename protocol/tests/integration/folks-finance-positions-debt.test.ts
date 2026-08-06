import assert from "node:assert/strict";
import test from "node:test";
import type { UserLoanInfo } from "@folks-finance/algorand-sdk";
import { MainnetLoans, MainnetPools } from "@folks-finance/algorand-sdk";

import { attachExecutionShapesToPosition } from "../../src/services/position-execution-shapes.js";
import {
  collectFolksFinancePositions,
  setFolksFinancePositionCollectorDependenciesForTests
} from "../../src/services/protocol-positions.js";
import { emptyWalletSnapshot } from "../../src/services/wallet-snapshot.js";

const ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const ESCROW =
  "ESCROW7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const GENERAL_LOAN_APP_ID = MainnetLoans.GENERAL;
const USDC_POOL = MainnetPools.USDC;

test.afterEach(() => {
  setFolksFinancePositionCollectorDependenciesForTests(undefined);
});

function mockUserLoan(): UserLoanInfo {
  return {
    userAddress: ADDRESS,
    escrowAddress: ESCROW,
    collaterals: [],
    borrows: [
      {
        poolAppId: USDC_POOL.appId,
        assetId: Number(USDC_POOL.assetId),
        assetPrice: 1_000_000_000_000_00n,
        isStable: false,
        borrowFactor: 10_000n,
        borrowedAmount: 1_500_000n,
        borrowedAmountValue: 1_500_000_000_000_00n,
        borrowBalance: 1_500_000n,
        borrowBalanceValue: 1_500_000_000_000_00n,
        effectiveBorrowBalanceValue: 1_500_000_000_000_00n,
        accruedInterest: 0n,
        accruedInterestValue: 0n,
        interestRate: 0n,
        interestYield: 0n
      }
    ],
    netRate: 0n,
    netYield: 0n,
    totalCollateralBalanceValue: 0n,
    totalBorrowedAmountValue: 1_500_000_000_000_00n,
    totalBorrowBalanceValue: 1_500_000_000_000_00n,
    totalEffectiveCollateralBalanceValue: 3_000_000_000_000_00n,
    totalEffectiveBorrowBalanceValue: 1_500_000_000_000_00n,
    loanToValueRatio: 5_000n,
    borrowUtilisationRatio: 5_000n,
    liquidationMargin: 5_000n
  };
}

test("Folks collector emits debt promptly from algod loan info with escrow hints", async () => {
  let algodLoanReads = 0;
  setFolksFinancePositionCollectorDependenciesForTests({
    createIndexerClient: () => ({}) as never,
    createAlgodClient: () => ({}) as never,
    retrieveUserDepositsFullInfo: async () => [],
    retrieveLoansLocalState: async (_indexer, loanAppId) => {
      if (loanAppId !== GENERAL_LOAN_APP_ID) {
        return [];
      }
      return [
        {
          escrowAddress: ESCROW,
          userAddress: ADDRESS,
          loanAppId: GENERAL_LOAN_APP_ID
        } as never
      ];
    },
    retrieveUserLoanInfo: async (_algod, loanAppId, _pm, _oracle, escrow) => {
      algodLoanReads += 1;
      assert.equal(loanAppId, GENERAL_LOAN_APP_ID);
      assert.equal(escrow, ESCROW);
      return mockUserLoan();
    }
  });

  const result = await collectFolksFinancePositions(
    ADDRESS,
    emptyWalletSnapshot(ADDRESS)
  );

  assert.ok(algodLoanReads >= 1);
  const debt = result.positions.find(
    (position) => position.positionType === "debt"
  );
  assert.ok(debt);
  assert.equal(
    debt.positionId,
    `folks-finance:debt:${ESCROW}:${USDC_POOL.appId}`
  );
  assert.equal(debt.amountRaw, "1500000");
  assert.equal(debt.assetId, Number(USDC_POOL.assetId));
  assert.deepEqual(debt.inputHints, {
    escrowAddress: ESCROW,
    loanAppId: GENERAL_LOAN_APP_ID,
    poolAppId: USDC_POOL.appId,
    assetId: Number(USDC_POOL.assetId)
  });
  assert.ok(
    (debt.caveats ?? []).some((caveat) => caveat.includes("Variable-rate"))
  );

  const enriched = attachExecutionShapesToPosition(debt);
  assert.ok(
    enriched.compatibleExitShapeKeys.includes(
      "mainnet:folks-finance:v2:repay:withTxn"
    )
  );
  assert.equal(result.coverage?.borrowedUsdComplete, true);
});

test("Folks collector keeps unpriced debt with null USD caveat", async () => {
  setFolksFinancePositionCollectorDependenciesForTests({
    createIndexerClient: () => ({}) as never,
    createAlgodClient: () => ({}) as never,
    retrieveUserDepositsFullInfo: async () => [],
    retrieveLoansLocalState: async (_indexer, loanAppId) => {
      if (loanAppId !== GENERAL_LOAN_APP_ID) {
        return [];
      }
      return [{ escrowAddress: ESCROW } as never];
    },
    retrieveUserLoanInfo: async () => {
      const loan = mockUserLoan();
      loan.borrows[0]!.borrowBalanceValue = -1n;
      return loan;
    }
  });

  const result = await collectFolksFinancePositions(
    ADDRESS,
    emptyWalletSnapshot(ADDRESS)
  );
  const debt = result.positions.find(
    (position) => position.positionType === "debt"
  );
  assert.ok(debt);
  assert.equal(debt.usdValue, null);
  assert.ok(
    (debt.caveats ?? []).some((caveat) =>
      caveat.includes("Debt USD unavailable")
    )
  );
  assert.equal(result.coverage?.borrowedUsdComplete, false);
});
