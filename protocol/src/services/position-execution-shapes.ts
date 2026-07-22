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

const TINYMAN_TALGO_STAKING_OPPORTUNITY_ID = "tinyman-staking-talgo";
const FOLKS_XALGO_STAKING_OPPORTUNITY_ID = "folks-staking-xalgo";
const TINYMAN_BURN_TALGO = "mainnet:tinyman:liquid-stake-v1:burn:tAlgo";
const FOLKS_UNSTAKE_IMMEDIATE =
  "mainnet:folks-finance:xalgo-v1:unstake:immediate";
const MYTH_REDEEM_LST = "mainnet:myth-finance:dualstake-v1:redeem:lst";

export function attachExecutionShapesToPosition(
  record: PositionMarketRecord,
  registry: TransactionShapeRegistry = executionRegistry
): PositionRecordV1 {
  const exclusive = exclusiveLiquidStakeShapes(record);
  if (exclusive !== null) {
    return {
      ...record,
      compatibleExitShapeKeys: exclusive.exitKeys.filter((key) =>
        registry.get(key)
      ),
      compatibleManageShapeKeys: exclusive.manageKeys.filter((key) =>
        registry.get(key)
      )
    };
  }

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

/**
 * Liquid-staking receipt ASAs only support a single exit path (burn/unstake/redeem).
 * Avoid attaching unrelated staking exits (e.g. Tinyman stALGO decreaseStake).
 */
function exclusiveLiquidStakeShapes(
  record: PositionMarketRecord
): { exitKeys: string[]; manageKeys: string[] } | null {
  if (record.positionType !== "staked") {
    return null;
  }

  if (
    record.protocol === "tinyman" &&
    record.opportunityId === TINYMAN_TALGO_STAKING_OPPORTUNITY_ID
  ) {
    return { exitKeys: [TINYMAN_BURN_TALGO], manageKeys: [] };
  }

  if (
    record.protocol === "folks-finance" &&
    record.opportunityId === FOLKS_XALGO_STAKING_OPPORTUNITY_ID
  ) {
    return { exitKeys: [FOLKS_UNSTAKE_IMMEDIATE], manageKeys: [] };
  }

  if (
    record.protocol === "myth-finance" &&
    typeof record.opportunityId === "string" &&
    (record.opportunityId.startsWith("myth-staking-") ||
      record.opportunityId.startsWith("myth-farm-"))
  ) {
    return { exitKeys: [MYTH_REDEEM_LST], manageKeys: [] };
  }

  return null;
}
