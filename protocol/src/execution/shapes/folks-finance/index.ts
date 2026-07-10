import type { TransactionShapeSpec } from "../../types.js";
import {
  folksFinanceDepositEscrowShape,
  setFolksDepositEscrowDependenciesForTests
} from "./deposit-escrow.js";
import {
  folksFinanceSetupDepositEscrowShape,
  setFolksSetupDepositEscrowDependenciesForTests
} from "./setup-deposit-escrow.js";
import {
  folksFinanceSetupOptEscrowAssetShape,
  setFolksSetupOptEscrowAssetDependenciesForTests
} from "./setup-opt-escrow-asset.js";
import {
  folksFinanceWithdrawEscrowShape,
  setFolksWithdrawEscrowDependenciesForTests
} from "./withdraw-escrow.js";

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

/** All verified Folks Finance transaction shapes. */
export const folksFinanceShapes: readonly TransactionShapeSpec[] = [
  folksFinanceSetupDepositEscrowShape,
  folksFinanceSetupOptEscrowAssetShape,
  folksFinanceDepositEscrowShape,
  folksFinanceWithdrawEscrowShape
];
