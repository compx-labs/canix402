import type { SessionQuota, SessionReceipt, SessionStatus } from "./types";

export const WEBMCP_SESSION_STORAGE_KEY = "canix402.webmcp.session";
export const MOCKED_SESSION_ID = "csess_demo";

export function isMockedSessionReceipt(receipt: SessionReceipt | null | undefined): boolean {
  return Boolean(receipt && receipt.sessionId === MOCKED_SESSION_ID);
}

export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memorySessionStorage(initial?: Record<string, string>): SessionStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem(key) {
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    }
  };
}

export function defaultSessionStorage(): SessionStorage {
  const local = (globalThis as { localStorage?: SessionStorage }).localStorage;
  return local ?? memorySessionStorage();
}

export function createSessionStore(storage: SessionStorage = defaultSessionStorage()) {
  let ephemeral: SessionReceipt | null = null;
  return {
    get(): SessionReceipt | null {
      if (ephemeral) {
        return ephemeral;
      }
      const raw = storage.getItem(WEBMCP_SESSION_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      try {
        const parsed = parseSessionReceipt(JSON.parse(raw));
        if (isMockedSessionReceipt(parsed)) {
          storage.removeItem(WEBMCP_SESSION_STORAGE_KEY);
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    },
    set(receipt: SessionReceipt): SessionReceipt {
      if (isMockedSessionReceipt(receipt)) {
        ephemeral = receipt;
        storage.removeItem(WEBMCP_SESSION_STORAGE_KEY);
        return receipt;
      }
      ephemeral = null;
      storage.setItem(WEBMCP_SESSION_STORAGE_KEY, JSON.stringify(receipt));
      return receipt;
    },
    clear(): void {
      ephemeral = null;
      storage.removeItem(WEBMCP_SESSION_STORAGE_KEY);
    },
    applyQuota(quota: SessionQuota): SessionReceipt | null {
      const current = this.get();
      if (!current) {
        return null;
      }
      return this.set(applySessionQuota(current, quota));
    }
  };
}

export type WebMcpSessionStore = ReturnType<typeof createSessionStore>;

export function parseSessionReceipt(value: unknown): SessionReceipt | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<SessionReceipt> & { data?: unknown };
  const source =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Partial<SessionReceipt>)
      : candidate;
  if (typeof source.sessionId !== "string" || source.sessionId.length === 0) {
    return null;
  }
  if (typeof source.expiresAt !== "string" || source.expiresAt.length === 0) {
    return null;
  }
  const remaining = parseBudget(source.remaining);
  const budget = parseBudget(source.budget) ?? remaining;
  if (!remaining || !budget) {
    return null;
  }
  const consumed = parseBudget(source.consumed) ?? {
    research: Math.max(0, budget.research - remaining.research),
    quotes: Math.max(0, budget.quotes - remaining.quotes)
  };
  const status = parseStatus(source.status, remaining, source.expiresAt);
  return {
    uri: typeof source.uri === "string" && source.uri.length > 0 ? source.uri : `canix://session/${source.sessionId}`,
    sessionId: source.sessionId,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : source.expiresAt,
    expiresAt: source.expiresAt,
    ttlSeconds: typeof source.ttlSeconds === "number" && source.ttlSeconds > 0 ? source.ttlSeconds : 14_400,
    budget,
    remaining,
    consumed,
    status
  };
}

export function receiptFromToolResult(result: unknown): SessionReceipt | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const record = result as { error?: unknown; data?: unknown };
  if (typeof record.error === "string") {
    return null;
  }
  return parseSessionReceipt(record.data ?? result);
}

export function applySessionQuota(receipt: SessionReceipt, quota: SessionQuota): SessionReceipt {
  const remaining = {
    research: quota.remainingResearch,
    quotes: quota.remainingQuotes
  };
  const expiresAt = quota.expiresAt && quota.expiresAt.length > 0 ? quota.expiresAt : receipt.expiresAt;
  return {
    ...receipt,
    remaining,
    consumed: {
      research: Math.max(0, receipt.budget.research - remaining.research),
      quotes: Math.max(0, receipt.budget.quotes - remaining.quotes)
    },
    expiresAt,
    status: parseStatus(receipt.status, remaining, expiresAt)
  };
}

export function isSessionExpired(receipt: SessionReceipt, now = Date.now()): boolean {
  if (receipt.status === "expired") {
    return true;
  }
  const expires = Date.parse(receipt.expiresAt);
  return Number.isFinite(expires) && expires <= now;
}

export function isSessionExhausted(receipt: SessionReceipt): boolean {
  return receipt.status === "exhausted" || (receipt.remaining.research <= 0 && receipt.remaining.quotes <= 0);
}

export function quotaFromReceipt(receipt: SessionReceipt): SessionQuota {
  return {
    remainingResearch: receipt.remaining.research,
    remainingQuotes: receipt.remaining.quotes,
    expiresAt: receipt.expiresAt
  };
}

function parseBudget(value: unknown): SessionReceipt["budget"] | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const research = Number((value as { research?: unknown }).research);
  const quotes = Number((value as { quotes?: unknown }).quotes);
  if (!Number.isFinite(research) || !Number.isFinite(quotes)) {
    return null;
  }
  return { research, quotes };
}

function parseStatus(
  value: unknown,
  remaining: SessionReceipt["remaining"],
  expiresAt: string
): SessionStatus {
  if (value === "expired" || value === "exhausted" || value === "active") {
    if (value === "active" && remaining.research <= 0 && remaining.quotes <= 0) {
      return "exhausted";
    }
    return value;
  }
  if (isExpiredAt(expiresAt)) {
    return "expired";
  }
  if (remaining.research <= 0 && remaining.quotes <= 0) {
    return "exhausted";
  }
  return "active";
}

function isExpiredAt(expiresAt: string, now = Date.now()): boolean {
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires <= now;
}
