import type { TransactionShapeSpec } from "../../types.js";
import { folksFinanceBorrowVariableShape } from "./borrow-variable.js";
import { folksFinanceCollateralReduceShape } from "./collateral-reduce.js";
import { folksFinanceCollateralSyncShape } from "./collateral-sync.js";
import { folksFinanceDepositEscrowShape } from "./deposit-escrow.js";
import { folksFinanceRepayWithTxnShape } from "./repay-with-txn.js";
import { folksFinanceSetupAddCollateralShape } from "./setup-add-collateral.js";
import { folksFinanceSetupDepositEscrowShape } from "./setup-deposit-escrow.js";
import { folksFinanceSetupLoanEscrowShape } from "./setup-loan-escrow.js";
import { folksFinanceSetupOptEscrowAssetShape } from "./setup-opt-escrow-asset.js";
import { folksFinanceStakeImmediateShape } from "./stake-immediate.js";
import { folksFinanceUnstakeImmediateShape } from "./unstake-immediate.js";
import { folksFinanceWithdrawEscrowShape } from "./withdraw-escrow.js";

export {
  folksFinanceDepositEscrowShape,
  setFolksDepositEscrowDependenciesForTests
} from "./deposit-escrow.js";
export type {
  FolksDepositEscrowInput,
  FolksDepositEscrowState,
  FolksDepositEscrowDependencies
} from "./deposit-escrow.js";
export {
  folksFinanceWithdrawEscrowShape,
  setFolksWithdrawEscrowDependenciesForTests,
  computeEscrowWithdrawParams
} from "./withdraw-escrow.js";
export type {
  FolksWithdrawEscrowInput,
  FolksWithdrawEscrowState,
  FolksWithdrawEscrowDependencies,
  FolksEscrowWithdrawParams
} from "./withdraw-escrow.js";
export {
  folksFinanceSetupDepositEscrowShape,
  setFolksSetupDepositEscrowDependenciesForTests
} from "./setup-deposit-escrow.js";
export type {
  FolksSetupDepositEscrowInput,
  FolksSetupDepositEscrowState,
  FolksSetupDepositEscrowDependencies
} from "./setup-deposit-escrow.js";
export {
  folksFinanceSetupOptEscrowAssetShape,
  setFolksSetupOptEscrowAssetDependenciesForTests
} from "./setup-opt-escrow-asset.js";
export type { FolksSetupOptEscrowAssetInput } from "./setup-opt-escrow-asset.js";
export {
  folksFinanceSetupLoanEscrowShape,
  setFolksSetupLoanEscrowDependenciesForTests
} from "./setup-loan-escrow.js";
export type {
  FolksSetupLoanEscrowInput,
  FolksSetupLoanEscrowState,
  FolksSetupLoanEscrowDependencies
} from "./setup-loan-escrow.js";
export {
  folksFinanceSetupAddCollateralShape,
  setFolksSetupAddCollateralDependenciesForTests
} from "./setup-add-collateral.js";
export type {
  FolksSetupAddCollateralInput,
  FolksSetupAddCollateralState,
  FolksSetupAddCollateralDependencies
} from "./setup-add-collateral.js";
export {
  folksFinanceCollateralSyncShape,
  setFolksCollateralSyncDependenciesForTests
} from "./collateral-sync.js";
export type {
  FolksCollateralSyncInput,
  FolksCollateralSyncState,
  FolksCollateralSyncDependencies
} from "./collateral-sync.js";
export {
  folksFinanceCollateralReduceShape,
  setFolksCollateralReduceDependenciesForTests
} from "./collateral-reduce.js";
export type {
  FolksCollateralReduceInput,
  FolksCollateralReduceState,
  FolksCollateralReduceDependencies
} from "./collateral-reduce.js";
export {
  folksFinanceBorrowVariableShape,
  setFolksBorrowVariableDependenciesForTests
} from "./borrow-variable.js";
export type {
  FolksBorrowVariableInput,
  FolksBorrowVariableState,
  FolksBorrowVariableDependencies
} from "./borrow-variable.js";
export {
  folksFinanceRepayWithTxnShape,
  setFolksRepayWithTxnDependenciesForTests
} from "./repay-with-txn.js";
export type {
  FolksRepayWithTxnInput,
  FolksRepayWithTxnState,
  FolksRepayWithTxnDependencies
} from "./repay-with-txn.js";
export {
  folksFinanceStakeImmediateShape,
  setFolksStakeImmediateDependenciesForTests
} from "./stake-immediate.js";
export type {
  FolksStakeImmediateInput,
  FolksStakeImmediateDependencies
} from "./stake-immediate.js";
export {
  folksFinanceUnstakeImmediateShape,
  setFolksUnstakeImmediateDependenciesForTests
} from "./unstake-immediate.js";
export type {
  FolksUnstakeImmediateInput,
  FolksUnstakeImmediateDependencies
} from "./unstake-immediate.js";
export {
  resolveFolksPoolState,
  resolveFolksEscrowContext,
  getSuggestedParams,
  getAccountAssetBalance,
  isAccountOptedIntoAsset,
  createExecutionIndexerClient,
  getDepositsAppAddress,
  setFolksPoolStateDependenciesForTests,
  MainnetDepositsAppId,
  MainnetOpUp,
  MainnetPoolManagerAppId
} from "./pool-state.js";
export type {
  FolksPoolState,
  FolksEscrowContext,
  FolksPoolStateDependencies
} from "./pool-state.js";
export {
  resolveFolksXAlgoState,
  setFolksXAlgoStateDependenciesForTests,
  MainnetConsensusConfig
} from "./xalgo-state.js";
export type {
  FolksXAlgoState,
  FolksXAlgoStateDependencies
} from "./xalgo-state.js";
export {
  FOLKS_GENERAL_LOAN_APP_ID,
  parseLoanAppId,
  parseEscrowAddress
} from "./parse-input.js";

/** All verified Folks Finance transaction shapes. */
export const folksFinanceShapes: readonly TransactionShapeSpec[] = [
  folksFinanceSetupDepositEscrowShape,
  folksFinanceSetupOptEscrowAssetShape,
  folksFinanceDepositEscrowShape,
  folksFinanceWithdrawEscrowShape,
  folksFinanceSetupLoanEscrowShape,
  folksFinanceSetupAddCollateralShape,
  folksFinanceCollateralSyncShape,
  folksFinanceBorrowVariableShape,
  folksFinanceRepayWithTxnShape,
  folksFinanceCollateralReduceShape,
  folksFinanceStakeImmediateShape,
  folksFinanceUnstakeImmediateShape
];
