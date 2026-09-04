export const WATCH_KINDS = [
  "healthFactor",
  "claimableUsd",
  "apyDrop",
  "retiCapacity"
] as const;

export type WatchKind = (typeof WATCH_KINDS)[number];

export type WatchStatus = "active" | "expired";

export interface WatchRetiCapacityThreshold {
  minStakerSlotsRemaining?: number;
  minAlgoRoomMicroAlgos?: string;
}

export interface WatchThresholds {
  healthFactor?: number;
  claimableUsd?: number;
  apyDropBps?: number;
  retiCapacity?: true | WatchRetiCapacityThreshold;
}

export interface WatchLastApy {
  opportunityId: string;
  apy: number;
}

export interface WatchLastRetiCapacity {
  opportunityId: string;
  acceptingStake: boolean;
  stakerSlotsRemaining: number | null;
  algoRoomMicroAlgos: string | null;
}

export interface WatchLastSnapshot {
  healthFactor?: number | null;
  claimableUsd?: number | null;
  apyByOpportunityId?: Record<string, number>;
  retiByOpportunityId?: Record<string, WatchLastRetiCapacity>;
  healthFactorEpisodeId?: string | null;
  claimableUsdEpisodeId?: string | null;
  retiEpisodeByOpportunityId?: Record<string, string>;
}

export interface WatchFiring {
  firingId: string;
  idempotencyKey: string;
  kind: WatchKind;
  firedAt: string;
  threshold: number | string | boolean;
  previous: number | string | boolean | null;
  current: number | string | boolean | null;
  opportunityId?: string;
  delivered: boolean;
  deliveryStatus: "pending" | "delivered" | "failed" | "stored";
}

export interface WatchReceipt {
  uri: string;
  watchId: string;
  address: string;
  thresholds: WatchThresholds;
  webhookUrl: string | null;
  createdAt: string;
  expiresAt: string;
  ttlSeconds: number;
  status: WatchStatus;
  firings: WatchFiring[];
  /** Plaintext HMAC secret. Present only on create, refresh-with-rotate, and rotate. */
  webhookSecret?: string;
}

export interface WatchPolicy {
  receiptUriTemplate: "canix://watch/{watchId}";
  ttlSeconds: number;
  priceUsdc: string;
  pollIntervalSeconds: number;
  signatureHeader: "X-Canix-Signature";
  idempotencyHeader: "X-Canix-Idempotency-Key";
  secretHeader: "X-Canix-Watch-Secret";
  note: string;
}

export type WatchFailureReason = "invalid" | "expired" | "unavailable" | "unauthorized";

export type WatchGetResult =
  | { ok: true; receipt: WatchReceipt }
  | { ok: false; reason: WatchFailureReason };

export type WatchCreateResult =
  | { ok: true; receipt: WatchReceipt }
  | { ok: false; reason: "unavailable" };

export type WatchMutateResult =
  | { ok: true; receipt: WatchReceipt }
  | { ok: false; reason: WatchFailureReason };
