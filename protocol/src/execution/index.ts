import { TransactionShapeRegistry } from "./registry.js";
import { alphaArcadeShapes } from "./shapes/alpha-arcade/index.js";
import { compxShapes } from "./shapes/compx/index.js";
import { dorkfiShapes } from "./shapes/dorkfi/index.js";
import { folksFinanceShapes } from "./shapes/folks-finance/index.js";
import { haystackShapes } from "./shapes/haystack/index.js";
import { mythFinanceShapes } from "./shapes/myth-finance/index.js";
import { pactShapes } from "./shapes/pact/index.js";
import { retiShapes } from "./shapes/reti/index.js";
import { tinymanShapes } from "./shapes/tinyman/index.js";

export * from "./types.js";
export * from "./errors.js";
export {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "./registry.js";
export {
  listExecutionShapeCatalog,
  toExecutionShapeCatalogEntry
} from "./catalog.js";
export type { ExecutionShapeCatalogEntry } from "./catalog.js";
export {
  EXECUTION_SHAPE_DOCS_PATHS,
  EXECUTION_PROTOCOL_CAVEATS_DOCS_PATH,
  EXECUTION_PROTOCOL_CAVEATS_AGENT_HINT,
  getExecutionShapeDocsPath
} from "./shape-docs.js";
export * from "./normalize-transaction.js";
export * from "./shapes/tinyman/index.js";
export * from "./shapes/folks-finance/index.js";
export * from "./shapes/pact/index.js";
export * from "./shapes/compx/index.js";
export * from "./shapes/dorkfi/index.js";
export {
  mythFinanceMintLstShape,
  mythFinanceRedeemLstShape,
  mythFinanceShapes,
  resolveMythDualStakeState,
  buildMythMintTransactions,
  buildMythRedeemTransactions,
  buildMockMythMintGroup,
  buildMockMythRedeemGroup
} from "./shapes/myth-finance/index.js";
export type {
  MythMintLstInput,
  MythRedeemLstInput,
  MythDualStakeState
} from "./shapes/myth-finance/index.js";
export {
  haystackStakeHayShape,
  haystackUnstakeHayShape,
  haystackClaimRewardsShape,
  haystackShapes,
  resolveHaystackStakingState,
  HAYSTACK_STAKING_APP_ID
} from "./shapes/haystack/index.js";
export type {
  HaystackStakeHayInput,
  HaystackUnstakeHayInput,
  HaystackClaimRewardsInput,
  HaystackStakingState
} from "./shapes/haystack/index.js";
export {
  retiStakeAlgoShape,
  retiUnstakeAlgoShape,
  retiShapes,
  resolveRetiStakeState
} from "./shapes/reti/index.js";
export type {
  RetiStakeAlgoInput,
  RetiUnstakeAlgoInput,
  RetiStakeState,
  RetiUnstakeState
} from "./shapes/reti/index.js";
export {
  alphaArcadeStakeAlphaShape,
  alphaArcadeUnstakeAlphaShape,
  alphaArcadeClaimRewardsShape,
  alphaArcadeShapes,
  resolveAlphaArcadeStakingState,
  ALPHA_ARCADE_STAKING_APP_ID
} from "./shapes/alpha-arcade/index.js";
export type {
  AlphaArcadeStakeAlphaInput,
  AlphaArcadeUnstakeAlphaInput,
  AlphaArcadeClaimRewardsInput,
  AlphaArcadeStakingState
} from "./shapes/alpha-arcade/index.js";

/**
 * Build a registry pre-loaded with every verified transaction shape. Callers
 * that need a custom or empty registry can construct `TransactionShapeRegistry`
 * directly.
 */
export function createExecutionRegistry(): TransactionShapeRegistry {
  const registry = new TransactionShapeRegistry();
  for (const shape of [
    ...tinymanShapes,
    ...folksFinanceShapes,
    ...pactShapes,
    ...compxShapes,
    ...dorkfiShapes,
    ...mythFinanceShapes,
    ...haystackShapes,
    ...retiShapes,
    ...alphaArcadeShapes
  ]) {
    registry.register(shape);
  }
  return registry;
}

/** Default process-wide registry of verified transaction shapes. */
export const executionRegistry = createExecutionRegistry();
