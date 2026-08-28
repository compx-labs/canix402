export type SessionStatus = "active" | "expired" | "exhausted";

export type SessionBucket = "research" | "quotes";

export interface SessionBudget {
  research: number;
  quotes: number;
}

export interface SessionReceipt {
  uri: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  ttlSeconds: number;
  budget: SessionBudget;
  remaining: SessionBudget;
  consumed: SessionBudget;
  status: SessionStatus;
}

export interface SessionPolicy {
  header: "X-Canix-Session";
  receiptUriTemplate: "canix://session/{sessionId}";
  researchBudget: number;
  quoteBudget: number;
  ttlSeconds: number;
  priceUsdc: string;
  oneShotDefault: true;
  note: string;
}

export type SessionFailureReason =
  | "invalid"
  | "expired"
  | "exhausted"
  | "unavailable";

export type SessionConsumeResult =
  | { ok: true; receipt: SessionReceipt }
  | { ok: false; reason: SessionFailureReason };

export type SessionGetResult =
  | { ok: true; receipt: SessionReceipt }
  | { ok: false; reason: "invalid" | "expired" | "unavailable" };

export type SessionCreateResult =
  | { ok: true; receipt: SessionReceipt }
  | { ok: false; reason: "unavailable" };
