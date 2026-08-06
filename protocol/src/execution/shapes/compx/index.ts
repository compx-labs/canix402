import type { TransactionShapeSpec } from "../../types.js";
import { compxBorrowAsaShape } from "./borrow-asa.js";
import { compxClaimRewardsShape } from "./claim-rewards.js";
import { compxDepositAsaShape } from "./deposit-asa.js";
import { compxRepayAsaShape } from "./repay-asa.js";
import { compxStakeAsaShape } from "./stake-asa.js";
import { compxUnstakeAsaShape } from "./unstake-asa.js";
import { compxWithdrawAsaShape } from "./withdraw-asa.js";

export {
  compxDepositAsaShape,
  setCompXDepositAsaDependenciesForTests,
  buildMockDepositGroup,
  validateCompXDepositSigners
} from "./deposit-asa.js";
export type { CompXDepositAsaInput, CompXDepositAsaDependencies } from "./deposit-asa.js";

export {
  compxWithdrawAsaShape,
  setCompXWithdrawAsaDependenciesForTests,
  buildMockWithdrawGroup
} from "./withdraw-asa.js";
export type { CompXWithdrawAsaInput, CompXWithdrawAsaDependencies } from "./withdraw-asa.js";

export {
  compxBorrowAsaShape,
  setCompXBorrowAsaDependenciesForTests,
  buildMockBorrowGroup
} from "./borrow-asa.js";
export type { CompXBorrowAsaInput, CompXBorrowAsaDependencies } from "./borrow-asa.js";

export {
  createAcceptedCollateralBoxName,
  isCompXAcceptedCollateral,
  assertCompXAcceptedCollateral,
  setCompXAcceptedCollateralDependenciesForTests
} from "./accepted-collateral.js";
export type { CompXAcceptedCollateralDependencies } from "./accepted-collateral.js";

export {
  compxRepayAsaShape,
  setCompXRepayAsaDependenciesForTests,
  buildMockRepayGroup
} from "./repay-asa.js";
export type { CompXRepayAsaInput, CompXRepayAsaDependencies } from "./repay-asa.js";

export {
  compxStakeAsaShape,
  setCompXStakeAsaDependenciesForTests,
  buildMockStakeGroup
} from "./stake-asa.js";
export type { CompXStakeAsaInput, CompXStakeAsaDependencies } from "./stake-asa.js";

export {
  compxUnstakeAsaShape,
  setCompXUnstakeAsaDependenciesForTests,
  buildMockUnstakeGroup
} from "./unstake-asa.js";
export type { CompXUnstakeAsaInput, CompXUnstakeAsaDependencies } from "./unstake-asa.js";

export {
  compxClaimRewardsShape,
  setCompXClaimRewardsDependenciesForTests,
  buildMockClaimGroup
} from "./claim-rewards.js";
export type { CompXClaimRewardsInput, CompXClaimRewardsDependencies } from "./claim-rewards.js";

export {
  resolveCompXLendingMarketState,
  setCompXLendingMarketStateDependenciesForTests
} from "./market-state.js";
export type { CompXLendingMarketState, CompXLendingMarketStateDependencies } from "./market-state.js";

export {
  resolveCompXStakingPoolState,
  setCompXStakingPoolStateDependenciesForTests
} from "./pool-state.js";
export type {
  CompXStakingPoolState,
  CompXStakerInfo,
  CompXStakingPoolStateDependencies
} from "./pool-state.js";

export {
  STAKE_METHOD_SELECTOR_HEX,
  UNSTAKE_METHOD_SELECTOR_HEX,
  CLAIM_REWARDS_METHOD_SELECTOR_HEX,
  STAKER_BOX_MBR_MICROALGOS,
  createStakerBoxName
} from "./staking-spec.js";

export { setCompXStakingBuildDependenciesForTests } from "./staking-build.js";

/** All verified CompX transaction shapes. */
export const compxShapes: readonly TransactionShapeSpec[] = [
  compxDepositAsaShape,
  compxWithdrawAsaShape,
  compxBorrowAsaShape,
  compxRepayAsaShape,
  compxStakeAsaShape,
  compxUnstakeAsaShape,
  compxClaimRewardsShape
];
