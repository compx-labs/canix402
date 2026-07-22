import {
  executionRegistry,
  type TransactionShapeRegistry,
  type TransactionShapeSpec
} from "../execution/index.js";
import { findCatalogMarketByPoolAndAsset } from "../execution/shapes/dorkfi/market-catalog.js";
import type {
  OpportunityExecutionInputHints,
  OpportunityExecutionShape,
  OpportunityMarketRecord,
  OpportunityRecordV1
} from "../types/opportunity.js";

const FOLKS_SETUP_DEPOSIT_ESCROW =
  "mainnet:folks-finance:v2:setup:depositEscrow";
const FOLKS_SETUP_OPT_ESCROW_ASSET =
  "mainnet:folks-finance:v2:setup:optEscrowAsset";
const FOLKS_DEPOSIT_ESCROW = "mainnet:folks-finance:v2:deposit:escrow";

const PACT_FARM_DEPLOY_ESCROW = "mainnet:pact:v1:farm:deployEscrow";
const PACT_FARM_STAKE = "mainnet:pact:v1:farm:stake";
const PACT_ADD_LIQUIDITY_AND_FARM =
  "mainnet:pact:v1:addLiquidityAndFarm:twoSided";

const TINYMAN_TALGO_STAKING_OPPORTUNITY_ID = "tinyman-staking-talgo";
const FOLKS_XALGO_STAKING_OPPORTUNITY_ID = "folks-staking-xalgo";
const TINYMAN_MINT_TALGO = "mainnet:tinyman:liquid-stake-v1:mint:tAlgo";
const TINYMAN_BURN_TALGO = "mainnet:tinyman:liquid-stake-v1:burn:tAlgo";
const TINYMAN_STALGO_STAKING_OPPORTUNITY_ID = "tinyman-staking-stalgo";
const TINYMAN_INCREASE_STALGO =
  "mainnet:tinyman:restake-v1:increaseStake:stAlgo";
const TINYMAN_DECREASE_STALGO =
  "mainnet:tinyman:restake-v1:decreaseStake:stAlgo";
const FOLKS_STAKE_IMMEDIATE = "mainnet:folks-finance:xalgo-v1:stake:immediate";
const FOLKS_UNSTAKE_IMMEDIATE =
  "mainnet:folks-finance:xalgo-v1:unstake:immediate";
const MYTH_MINT_LST = "mainnet:myth-finance:dualstake-v1:mint:lst";
const MYTH_REDEEM_LST = "mainnet:myth-finance:dualstake-v1:redeem:lst";

type ShapeStep = {
  shapeKey: string;
  order: number;
  prerequisiteShapeKeys?: readonly string[];
};

/**
 * Folks lending opens require an ordered multi-step enter path.
 * Most other protocols treat enter shapes as alternatives (all order 0).
 */
const FOLKS_LENDING_ENTER_STEPS: ReadonlyArray<{
  shapeKey: string;
  order: number;
  prerequisiteShapeKeys?: readonly string[];
}> = [
  { shapeKey: FOLKS_SETUP_DEPOSIT_ESCROW, order: 0 },
  {
    shapeKey: FOLKS_SETUP_OPT_ESCROW_ASSET,
    order: 1,
    prerequisiteShapeKeys: [FOLKS_SETUP_DEPOSIT_ESCROW]
  },
  {
    shapeKey: FOLKS_DEPOSIT_ESCROW,
    order: 2,
    prerequisiteShapeKeys: [FOLKS_SETUP_OPT_ESCROW_ASSET]
  }
];

/**
 * Pact farms require a per-user escrow before stake / addLiquidityAndFarm.
 * Escrow app id is only known after deploy confirms, so deploy is a separate step.
 */
const PACT_FARM_ENTER_STEPS: ReadonlyArray<{
  shapeKey: string;
  order: number;
  prerequisiteShapeKeys?: readonly string[];
}> = [
  { shapeKey: PACT_FARM_DEPLOY_ESCROW, order: 0 },
  {
    shapeKey: PACT_FARM_STAKE,
    order: 1,
    prerequisiteShapeKeys: [PACT_FARM_DEPLOY_ESCROW]
  },
  {
    shapeKey: PACT_ADD_LIQUIDITY_AND_FARM,
    order: 1,
    prerequisiteShapeKeys: [PACT_FARM_DEPLOY_ESCROW]
  }
];

/** Exclusive enter path for Tinyman tALGO (do not attach stALGO restake). */
const TINYMAN_TALGO_STAKING_ENTER_STEPS: ReadonlyArray<ShapeStep> = [
  { shapeKey: TINYMAN_MINT_TALGO, order: 0 }
];

/** Exclusive enter path for Tinyman stALGO restake (do not attach tALGO mint). */
const TINYMAN_STALGO_STAKING_ENTER_STEPS: ReadonlyArray<ShapeStep> = [
  { shapeKey: TINYMAN_INCREASE_STALGO, order: 0 }
];

/** Exclusive enter path for Folks xALGO immediate stake. */
const FOLKS_XALGO_STAKING_ENTER_STEPS: ReadonlyArray<ShapeStep> = [
  { shapeKey: FOLKS_STAKE_IMMEDIATE, order: 0 }
];

/** Exclusive enter path for Myth dualSTAKE mint (staking + passive farms). */
const MYTH_DUALSTAKE_ENTER_STEPS: ReadonlyArray<ShapeStep> = [
  { shapeKey: MYTH_MINT_LST, order: 0 }
];

/** Liquid-staking exit path for Tinyman tALGO burn. */
const TINYMAN_TALGO_STAKING_EXIT_STEPS: ReadonlyArray<ShapeStep> = [
  { shapeKey: TINYMAN_BURN_TALGO, order: 0 }
];

/** Liquid-staking exit path for Tinyman stALGO decrease. */
const TINYMAN_STALGO_STAKING_EXIT_STEPS: ReadonlyArray<ShapeStep> = [
  { shapeKey: TINYMAN_DECREASE_STALGO, order: 0 }
];

/** Liquid-staking exit path for Folks xALGO immediate unstake. */
const FOLKS_XALGO_STAKING_EXIT_STEPS: ReadonlyArray<ShapeStep> = [
  { shapeKey: FOLKS_UNSTAKE_IMMEDIATE, order: 0 }
];

/** Liquid-staking exit path for Myth dualSTAKE redeem. */
const MYTH_DUALSTAKE_EXIT_STEPS: ReadonlyArray<ShapeStep> = [
  { shapeKey: MYTH_REDEEM_LST, order: 0 }
];

export function attachExecutionShapesToOpportunity(
  record: OpportunityMarketRecord,
  registry: TransactionShapeRegistry = executionRegistry
): OpportunityRecordV1 {
  const shapes = registry.listForOpportunity(
    record.protocol,
    record.opportunityType
  );
  const ordered = orderEnterShapes(record, shapes);
  const inputHints = buildInputHints(record);
  const requiredAssetIds = buildRequiredAssetIds(record);

  const executionShapes: OpportunityExecutionShape[] = ordered.map((entry) =>
    toOpportunityExecutionShape(entry, requiredAssetIds, inputHints)
  );

  const exitOrdered = orderExitShapes(record, registry);
  const exitInputHints = buildExitInputHints(record);
  const exitRequiredAssetIds = buildExitRequiredAssetIds(record);
  const compatibleExitShapes: OpportunityExecutionShape[] = exitOrdered.map(
    (entry) =>
      toOpportunityExecutionShape(entry, exitRequiredAssetIds, exitInputHints)
  );

  return {
    ...record,
    executionReady: executionShapes.length > 0,
    executionShapes,
    compatibleExitShapes
  };
}

export function attachExecutionShapesToOpportunities(
  records: readonly OpportunityMarketRecord[],
  registry: TransactionShapeRegistry = executionRegistry
): OpportunityRecordV1[] {
  return records.map((record) =>
    attachExecutionShapesToOpportunity(record, registry)
  );
}

interface OrderedShape {
  shape: TransactionShapeSpec;
  order: number;
  prerequisiteShapeKeys?: readonly string[];
}

function toOpportunityExecutionShape(
  entry: OrderedShape,
  requiredAssetIds: readonly number[],
  inputHints: OpportunityExecutionInputHints
): OpportunityExecutionShape {
  return {
    shapeKey: entry.shape.key,
    protocol: entry.shape.identity.protocol,
    protocolVersion: entry.shape.identity.protocolVersion,
    action: entry.shape.identity.action,
    variant: entry.shape.identity.variant,
    title: entry.shape.title,
    summary: entry.shape.description,
    order: entry.order,
    ...(entry.prerequisiteShapeKeys && entry.prerequisiteShapeKeys.length > 0
      ? { prerequisiteShapeKeys: [...entry.prerequisiteShapeKeys] }
      : {}),
    requiredInputs: [...entry.shape.requiredInputs],
    requiredAssetIds: [...requiredAssetIds],
    ...(Object.keys(inputHints).length > 0 ? { inputHints } : {})
  };
}

function orderEnterShapes(
  record: OpportunityMarketRecord,
  shapes: readonly TransactionShapeSpec[]
): OrderedShape[] {
  if (
    record.protocol === "folks-finance" &&
    record.opportunityType === "lending"
  ) {
    return orderBySteps(shapes, FOLKS_LENDING_ENTER_STEPS);
  }

  if (record.protocol === "pact" && record.opportunityType === "farm") {
    return orderBySteps(shapes, PACT_FARM_ENTER_STEPS);
  }

  if (
    record.protocol === "tinyman" &&
    record.opportunityType === "staking" &&
    record.opportunityId === TINYMAN_TALGO_STAKING_OPPORTUNITY_ID
  ) {
    return orderBySteps(shapes, TINYMAN_TALGO_STAKING_ENTER_STEPS, {
      exclusive: true
    });
  }

  if (
    record.protocol === "tinyman" &&
    record.opportunityType === "staking" &&
    record.opportunityId === TINYMAN_STALGO_STAKING_OPPORTUNITY_ID
  ) {
    return orderBySteps(shapes, TINYMAN_STALGO_STAKING_ENTER_STEPS, {
      exclusive: true
    });
  }

  if (
    record.protocol === "folks-finance" &&
    record.opportunityType === "staking" &&
    record.opportunityId === FOLKS_XALGO_STAKING_OPPORTUNITY_ID
  ) {
    return orderBySteps(shapes, FOLKS_XALGO_STAKING_ENTER_STEPS, {
      exclusive: true
    });
  }

  if (isMythDualStakeOpportunity(record)) {
    return orderBySteps(shapes, MYTH_DUALSTAKE_ENTER_STEPS, {
      exclusive: true
    });
  }

  return shapes.map((shape) => ({ shape, order: 0 }));
}

/**
 * Exit shapes are looked up by key (not listForOpportunity, which is enter-only).
 * Only liquid-staking opportunities attach exits today.
 */
function orderExitShapes(
  record: OpportunityMarketRecord,
  registry: TransactionShapeRegistry
): OrderedShape[] {
  const steps = resolveExitSteps(record);
  if (steps.length === 0) {
    return [];
  }
  const ordered: OrderedShape[] = [];
  for (const step of steps) {
    const shape = registry.get(step.shapeKey);
    if (!shape) {
      continue;
    }
    ordered.push({
      shape,
      order: step.order,
      ...(step.prerequisiteShapeKeys !== undefined
        ? { prerequisiteShapeKeys: step.prerequisiteShapeKeys }
        : {})
    });
  }
  return ordered;
}

function resolveExitSteps(
  record: OpportunityMarketRecord
): ReadonlyArray<ShapeStep> {
  if (
    record.protocol === "tinyman" &&
    record.opportunityType === "staking" &&
    record.opportunityId === TINYMAN_TALGO_STAKING_OPPORTUNITY_ID
  ) {
    return TINYMAN_TALGO_STAKING_EXIT_STEPS;
  }
  if (
    record.protocol === "tinyman" &&
    record.opportunityType === "staking" &&
    record.opportunityId === TINYMAN_STALGO_STAKING_OPPORTUNITY_ID
  ) {
    return TINYMAN_STALGO_STAKING_EXIT_STEPS;
  }
  if (
    record.protocol === "folks-finance" &&
    record.opportunityType === "staking" &&
    record.opportunityId === FOLKS_XALGO_STAKING_OPPORTUNITY_ID
  ) {
    return FOLKS_XALGO_STAKING_EXIT_STEPS;
  }
  if (isMythDualStakeOpportunity(record)) {
    return MYTH_DUALSTAKE_EXIT_STEPS;
  }
  return [];
}

function orderBySteps(
  shapes: readonly TransactionShapeSpec[],
  steps: ReadonlyArray<ShapeStep>,
  options: { exclusive?: boolean } = {}
): OrderedShape[] {
  const byKey = new Map(shapes.map((shape) => [shape.key, shape]));
  const ordered: OrderedShape[] = [];
  for (const step of steps) {
    const shape = byKey.get(step.shapeKey);
    if (!shape) {
      continue;
    }
    ordered.push({
      shape,
      order: step.order,
      ...(step.prerequisiteShapeKeys !== undefined
        ? { prerequisiteShapeKeys: step.prerequisiteShapeKeys }
        : {})
    });
  }
  if (!options.exclusive) {
    for (const shape of shapes) {
      if (ordered.some((entry) => entry.shape.key === shape.key)) {
        continue;
      }
      ordered.push({ shape, order: ordered.length });
    }
  }
  return ordered;
}

function buildInputHints(
  record: OpportunityMarketRecord
): OpportunityExecutionInputHints {
  const hints: OpportunityExecutionInputHints = {};
  const assetIds = record.assetIds ?? [];

  if (record.protocol === "folks-finance") {
    if (record.opportunityId === FOLKS_XALGO_STAKING_OPPORTUNITY_ID) {
      if (assetIds[0] !== undefined) {
        hints.assetId = assetIds[0];
        hints.depositAssetId = assetIds[0];
      }
      return hints;
    }
    const poolAppId = parseTrailingAppId(record.opportunityId, "folks-lending-");
    if (poolAppId !== null) {
      hints.poolAppId = poolAppId;
    }
    if (assetIds[0] !== undefined) {
      hints.assetId = assetIds[0];
    }
    return hints;
  }

  if (record.protocol === "compx") {
    if (record.opportunityType === "lending") {
      const marketAppId = parseTrailingAppId(
        record.opportunityId,
        "compx-lending-"
      );
      if (marketAppId !== null) {
        hints.marketAppId = marketAppId;
      }
      if (assetIds[0] !== undefined) {
        hints.assetId = assetIds[0];
      }
      return hints;
    }
    if (record.opportunityType === "staking") {
      const poolAppId = parseTrailingAppId(
        record.opportunityId,
        "compx-staking-"
      );
      if (poolAppId !== null) {
        hints.poolAppId = poolAppId;
      }
      if (assetIds[0] !== undefined) {
        hints.assetId = assetIds[0];
      }
      return hints;
    }
  }

  if (record.protocol === "dorkfi") {
    // dorkfi:algorand:<poolAppId>:<assetIdOrSlug>:<type>
    // Opportunity IDs carry the pool app, not the distinct market app.
    const parts = record.opportunityId.split(":");
    if (parts.length >= 5) {
      const poolAppId = Number(parts[2]);
      if (Number.isInteger(poolAppId) && poolAppId >= 1) {
        hints.poolAppId = poolAppId;
      }
      const assetId = Number(parts[3]);
      if (Number.isInteger(assetId) && assetId >= 0) {
        hints.assetId = assetId;
      }
    }
    if (hints.assetId === undefined && assetIds[0] !== undefined) {
      hints.assetId = assetIds[0];
    }
    if (hints.poolAppId !== undefined && hints.assetId !== undefined) {
      const catalogMarket = findCatalogMarketByPoolAndAsset({
        poolAppId: hints.poolAppId,
        assetId: hints.assetId
      });
      if (catalogMarket !== undefined) {
        hints.marketAppId = catalogMarket.marketAppId;
      }
    }
    return hints;
  }

  if (record.protocol === "myth-finance") {
    const appId =
      parseTrailingAppId(record.opportunityId, "myth-staking-") ??
      parseTrailingAppId(record.opportunityId, "myth-farm-");
    if (appId !== null) {
      hints.poolAppId = appId;
    }
    if (assetIds[0] !== undefined) {
      hints.assetId = assetIds[0];
      hints.depositAssetId = assetIds[0];
    }
    if (assetIds[0] !== undefined && assetIds[1] !== undefined) {
      hints.assetAId = assetIds[0];
      hints.assetBId = assetIds[1];
    }
    return hints;
  }

  if (record.protocol === "tinyman" || record.protocol === "pact") {
    if (
      record.protocol === "tinyman" &&
      (record.opportunityId === TINYMAN_TALGO_STAKING_OPPORTUNITY_ID ||
        record.opportunityId === TINYMAN_STALGO_STAKING_OPPORTUNITY_ID)
    ) {
      if (assetIds[0] !== undefined) {
        hints.assetId = assetIds[0];
        hints.depositAssetId = assetIds[0];
      }
      return hints;
    }
    if (assetIds.length >= 2) {
      const assetAId = assetIds[0];
      const assetBId = assetIds[1];
      if (assetAId !== undefined) {
        hints.assetAId = assetAId;
      }
      if (assetBId !== undefined) {
        hints.assetBId = assetBId;
      }
    } else if (assetIds.length === 1) {
      const only = assetIds[0];
      if (only !== undefined) {
        hints.assetId = only;
        hints.depositAssetId = only;
      }
    }
    const poolId = stripOpportunityTypeSuffix(record.opportunityId);
    if (poolId.length > 0) {
      hints.poolId = poolId;
    }
    if (record.protocol === "pact" && record.opportunityType === "farm") {
      const farmAppId = Number(poolId);
      if (Number.isInteger(farmAppId) && farmAppId >= 1) {
        hints.farmAppId = farmAppId;
      }
    }
    return hints;
  }

  if (assetIds[0] !== undefined) {
    hints.assetId = assetIds[0];
  }
  return hints;
}

function buildRequiredAssetIds(record: OpportunityMarketRecord): number[] {
  const assetIds = record.assetIds ?? [];

  if (
    (record.protocol === "tinyman" || record.protocol === "pact") &&
    record.opportunityType === "lp" &&
    assetIds.length >= 2
  ) {
    const assetAId = assetIds[0];
    const assetBId = assetIds[1];
    if (assetAId === undefined || assetBId === undefined) {
      return [];
    }
    return [assetAId, assetBId];
  }

  if (record.protocol === "compx" && record.opportunityType === "staking") {
    // staked asset is first; reward asset is second and not required to enter
    return assetIds[0] !== undefined ? [assetIds[0]] : [];
  }

  if (record.protocol === "myth-finance") {
    // mint requires ALGO + paired ASA; LST is the receipt
    const algoId = assetIds[0];
    const asaId = assetIds[1];
    if (algoId === undefined || asaId === undefined) {
      return [];
    }
    return [algoId, asaId];
  }

  if (assetIds.length > 0) {
    // lending / single-asset / farm: require the primary underlying asset(s)
    if (
      record.opportunityType === "lending" ||
      record.opportunityType === "staking"
    ) {
      const primary = assetIds[0];
      return primary !== undefined ? [primary] : [];
    }
    return [...assetIds];
  }

  return [];
}

/** Receipt token (xALGO / tALGO / dualSTAKE LST) for liquid-staking exits. */
function buildExitRequiredAssetIds(record: OpportunityMarketRecord): number[] {
  if (!isLiquidStakingOpportunity(record)) {
    return [];
  }
  if (record.protocol === "myth-finance") {
    const receipt = record.assetIds?.[2];
    return receipt !== undefined ? [receipt] : [];
  }
  const receipt = record.assetIds?.[1];
  return receipt !== undefined ? [receipt] : [];
}

function buildExitInputHints(
  record: OpportunityMarketRecord
): OpportunityExecutionInputHints {
  if (!isLiquidStakingOpportunity(record)) {
    return {};
  }
  const hints: OpportunityExecutionInputHints = {};
  if (record.protocol === "myth-finance") {
    const appId =
      parseTrailingAppId(record.opportunityId, "myth-staking-") ??
      parseTrailingAppId(record.opportunityId, "myth-farm-");
    if (appId !== null) {
      hints.poolAppId = appId;
    }
    const receipt = record.assetIds?.[2];
    if (receipt !== undefined) {
      hints.assetId = receipt;
      hints.depositAssetId = receipt;
    }
    return hints;
  }
  const receipt = record.assetIds?.[1];
  if (receipt !== undefined) {
    hints.assetId = receipt;
    hints.depositAssetId = receipt;
  }
  return hints;
}

function isLiquidStakingOpportunity(record: OpportunityMarketRecord): boolean {
  return (
    (record.protocol === "tinyman" &&
      (record.opportunityId === TINYMAN_TALGO_STAKING_OPPORTUNITY_ID ||
        record.opportunityId === TINYMAN_STALGO_STAKING_OPPORTUNITY_ID)) ||
    (record.protocol === "folks-finance" &&
      record.opportunityId === FOLKS_XALGO_STAKING_OPPORTUNITY_ID) ||
    isMythDualStakeOpportunity(record)
  );
}

function isMythDualStakeOpportunity(record: OpportunityMarketRecord): boolean {
  return (
    record.protocol === "myth-finance" &&
    (record.opportunityType === "staking" || record.opportunityType === "farm") &&
    (record.opportunityId.startsWith("myth-staking-") ||
      record.opportunityId.startsWith("myth-farm-"))
  );
}

function parseTrailingAppId(opportunityId: string, prefix: string): number | null {
  if (!opportunityId.startsWith(prefix)) {
    return null;
  }
  const raw = opportunityId.slice(prefix.length);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function stripOpportunityTypeSuffix(opportunityId: string): string {
  const suffixes = [":lp", ":farm", ":staking", ":lending"];
  for (const suffix of suffixes) {
    if (opportunityId.endsWith(suffix)) {
      return opportunityId.slice(0, -suffix.length);
    }
  }
  return opportunityId;
}
