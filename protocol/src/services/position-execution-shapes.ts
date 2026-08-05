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
const TINYMAN_STALGO_STAKING_OPPORTUNITY_ID = "tinyman-staking-stalgo";
const FOLKS_XALGO_STAKING_OPPORTUNITY_ID = "folks-staking-xalgo";
const TINYMAN_BURN_TALGO = "mainnet:tinyman:liquid-stake-v1:burn:tAlgo";
const TINYMAN_DECREASE_STALGO =
  "mainnet:tinyman:restake-v1:decreaseStake:stAlgo";
const TINYMAN_CLAIM_STALGO =
  "mainnet:tinyman:restake-v1:claimRewards:stAlgo";
const TINYMAN_FARM_UNCOMMIT = "mainnet:tinyman:staking-v1:farm:uncommit";
const TINYMAN_FARM_CLAIM = "mainnet:tinyman:staking-v1:farm:claimRewards";
const FOLKS_UNSTAKE_IMMEDIATE =
  "mainnet:folks-finance:xalgo-v1:unstake:immediate";
const FOLKS_BORROW_VARIABLE = "mainnet:folks-finance:v2:borrow:variable";
const FOLKS_COLLATERAL_SYNC = "mainnet:folks-finance:v2:collateral:sync";
const FOLKS_COLLATERAL_REDUCE = "mainnet:folks-finance:v2:collateral:reduce";
const FOLKS_REPAY_WITH_TXN = "mainnet:folks-finance:v2:repay:withTxn";
const MYTH_REDEEM_LST = "mainnet:myth-finance:dualstake-v1:redeem:lst";
const RETI_UNSTAKE_ALGO = "mainnet:reti:v1:unstake:algo";
const COMPX_BORROW_ASA = "mainnet:compx:v1:borrow:asa";
const COMPX_WITHDRAW_ASA = "mainnet:compx:v1:withdraw:asa";
const COMPX_REPAY_ASA = "mainnet:compx:v1:repay:asa";
const DORKFI_WITHDRAW_ASA = "mainnet:dorkfi:v1:withdraw:asa";
const DORKFI_BORROW_ASA = "mainnet:dorkfi:v1:borrow:asa";
const DORKFI_REPAY_ASA = "mainnet:dorkfi:v1:repay:asa";

export function attachExecutionShapesToPosition(
  record: PositionMarketRecord,
  registry: TransactionShapeRegistry = executionRegistry
): PositionRecordV1 {
  if (isDorkFiUsdAggregate(record)) {
    return {
      ...record,
      compatibleExitShapeKeys: [],
      compatibleManageShapeKeys: []
    };
  }

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

  if (isTinymanFarmedLp(record)) {
    const lpShapes = registry.listForPosition(record.protocol, "lp");
    const exitKeys = lpShapes
      .filter((shape) => shape.opportunityRole === "exit")
      .map((shape) => shape.key);
    if (registry.get(TINYMAN_FARM_UNCOMMIT)) {
      exitKeys.push(TINYMAN_FARM_UNCOMMIT);
    }
    return {
      ...record,
      compatibleExitShapeKeys: exitKeys,
      compatibleManageShapeKeys: []
    };
  }

  if (isTinymanFarmReward(record)) {
    return {
      ...record,
      compatibleExitShapeKeys: [],
      compatibleManageShapeKeys: registry.get(TINYMAN_FARM_CLAIM)
        ? [TINYMAN_FARM_CLAIM]
        : []
    };
  }

  const exclusiveDorkFi = exclusiveDorkFiLendingShapes(record);
  if (exclusiveDorkFi !== null) {
    return {
      ...record,
      compatibleExitShapeKeys: exclusiveDorkFi.exitKeys.filter((key) =>
        registry.get(key)
      ),
      compatibleManageShapeKeys: exclusiveDorkFi.manageKeys.filter((key) =>
        registry.get(key)
      )
    };
  }

  const exclusiveCompX = exclusiveCompXLendingShapes(record);
  if (exclusiveCompX !== null) {
    return {
      ...record,
      compatibleExitShapeKeys: exclusiveCompX.exitKeys.filter((key) =>
        registry.get(key)
      ),
      compatibleManageShapeKeys: exclusiveCompX.manageKeys.filter((key) =>
        registry.get(key)
      )
    };
  }

  const exclusiveFolks = exclusiveFolksLendingShapes(record);
  if (exclusiveFolks !== null) {
    return {
      ...record,
      compatibleExitShapeKeys: exclusiveFolks.exitKeys.filter((key) =>
        registry.get(key)
      ),
      compatibleManageShapeKeys: exclusiveFolks.manageKeys.filter((key) =>
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
    record.protocol === "tinyman" &&
    record.opportunityId === TINYMAN_STALGO_STAKING_OPPORTUNITY_ID
  ) {
    return {
      exitKeys: [TINYMAN_DECREASE_STALGO],
      manageKeys: [TINYMAN_CLAIM_STALGO]
    };
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

  if (
    record.protocol === "reti" &&
    record.positionType === "staked" &&
    typeof record.opportunityId === "string" &&
    record.opportunityId.startsWith("reti-staking-")
  ) {
    return { exitKeys: [RETI_UNSTAKE_ALGO], manageKeys: [] };
  }

  return null;
}

function isTinymanFarmedLp(record: PositionMarketRecord): boolean {
  return (
    record.protocol === "tinyman" &&
    record.positionType === "lp" &&
    (record.caveats ?? []).some((caveat) =>
      caveat.includes("Committed to Tinyman farm")
    )
  );
}

function isTinymanFarmReward(record: PositionMarketRecord): boolean {
  return (
    record.protocol === "tinyman" &&
    record.positionType === "reward" &&
    typeof record.opportunityId === "string" &&
    record.opportunityId.endsWith(":farm")
  );
}

/** Pool-level USD summaries are informational only — never attach withdraw shapes. */
function isDorkFiUsdAggregate(record: PositionMarketRecord): boolean {
  return (
    record.protocol === "dorkfi" &&
    (record.positionId.startsWith("dorkfi:supplied-usd:") ||
      record.positionId.startsWith("dorkfi:debt-usd:"))
  );
}

/**
 * Dork.fi lending positions need exclusive shape wiring:
 * - ASA supplied (opportunityId dorkfi:*, not supplied-usd) → withdraw exit + borrow manage
 * - asset-level debt (dorkfi:debt:*, not debt-usd) → repay exit only
 */
function exclusiveDorkFiLendingShapes(
  record: PositionMarketRecord
): { exitKeys: string[]; manageKeys: string[] } | null {
  if (record.protocol !== "dorkfi") {
    return null;
  }
  if (
    record.positionType === "supplied" &&
    typeof record.opportunityId === "string" &&
    record.opportunityId.startsWith("dorkfi:") &&
    !record.positionId.startsWith("dorkfi:supplied-usd:")
  ) {
    return {
      exitKeys: [DORKFI_WITHDRAW_ASA],
      manageKeys: [DORKFI_BORROW_ASA]
    };
  }
  if (
    record.positionType === "debt" &&
    record.positionId.startsWith("dorkfi:debt:")
  ) {
    return { exitKeys: [DORKFI_REPAY_ASA], manageKeys: [] };
  }
  return null;
}

/**
 * CompX lending positions need exclusive shape wiring:
 * - supplied → withdraw exit + borrow manage (leverage-up)
 * - debt → repay exit only (do not attach withdraw)
 */
function exclusiveCompXLendingShapes(
  record: PositionMarketRecord
): { exitKeys: string[]; manageKeys: string[] } | null {
  if (record.protocol !== "compx") {
    return null;
  }
  if (
    record.positionType === "supplied" &&
    typeof record.opportunityId === "string" &&
    record.opportunityId.startsWith("compx-lending-")
  ) {
    return {
      exitKeys: [COMPX_WITHDRAW_ASA],
      manageKeys: [COMPX_BORROW_ASA]
    };
  }
  if (
    record.positionType === "debt" &&
    typeof record.opportunityId === "string" &&
    record.opportunityId.startsWith("compx-lending-")
  ) {
    return { exitKeys: [COMPX_REPAY_ASA], manageKeys: [] };
  }
  return null;
}

/**
 * Folks loan positions need exclusive shape wiring:
 * - collateral → borrow + sync manage; reduce exit
 * - debt → repay exit only
 */
function exclusiveFolksLendingShapes(
  record: PositionMarketRecord
): { exitKeys: string[]; manageKeys: string[] } | null {
  if (record.protocol !== "folks-finance") {
    return null;
  }
  if (record.positionId.startsWith("folks-finance:collateral:")) {
    return {
      exitKeys: [FOLKS_COLLATERAL_REDUCE],
      manageKeys: [FOLKS_BORROW_VARIABLE, FOLKS_COLLATERAL_SYNC]
    };
  }
  if (record.positionType === "debt") {
    return { exitKeys: [FOLKS_REPAY_WITH_TXN], manageKeys: [] };
  }
  return null;
}
