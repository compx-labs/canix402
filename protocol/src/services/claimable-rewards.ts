import { fetchCompXTokenPrices } from "../adapters/index.js";
import { DEFAULT_COMPX_APP_CALL_MAX_FEE } from "../execution/shapes/compx/shared.js";
import { ALPHA_ARCADE_INNER_TXN_FLAT_FEE } from "../execution/shapes/alpha-arcade/constants.js";
import { DEFAULT_HAYSTACK_APP_CALL_MAX_FEE } from "../execution/shapes/haystack/constants.js";
import type {
  ClaimableQuoteRequest,
  ClaimableRewardRecord,
  ClaimableRewardsResponse,
  ClaimableWorthClaiming
} from "../types/claimable.js";
import type { PositionRecordV1, ProtocolPositionResult } from "../types/position.js";
import { fetchWalletPositions } from "./aggregate-positions.js";

const MIN_ALGO_FEE = 1000n;

export const TINYMAN_FARM_CLAIM = "mainnet:tinyman:staking-v1:farm:claimRewards";
export const TINYMAN_STALGO_CLAIM =
  "mainnet:tinyman:restake-v1:claimRewards:stAlgo";
export const COMPX_CLAIM = "mainnet:compx:v1:claim:rewards";
export const PACT_FARM_CLAIM = "mainnet:pact:v1:farm:claimRewards";
export const HAYSTACK_CLAIM = "mainnet:haystack:v1:claim:rewards";
export const ALPHA_ARCADE_CLAIM =
  "mainnet:alpha-arcade:v1:claimRewards:usdc";

export const CLAIM_DESK_SHAPE_KEYS = [
  TINYMAN_FARM_CLAIM,
  TINYMAN_STALGO_CLAIM,
  COMPX_CLAIM,
  PACT_FARM_CLAIM,
  HAYSTACK_CLAIM,
  ALPHA_ARCADE_CLAIM
] as const;

export type ClaimDeskShapeKey = (typeof CLAIM_DESK_SHAPE_KEYS)[number];

const TINYMAN_STALGO_STAKING_OPPORTUNITY_ID = "tinyman-staking-stalgo";

const CLAIM_DESK_PROTOCOLS = [
  "tinyman",
  "compx",
  "pact",
  "haystack",
  "alpha-arcade"
] as const;

const FEE_HINT_MICRO_ALGOS: Record<ClaimDeskShapeKey, bigint> = {
  [TINYMAN_FARM_CLAIM]: 2n * MIN_ALGO_FEE,
  [TINYMAN_STALGO_CLAIM]: 2n * MIN_ALGO_FEE,
  [COMPX_CLAIM]: DEFAULT_COMPX_APP_CALL_MAX_FEE,
  [PACT_FARM_CLAIM]: 2n * MIN_ALGO_FEE,
  [HAYSTACK_CLAIM]: DEFAULT_HAYSTACK_APP_CALL_MAX_FEE,
  [ALPHA_ARCADE_CLAIM]: ALPHA_ARCADE_INNER_TXN_FLAT_FEE
};

/**
 * Project wallet positions into the claim desk: allowlisted claim shapes only,
 * with fee/worth-claiming hints and ready-to-POST quote inputs.
 */
export async function fetchClaimableRewards(
  address: string
): Promise<ClaimableRewardsResponse> {
  const positions = await fetchWalletPositions(address);
  const algoUsd = await resolveAlgoUsd();
  const records = projectClaimableRecords(positions.data, address, algoUsd);
  const claimAllQuotes = buildClaimAllQuotes(records);
  const protocols = summarizeClaimDeskProtocols(positions.protocols, records);

  return {
    data: records,
    protocols,
    totals: calculateClaimableTotals(records),
    claimAllQuotes,
    meta: {
      address,
      fetchedAt: positions.meta.fetchedAt,
      algoUsd,
      paymentRequired: true
    }
  };
}

/** Pure projection for tests — no network. */
export function projectClaimableRecords(
  positions: readonly PositionRecordV1[],
  address: string,
  algoUsd: number | null
): ClaimableRewardRecord[] {
  const records: ClaimableRewardRecord[] = [];

  for (const position of positions) {
    if (isTinymanStAlgoStaked(position)) {
      records.push(
        buildClaimableRecord({
          position,
          address,
          shapeKey: TINYMAN_STALGO_CLAIM,
          claimKey: `tinyman:stalgo-claim:${address}`,
          algoUsd,
          usdValueOverride: null,
          caveats: [
            ...(position.caveats ?? []),
            "Pending TINY restake rewards are not collected on positions; claim via manage shape."
          ]
        })
      );
      continue;
    }

    if (position.positionType !== "reward") {
      continue;
    }

    const shapeKey = resolveRewardClaimShapeKey(position);
    if (shapeKey === null) {
      continue;
    }

    const claimKey = resolveClaimKey(position, shapeKey, address);
    records.push(
      buildClaimableRecord({
        position,
        address,
        shapeKey,
        claimKey,
        algoUsd
      })
    );
  }

  return records;
}

export function buildClaimAllQuotes(
  records: readonly ClaimableRewardRecord[]
): { quotes: ClaimableQuoteRequest[] } {
  const seen = new Set<string>();
  const quotes: ClaimableQuoteRequest[] = [];

  for (const record of records) {
    if (record.quote === null) {
      continue;
    }
    if (seen.has(record.claimKey)) {
      continue;
    }
    seen.add(record.claimKey);
    quotes.push(record.quote);
  }

  return { quotes };
}

function buildClaimableRecord(params: {
  position: PositionRecordV1;
  address: string;
  shapeKey: ClaimDeskShapeKey;
  claimKey: string;
  algoUsd: number | null;
  usdValueOverride?: number | null;
  caveats?: string[];
}): ClaimableRewardRecord {
  const {
    position,
    address,
    shapeKey,
    claimKey,
    algoUsd,
    usdValueOverride,
    caveats
  } = params;

  const usdValue =
    usdValueOverride !== undefined ? usdValueOverride : position.usdValue;
  const feeMicro = FEE_HINT_MICRO_ALGOS[shapeKey];
  const feeUsd = microAlgosToUsd(feeMicro, algoUsd);
  const quote = buildQuoteInput(position, address, shapeKey);
  const worthClaiming = resolveWorthClaiming(usdValue, feeUsd);

  return {
    protocol: position.protocol,
    positionId: position.positionId,
    opportunityId: position.opportunityId,
    positionType: position.positionType,
    assetId: position.assetId,
    assetSymbol: position.assetSymbol,
    amountRaw: position.amountRaw,
    amount: position.amount,
    usdValue,
    claimKey,
    compatibleClaimShapeKeys: [shapeKey],
    quote,
    estimatedNetworkFeeMicroAlgos: feeMicro.toString(),
    estimatedNetworkFeeUsd: feeUsd,
    worthClaiming,
    ...(shapeKey === TINYMAN_FARM_CLAIM
      ? { submitMode: "tinyman-analytics-claim" as const }
      : {}),
    ...(caveats !== undefined && caveats.length > 0
      ? { caveats }
      : position.caveats !== undefined
        ? { caveats: position.caveats }
        : {}),
    ...(position.notes !== undefined ? { notes: position.notes } : {}),
    ...(position.inputHints !== undefined
      ? { inputHints: position.inputHints }
      : {}),
    ...(position.sourceTimestamp !== undefined
      ? { sourceTimestamp: position.sourceTimestamp }
      : {})
  };
}

function buildQuoteInput(
  position: PositionRecordV1,
  address: string,
  shapeKey: ClaimDeskShapeKey
): ClaimableQuoteRequest | null {
  const hints = position.inputHints ?? {};

  switch (shapeKey) {
    case TINYMAN_FARM_CLAIM: {
      const programId = hints.programId;
      const poolAddress = hints.poolId;
      if (typeof programId !== "number" || typeof poolAddress !== "string") {
        return null;
      }
      return {
        shapeKey,
        input: {
          userAddress: address,
          programId,
          poolAddress
        }
      };
    }
    case TINYMAN_STALGO_CLAIM:
    case HAYSTACK_CLAIM:
    case ALPHA_ARCADE_CLAIM:
      return {
        shapeKey,
        input: { userAddress: address }
      };
    case COMPX_CLAIM: {
      const poolAppId = hints.poolAppId;
      if (typeof poolAppId !== "number") {
        return null;
      }
      return {
        shapeKey,
        input: {
          userAddress: address,
          poolAppId
        }
      };
    }
    case PACT_FARM_CLAIM: {
      const farmAppId = hints.farmAppId;
      if (typeof farmAppId !== "number") {
        return null;
      }
      return {
        shapeKey,
        input: {
          userAddress: address,
          farmAppId
        }
      };
    }
    default:
      return null;
  }
}

function resolveRewardClaimShapeKey(
  position: PositionRecordV1
): ClaimDeskShapeKey | null {
  switch (position.protocol) {
    case "tinyman":
      if (
        typeof position.opportunityId === "string" &&
        position.opportunityId.endsWith(":farm")
      ) {
        return TINYMAN_FARM_CLAIM;
      }
      return null;
    case "compx":
      return COMPX_CLAIM;
    case "pact":
      return PACT_FARM_CLAIM;
    case "haystack":
      return HAYSTACK_CLAIM;
    case "alpha-arcade":
      return ALPHA_ARCADE_CLAIM;
    default:
      return null;
  }
}

function resolveClaimKey(
  position: PositionRecordV1,
  shapeKey: ClaimDeskShapeKey,
  address: string
): string {
  switch (shapeKey) {
    case TINYMAN_FARM_CLAIM: {
      const programId = position.inputHints?.programId;
      const poolId = position.inputHints?.poolId ?? position.opportunityId;
      return `tinyman:farm-claim:${poolId ?? "unknown"}:${programId ?? "unknown"}`;
    }
    case TINYMAN_STALGO_CLAIM:
      return `tinyman:stalgo-claim:${address}`;
    case COMPX_CLAIM: {
      const poolAppId = position.inputHints?.poolAppId;
      return `compx:claim:${poolAppId ?? position.opportunityId ?? position.positionId}`;
    }
    case PACT_FARM_CLAIM: {
      const farmAppId = position.inputHints?.farmAppId;
      return `pact:farm-claim:${farmAppId ?? position.opportunityId ?? position.positionId}`;
    }
    case HAYSTACK_CLAIM:
      return `haystack:claim:${address}`;
    case ALPHA_ARCADE_CLAIM:
      return `alpha-arcade:claim:${address}`;
    default:
      return `${position.protocol}:claim:${position.positionId}`;
  }
}

function isTinymanStAlgoStaked(position: PositionRecordV1): boolean {
  return (
    position.protocol === "tinyman" &&
    position.positionType === "staked" &&
    position.opportunityId === TINYMAN_STALGO_STAKING_OPPORTUNITY_ID
  );
}

function resolveWorthClaiming(
  usdValue: number | null,
  feeUsd: number | null
): ClaimableWorthClaiming {
  if (usdValue === null || feeUsd === null) {
    return null;
  }
  return usdValue > feeUsd;
}

function microAlgosToUsd(
  microAlgos: bigint,
  algoUsd: number | null
): number | null {
  if (algoUsd === null || !Number.isFinite(algoUsd) || algoUsd < 0) {
    return null;
  }
  return (Number(microAlgos) / 1_000_000) * algoUsd;
}

function calculateClaimableTotals(records: readonly ClaimableRewardRecord[]): {
  claimableUsd: number | null;
  estimatedNetworkFeeUsd: number | null;
  worthClaimingUsd: number | null;
} {
  let claimableComplete = true;
  let feeComplete = true;
  let worthComplete = true;
  let claimableUsd = 0;
  let estimatedNetworkFeeUsd = 0;
  let worthClaimingUsd = 0;
  const feeByClaimKey = new Map<string, number | null>();

  for (const record of records) {
    if (record.usdValue === null) {
      claimableComplete = false;
    } else {
      claimableUsd += record.usdValue;
    }

    if (!feeByClaimKey.has(record.claimKey)) {
      feeByClaimKey.set(record.claimKey, record.estimatedNetworkFeeUsd);
    }

    if (record.worthClaiming === null) {
      worthComplete = false;
    } else if (record.worthClaiming && record.usdValue !== null) {
      // Sum reward USD once per claimKey for worth-claiming total.
    }
  }

  const worthClaimKeys = new Set(
    records
      .filter((record) => record.worthClaiming === true)
      .map((record) => record.claimKey)
  );
  const claimUsdByKey = new Map<string, number | null>();
  for (const record of records) {
    const existing = claimUsdByKey.get(record.claimKey);
    if (existing === undefined) {
      claimUsdByKey.set(record.claimKey, record.usdValue);
    } else if (existing !== null && record.usdValue !== null) {
      claimUsdByKey.set(record.claimKey, existing + record.usdValue);
    } else if (record.usdValue === null || existing === null) {
      claimUsdByKey.set(record.claimKey, null);
    }
  }
  for (const claimKey of worthClaimKeys) {
    const usd = claimUsdByKey.get(claimKey);
    if (usd === null || usd === undefined) {
      worthComplete = false;
    } else {
      worthClaimingUsd += usd;
    }
  }

  for (const feeUsd of feeByClaimKey.values()) {
    if (feeUsd === null) {
      feeComplete = false;
    } else {
      estimatedNetworkFeeUsd += feeUsd;
    }
  }

  return {
    claimableUsd: claimableComplete ? claimableUsd : null,
    estimatedNetworkFeeUsd: feeComplete ? estimatedNetworkFeeUsd : null,
    worthClaimingUsd: worthComplete ? worthClaimingUsd : null
  };
}

function summarizeClaimDeskProtocols(
  sourceProtocols: readonly ProtocolPositionResult[],
  records: readonly ClaimableRewardRecord[]
): ProtocolPositionResult[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    counts.set(record.protocol, (counts.get(record.protocol) ?? 0) + 1);
  }

  return CLAIM_DESK_PROTOCOLS.map((protocol) => {
    const source = sourceProtocols.find((entry) => entry.protocol === protocol);
    return {
      protocol,
      status: source?.status ?? "unavailable",
      positionCount: counts.get(protocol) ?? 0,
      message: source?.message ?? null
    };
  });
}

async function resolveAlgoUsd(): Promise<number | null> {
  try {
    const priced = await fetchCompXTokenPrices([0]);
    const price = priced["0"];
    return typeof price === "number" && Number.isFinite(price) && price >= 0
      ? price
      : null;
  } catch {
    return null;
  }
}
