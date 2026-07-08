import { TransactionShapeRegistry } from "./registry.js";
import { tinymanShapes } from "./shapes/tinyman/index.js";

export * from "./types.js";
export * from "./errors.js";
export {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "./registry.js";
export * from "./shapes/tinyman/index.js";

/**
 * Build a registry pre-loaded with every verified transaction shape. Callers
 * that need a custom or empty registry can construct `TransactionShapeRegistry`
 * directly.
 */
export function createExecutionRegistry(): TransactionShapeRegistry {
  const registry = new TransactionShapeRegistry();
  for (const shape of tinymanShapes) {
    registry.register(shape);
  }
  return registry;
}

/** Default process-wide registry of verified transaction shapes. */
export const executionRegistry = createExecutionRegistry();
