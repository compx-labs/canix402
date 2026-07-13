import { TransactionShapeRegistry } from "./registry.js";
import { compxShapes } from "./shapes/compx/index.js";
import { dorkfiShapes } from "./shapes/dorkfi/index.js";
import { folksFinanceShapes } from "./shapes/folks-finance/index.js";
import { pactShapes } from "./shapes/pact/index.js";
import { tinymanShapes } from "./shapes/tinyman/index.js";

export * from "./types.js";
export * from "./errors.js";
export {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "./registry.js";
export * from "./normalize-transaction.js";
export * from "./shapes/tinyman/index.js";
export * from "./shapes/folks-finance/index.js";
export * from "./shapes/pact/index.js";
export * from "./shapes/compx/index.js";
export * from "./shapes/dorkfi/index.js";

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
    ...dorkfiShapes
  ]) {
    registry.register(shape);
  }
  return registry;
}

/** Default process-wide registry of verified transaction shapes. */
export const executionRegistry = createExecutionRegistry();
