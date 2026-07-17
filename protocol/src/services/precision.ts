import type {
  OpportunityMarketRecord,
  OpportunityRecordV1
} from "../types/opportunity.js";
import { attachExecutionShapesToOpportunity } from "./opportunity-execution-shapes.js";

// Agents receive a bounded-precision view of yield/USD figures. The standard is
// 6 decimal places (the common Algorand ASA decimal count), but we allow up to
// 12 so that very small but non-zero values are not flattened to zero.
export const PRECISION_DEFAULT_DECIMALS = 6;
export const PRECISION_MAX_DECIMALS = 12;

export function formatDecimalForAgent(
  value: number,
  defaultDecimals: number = PRECISION_DEFAULT_DECIMALS,
  maxDecimals: number = PRECISION_MAX_DECIMALS
): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  // Round to the max first to strip binary floating-point noise
  // (e.g. 0.1 + 0.2 style artifacts) before considering the standard scale.
  const capped = roundTo(value, maxDecimals);
  const standard = roundTo(capped, defaultDecimals);

  // Prefer the standard 6-dp scale whenever it still represents the value with a
  // non-zero result. If 6 dp collapses a small non-zero value to zero, fall back
  // to the higher-precision (up to 12 dp) representation instead.
  return standard !== 0 ? standard : capped;
}

export function formatOpportunityForAgent(
  record: OpportunityMarketRecord | OpportunityRecordV1
): OpportunityRecordV1 {
  const withShapes =
    "executionShapes" in record && Array.isArray(record.executionShapes)
      ? (record as OpportunityRecordV1)
      : attachExecutionShapesToOpportunity(record as OpportunityMarketRecord);

  return {
    ...withShapes,
    apy: formatDecimalForAgent(withShapes.apy),
    tvlUsd: formatDecimalForAgent(withShapes.tvlUsd),
    ...(withShapes.apr !== undefined
      ? { apr: formatDecimalForAgent(withShapes.apr) }
      : {})
  };
}

export function formatOpportunitiesForAgent(
  records: readonly (OpportunityMarketRecord | OpportunityRecordV1)[]
): OpportunityRecordV1[] {
  return records.map(formatOpportunityForAgent);
}

function roundTo(value: number, decimals: number): number {
  // toFixed operates on the decimal string form, avoiding the precision loss of
  // multiply/divide rounding for large magnitudes (e.g. multi-million USD TVL).
  return Number(value.toFixed(decimals));
}
