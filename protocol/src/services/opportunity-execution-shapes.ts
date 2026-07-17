import {
  executionRegistry,
  type TransactionShapeRegistry,
  type TransactionShapeSpec
} from "../execution/index.js";
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
const FOLKS_STAKE_IMMEDIATE = "mainnet:folks-finance:xalgo-v1:stake:immediate";

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
const TINYMAN_TALGO_STAKING_ENTER_STEPS: ReadonlyArray<{
  shapeKey: string;
  order: number;
  prerequisiteShapeKeys?: readonly string[];
}> = [{ shapeKey: TINYMAN_MINT_TALGO, order: 0 }];

/** Exclusive enter path for Folks xALGO immediate stake. */
const FOLKS_XALGO_STAKING_ENTER_STEPS: ReadonlyArray<{
  shapeKey: string;
  order: number;
  prerequisiteShapeKeys?: readonly string[];
}> = [{ shapeKey: FOLKS_STAKE_IMMEDIATE, order: 0 }];

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

  const executionShapes: OpportunityExecutionShape[] = ordered.map((entry) => ({
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
  }));

  return {
    ...record,
    executionReady: executionShapes.length > 0,
    executionShapes
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

interface OrderedEnterShape {
  shape: TransactionShapeSpec;
  order: number;
  prerequisiteShapeKeys?: readonly string[];
}

function orderEnterShapes(
  record: OpportunityMarketRecord,
  shapes: readonly TransactionShapeSpec[]
): OrderedEnterShape[] {
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
    record.protocol === "folks-finance" &&
    record.opportunityType === "staking" &&
    record.opportunityId === FOLKS_XALGO_STAKING_OPPORTUNITY_ID
  ) {
    return orderBySteps(shapes, FOLKS_XALGO_STAKING_ENTER_STEPS, {
      exclusive: true
    });
  }

  return shapes.map((shape) => ({ shape, order: 0 }));
}

function orderBySteps(
  shapes: readonly TransactionShapeSpec[],
  steps: ReadonlyArray<{
    shapeKey: string;
    order: number;
    prerequisiteShapeKeys?: readonly string[];
  }>,
  options: { exclusive?: boolean } = {}
): OrderedEnterShape[] {
  const byKey = new Map(shapes.map((shape) => [shape.key, shape]));
  const ordered: OrderedEnterShape[] = [];
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
    // dorkfi:algorand:<appId>:<assetIdOrSlug>:<type>
    const parts = record.opportunityId.split(":");
    if (parts.length >= 5) {
      const poolAppId = Number(parts[2]);
      if (Number.isInteger(poolAppId) && poolAppId >= 1) {
        hints.poolAppId = poolAppId;
        hints.marketAppId = poolAppId;
      }
      const assetId = Number(parts[3]);
      if (Number.isInteger(assetId) && assetId >= 0) {
        hints.assetId = assetId;
      }
    }
    if (hints.assetId === undefined && assetIds[0] !== undefined) {
      hints.assetId = assetIds[0];
    }
    return hints;
  }

  if (record.protocol === "tinyman" || record.protocol === "pact") {
    if (
      record.protocol === "tinyman" &&
      record.opportunityId === TINYMAN_TALGO_STAKING_OPPORTUNITY_ID
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
