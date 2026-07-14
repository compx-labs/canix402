import type { Protocol } from "../routes/schemas.js";

export const POSITION_TYPES = [
  "supplied",
  "lp",
  "staked",
  "debt",
  "reward"
] as const;

export type PositionType = (typeof POSITION_TYPES)[number];
export type ProtocolPositionStatus = "ok" | "partial" | "unavailable";

/**
 * A protocol-neutral economic position. Amounts are decimal strings so neither
 * base-unit integers nor normalized token values lose precision in JSON.
 */
export interface PositionRecordV1 {
  protocol: Protocol;
  positionType: PositionType;
  positionId: string;
  opportunityId: string | null;
  assetId: number | null;
  assetSymbol: string | null;
  amountRaw: string;
  amount: string;
  usdValue: number | null;
  healthFactor?: number | null;
  sourceTimestamp?: string;
  caveats?: string[];
  notes?: string;
}

export interface WalletPositionTotals {
  suppliedUsd: number | null;
  borrowedUsd: number | null;
  rewardsUsd: number | null;
  netUsd: number | null;
}

export interface ProtocolPositionResult {
  protocol: Protocol;
  status: ProtocolPositionStatus;
  positionCount: number;
  message: string | null;
}

export interface WalletPositionsResponse {
  data: PositionRecordV1[];
  protocols: ProtocolPositionResult[];
  totals: WalletPositionTotals;
  meta: {
    address: string;
    fetchedAt: string;
  };
}
