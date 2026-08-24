import { randomBytes } from "node:crypto";

import { getAppLogger } from "../observability/logger.js";
import { getOrCreateRedisClient } from "./redis-cache.js";
import type {
  SessionBucket,
  SessionConsumeResult,
  SessionCreateResult,
  SessionGetResult,
  SessionReceipt
} from "../types/session.js";
import {
  DEFAULT_SESSION_QUOTE_BUDGET,
  DEFAULT_SESSION_RESEARCH_BUDGET,
  DEFAULT_SESSION_TTL_SECONDS
} from "../types/session-schema.js";

export const SESSION_KEY_PREFIX = "canix402:session:";
export const SESSION_URI_PREFIX = "canix://session/";

export interface SessionRecord {
  sessionId: string;
  createdAtMs: number;
  expiresAtMs: number;
  ttlSeconds: number;
  budgetResearch: number;
  budgetQuotes: number;
  remainingResearch: number;
  remainingQuotes: number;
}

export interface SessionRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: "EX", ttl: number): Promise<unknown>;
  eval(
    script: string,
    numKeys: number,
    key: string,
    ...args: string[]
  ): Promise<unknown>;
}

export interface SessionStore {
  create(nowMs?: number): Promise<SessionCreateResult>;
  refresh(sessionId: string | undefined, nowMs?: number): Promise<SessionCreateResult>;
  get(sessionId: string, nowMs?: number): Promise<SessionGetResult>;
  consume(
    sessionId: string,
    bucket: SessionBucket,
    nowMs?: number
  ): Promise<SessionConsumeResult>;
}

interface SessionClock {
  now(): number;
}

const defaultClock: SessionClock = {
  now: () => Date.now()
};

let injectedStore: SessionStore | undefined;
let injectedClock: SessionClock | undefined;
let memoryStore: MemorySessionStore | undefined;

export function getSessionResearchBudget(
  env: NodeJS.ProcessEnv = process.env
): number {
  return parsePositiveInt(env.X402_SESSION_RESEARCH_BUDGET, DEFAULT_SESSION_RESEARCH_BUDGET);
}

export function getSessionQuoteBudget(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(env.X402_SESSION_QUOTE_BUDGET, DEFAULT_SESSION_QUOTE_BUDGET);
}

export function getSessionTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(env.X402_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS);
}

export function sessionReceiptUri(sessionId: string): string {
  return `${SESSION_URI_PREFIX}${sessionId}`;
}

export function sessionCacheKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

export function toSessionReceipt(record: SessionRecord, nowMs: number): SessionReceipt {
  const expired = record.expiresAtMs <= nowMs;
  const exhausted = record.remainingResearch <= 0 && record.remainingQuotes <= 0;
  return {
    uri: sessionReceiptUri(record.sessionId),
    sessionId: record.sessionId,
    createdAt: new Date(record.createdAtMs).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    ttlSeconds: record.ttlSeconds,
    budget: {
      research: record.budgetResearch,
      quotes: record.budgetQuotes
    },
    remaining: {
      research: Math.max(0, record.remainingResearch),
      quotes: Math.max(0, record.remainingQuotes)
    },
    consumed: {
      research: Math.max(0, record.budgetResearch - record.remainingResearch),
      quotes: Math.max(0, record.budgetQuotes - record.remainingQuotes)
    },
    status: expired ? "expired" : exhausted ? "exhausted" : "active"
  };
}

export function mintSessionId(): string {
  return `csess_${randomBytes(32).toString("hex")}`;
}

export function newSessionRecord(nowMs: number, env: NodeJS.ProcessEnv = process.env): SessionRecord {
  const ttlSeconds = getSessionTtlSeconds(env);
  const research = getSessionResearchBudget(env);
  const quotes = getSessionQuoteBudget(env);
  return {
    sessionId: mintSessionId(),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlSeconds * 1000,
    ttlSeconds,
    budgetResearch: research,
    budgetQuotes: quotes,
    remainingResearch: research,
    remainingQuotes: quotes
  };
}

export function resetSessionBudgets(record: SessionRecord, nowMs: number): SessionRecord {
  const ttlSeconds = getSessionTtlSeconds();
  return {
    ...record,
    expiresAtMs: nowMs + ttlSeconds * 1000,
    ttlSeconds,
    budgetResearch: getSessionResearchBudget(),
    budgetQuotes: getSessionQuoteBudget(),
    remainingResearch: getSessionResearchBudget(),
    remainingQuotes: getSessionQuoteBudget()
  };
}

function remainingTtlSeconds(record: SessionRecord, nowMs: number): number {
  return Math.max(1, Math.ceil((record.expiresAtMs - nowMs) / 1000));
}

export class MemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();

  constructor(private readonly clock: SessionClock = defaultClock) {}

  async create(nowMs = this.clock.now()): Promise<SessionCreateResult> {
    const record = newSessionRecord(nowMs);
    this.records.set(record.sessionId, record);
    return { ok: true, receipt: toSessionReceipt(record, nowMs) };
  }

  async refresh(
    sessionId: string | undefined,
    nowMs = this.clock.now()
  ): Promise<SessionCreateResult> {
    if (sessionId) {
      const existing = this.records.get(sessionId);
      if (existing && existing.expiresAtMs > nowMs) {
        const refreshed = resetSessionBudgets(existing, nowMs);
        this.records.set(sessionId, refreshed);
        return { ok: true, receipt: toSessionReceipt(refreshed, nowMs) };
      }
    }
    return this.create(nowMs);
  }

  async get(sessionId: string, nowMs = this.clock.now()): Promise<SessionGetResult> {
    const record = this.records.get(sessionId);
    if (!record) {
      return { ok: false, reason: "invalid" };
    }
    if (record.expiresAtMs <= nowMs) {
      this.records.delete(sessionId);
      return { ok: false, reason: "expired" };
    }
    return { ok: true, receipt: toSessionReceipt(record, nowMs) };
  }

  async consume(
    sessionId: string,
    bucket: SessionBucket,
    nowMs = this.clock.now()
  ): Promise<SessionConsumeResult> {
    const record = this.records.get(sessionId);
    if (!record) {
      return { ok: false, reason: "invalid" };
    }
    if (record.expiresAtMs <= nowMs) {
      this.records.delete(sessionId);
      return { ok: false, reason: "expired" };
    }
    const remaining =
      bucket === "research" ? record.remainingResearch : record.remainingQuotes;
    if (remaining <= 0) {
      return { ok: false, reason: "exhausted" };
    }
    if (bucket === "research") {
      record.remainingResearch -= 1;
    } else {
      record.remainingQuotes -= 1;
    }
    this.records.set(sessionId, record);
    return { ok: true, receipt: toSessionReceipt(record, nowMs) };
  }

  /** Test helper — insert an already-expired or custom record. */
  put(record: SessionRecord): void {
    this.records.set(record.sessionId, record);
  }

  clear(): void {
    this.records.clear();
  }
}

const CONSUME_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {'missing'}
end
local session = cjson.decode(raw)
local nowMs = tonumber(ARGV[1])
local bucket = ARGV[2]
if tonumber(session.expiresAtMs) <= nowMs then
  redis.call('DEL', KEYS[1])
  return {'expired'}
end
if bucket == 'research' then
  if tonumber(session.remainingResearch) <= 0 then
    return {'exhausted'}
  end
  session.remainingResearch = tonumber(session.remainingResearch) - 1
else
  if tonumber(session.remainingQuotes) <= 0 then
    return {'exhausted'}
  end
  session.remainingQuotes = tonumber(session.remainingQuotes) - 1
end
local ttlSec = math.ceil((tonumber(session.expiresAtMs) - nowMs) / 1000)
if ttlSec < 1 then
  redis.call('DEL', KEYS[1])
  return {'expired'}
end
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ttlSec)
return {'ok', cjson.encode(session)}
`;

const REFRESH_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return {'missing'}
end
local session = cjson.decode(raw)
local nowMs = tonumber(ARGV[1])
if tonumber(session.expiresAtMs) <= nowMs then
  redis.call('DEL', KEYS[1])
  return {'expired'}
end
session.expiresAtMs = tonumber(ARGV[2])
session.ttlSeconds = tonumber(ARGV[3])
session.budgetResearch = tonumber(ARGV[4])
session.budgetQuotes = tonumber(ARGV[5])
session.remainingResearch = tonumber(ARGV[4])
session.remainingQuotes = tonumber(ARGV[5])
local ttlSec = tonumber(ARGV[3])
if ttlSec < 1 then
  ttlSec = 1
end
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ttlSec)
return {'ok', cjson.encode(session)}
`;

function defaultRedisClient(): SessionRedisClient | null {
  return getOrCreateRedisClient();
}

export class RedisSessionStore implements SessionStore {
  private readonly clock: SessionClock;

  constructor(
    clock: SessionClock = defaultClock,
    private readonly getClient: () => SessionRedisClient | null = defaultRedisClient
  ) {
    this.clock = clock ?? defaultClock;
  }

  async create(nowMs = this.clock.now()): Promise<SessionCreateResult> {
    const client = this.getClient();
    if (!client) {
      return { ok: false, reason: "unavailable" };
    }
    const record = newSessionRecord(nowMs);
    try {
      await client.set(
        sessionCacheKey(record.sessionId),
        JSON.stringify(record),
        "EX",
        remainingTtlSeconds(record, nowMs)
      );
      return { ok: true, receipt: toSessionReceipt(record, nowMs) };
    } catch (error) {
      getAppLogger().error(
        {
          event: "session_store_error",
          op: "create",
          err: error instanceof Error ? error.message : String(error)
        },
        "Session create failed"
      );
      return { ok: false, reason: "unavailable" };
    }
  }

  async refresh(
    sessionId: string | undefined,
    nowMs = this.clock.now()
  ): Promise<SessionCreateResult> {
    if (!sessionId) {
      return this.create(nowMs);
    }
    const client = this.getClient();
    if (!client) {
      return { ok: false, reason: "unavailable" };
    }
    const ttlSeconds = getSessionTtlSeconds();
    const research = getSessionResearchBudget();
    const quotes = getSessionQuoteBudget();
    const expiresAtMs = nowMs + ttlSeconds * 1000;
    try {
      const result = (await client.eval(
        REFRESH_LUA,
        1,
        sessionCacheKey(sessionId),
        String(nowMs),
        String(expiresAtMs),
        String(ttlSeconds),
        String(research),
        String(quotes)
      )) as string[];
      const status = result?.[0];
      if (status === "ok" && result[1]) {
        const record = JSON.parse(result[1]) as SessionRecord;
        return { ok: true, receipt: toSessionReceipt(record, nowMs) };
      }
    } catch (error) {
      getAppLogger().error(
        {
          event: "session_store_error",
          op: "refresh",
          err: error instanceof Error ? error.message : String(error)
        },
        "Session refresh failed"
      );
      return { ok: false, reason: "unavailable" };
    }
    return this.create(nowMs);
  }

  async get(sessionId: string, nowMs = this.clock.now()): Promise<SessionGetResult> {
    const client = this.getClient();
    if (!client) {
      return { ok: false, reason: "unavailable" };
    }
    try {
      const raw = await client.get(sessionCacheKey(sessionId));
      if (!raw) {
        return { ok: false, reason: "invalid" };
      }
      const record = JSON.parse(raw) as SessionRecord;
      if (record.expiresAtMs <= nowMs) {
        return { ok: false, reason: "expired" };
      }
      return { ok: true, receipt: toSessionReceipt(record, nowMs) };
    } catch (error) {
      getAppLogger().error(
        {
          event: "session_store_error",
          op: "get",
          err: error instanceof Error ? error.message : String(error)
        },
        "Session get failed"
      );
      return { ok: false, reason: "unavailable" };
    }
  }

  async consume(
    sessionId: string,
    bucket: SessionBucket,
    nowMs = this.clock.now()
  ): Promise<SessionConsumeResult> {
    const client = this.getClient();
    if (!client) {
      return { ok: false, reason: "unavailable" };
    }
    try {
      const result = (await client.eval(
        CONSUME_LUA,
        1,
        sessionCacheKey(sessionId),
        String(nowMs),
        bucket
      )) as string[];
      const status = result?.[0];
      if (status === "ok" && result[1]) {
        const record = JSON.parse(result[1]) as SessionRecord;
        return { ok: true, receipt: toSessionReceipt(record, nowMs) };
      }
      if (status === "expired") {
        return { ok: false, reason: "expired" };
      }
      if (status === "exhausted") {
        return { ok: false, reason: "exhausted" };
      }
      return { ok: false, reason: "invalid" };
    } catch (error) {
      getAppLogger().error(
        {
          event: "session_store_error",
          op: "consume",
          err: error instanceof Error ? error.message : String(error)
        },
        "Session consume failed"
      );
      return { ok: false, reason: "unavailable" };
    }
  }
}

class UnavailableSessionStore implements SessionStore {
  async create(): Promise<SessionCreateResult> {
    return { ok: false, reason: "unavailable" };
  }

  async refresh(): Promise<SessionCreateResult> {
    return { ok: false, reason: "unavailable" };
  }

  async get(): Promise<SessionGetResult> {
    return { ok: false, reason: "unavailable" };
  }

  async consume(): Promise<SessionConsumeResult> {
    return { ok: false, reason: "unavailable" };
  }
}

function resolveSessionStore(): SessionStore {
  if (injectedStore) {
    return injectedStore;
  }
  if (process.env.REDIS_URL?.trim()) {
    return new RedisSessionStore(injectedClock ?? defaultClock);
  }
  if (process.env.NODE_ENV === "production") {
    return new UnavailableSessionStore();
  }
  memoryStore ??= new MemorySessionStore(injectedClock ?? defaultClock);
  return memoryStore;
}

export function getSessionStore(): SessionStore {
  return resolveSessionStore();
}

export function setSessionStoreForTests(store: SessionStore | undefined): void {
  injectedStore = store;
  if (!store) {
    memoryStore = undefined;
  }
}

export function setSessionClockForTests(clock: SessionClock | undefined): void {
  injectedClock = clock;
}

export function resetSessionStoreForTests(): void {
  injectedStore = undefined;
  injectedClock = undefined;
  memoryStore = undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
