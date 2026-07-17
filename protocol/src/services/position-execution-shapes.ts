import {
  executionRegistry,
  type TransactionShapeRegistry
} from "../execution/index.js";
import type { PositionRecordV1 } from "../types/position.js";

/** Position fields before execution-shape enrichment. */
export type PositionMarketRecord = Omit<
  PositionRecordV1,
  "compatibleExitShapeKeys" | "compatibleManageShapeKeys"
>;

export function attachExecutionShapesToPosition(
  record: PositionMarketRecord,
  registry: TransactionShapeRegistry = executionRegistry
): PositionRecordV1 {
  const shapes = registry.listForPosition(record.protocol, record.positionType);
  return {
    ...record,
    compatibleExitShapeKeys: shapes
      .filter((shape) => shape.opportunityRole === "exit")
      .map((shape) => shape.key),
    compatibleManageShapeKeys: shapes
      .filter((shape) => shape.opportunityRole === "manage")
      .map((shape) => shape.key)
  };
}

export function attachExecutionShapesToPositions(
  records: readonly PositionMarketRecord[],
  registry: TransactionShapeRegistry = executionRegistry
): PositionRecordV1[] {
  return records.map((record) =>
    attachExecutionShapesToPosition(record, registry)
  );
}
