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
  folksFinanceStakeImmediateShape,
  setFolksStakeImmediateDependenciesForTests
} from "./stake-immediate.js";
import {
  folksFinanceUnstakeImmediateShape,
  setFolksUnstakeImmediateDependenciesForTests
} from "./unstake-immediate.js";
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

/** All verified Folks Finance transaction shapes. */
export const folksFinanceShapes: readonly TransactionShapeSpec[] = [
  folksFinanceSetupDepositEscrowShape,
  folksFinanceSetupOptEscrowAssetShape,
  folksFinanceDepositEscrowShape,
  folksFinanceWithdrawEscrowShape,
  folksFinanceStakeImmediateShape,
  folksFinanceUnstakeImmediateShape
];
