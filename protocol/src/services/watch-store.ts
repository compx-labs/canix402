import { randomBytes } from "node:crypto";

import { getAppLogger } from "../observability/logger.js";
import { getOrCreateRedisClient } from "./redis-cache.js";
import { secretsEqual } from "./watch-webhook.js";
import type {
  WatchCreateResult,
  WatchFiring,
  WatchGetResult,
  WatchLastSnapshot,
  WatchMutateResult,
  WatchReceipt,
  WatchThresholds
} from "../types/watch.js";
import {
  DEFAULT_WATCH_POLL_SECONDS,
  DEFAULT_WATCH_PRICE_USDC,
  DEFAULT_WATCH_TTL_SECONDS,
  MAX_WATCH_FIRINGS
} from "../types/watch-schema.js";

export const WATCH_KEY_PREFIX = "canix402:watch:";
export const WATCH_INDEX_KEY = "canix402:watch:ids";
export const WATCH_URI_PREFIX = "canix://watch/";

export interface WatchRecord {
  watchId: string;
  address: string;
  thresholds: WatchThresholds;
  webhookUrl: string | null;
  webhookSecret: string;
  createdAtMs: number;
  expiresAtMs: number;
  ttlSeconds: number;
  lastSnapshot: WatchLastSnapshot;
  firings: WatchFiring[];
}

export interface WatchRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: "EX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
}

export interface WatchCreateInput {
  address: string;
  thresholds: WatchThresholds;
  webhookUrl: string | null;
}

export interface WatchStore {
  create(input: WatchCreateInput, nowMs?: number): Promise<WatchCreateResult>;
  refresh(
    watchId: string,
    options?: { rotateSecret?: boolean },
    nowMs?: number
  ): Promise<WatchMutateResult>;
  get(watchId: string, nowMs?: number): Promise<WatchGetResult>;
  rotateSecret(watchId: string, currentSecret: string, nowMs?: number): Promise<WatchMutateResult>;
  listActive(nowMs?: number): Promise<WatchRecord[]>;
  save(record: WatchRecord, nowMs?: number): Promise<WatchMutateResult>;
}

interface WatchClock {
  now(): number;
}

const defaultClock: WatchClock = {
  now: () => Date.now()
};

let injectedStore: WatchStore | undefined;
let injectedClock: WatchClock | undefined;
let memoryStore: MemoryWatchStore | undefined;

export function getWatchTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(env.X402_WATCH_TTL_SECONDS, DEFAULT_WATCH_TTL_SECONDS);
}

export function getWatchPollSeconds(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(env.X402_WATCH_POLL_SECONDS, DEFAULT_WATCH_POLL_SECONDS);
}

export function getWatchPriceUsdc(env: NodeJS.ProcessEnv = process.env): string {
  return env.X402_PRICE_WATCH_USDC?.trim() || DEFAULT_WATCH_PRICE_USDC;
}

export function watchReceiptUri(watchId: string): string {
  return `${WATCH_URI_PREFIX}${watchId}`;
}

export function watchCacheKey(watchId: string): string {
  return `${WATCH_KEY_PREFIX}${watchId}`;
}

export function mintWatchId(): string {
  return `cwatch_${randomBytes(32).toString("hex")}`;
}

export function mintWatchSecret(): string {
  return `wsec_${randomBytes(32).toString("hex")}`;
}

export function mintFiringId(): string {
  return `wfire_${randomBytes(16).toString("hex")}`;
}

export function mintEpisodeId(): string {
  return `wep_${randomBytes(12).toString("hex")}`;
}

export function toWatchReceipt(
  record: WatchRecord,
  nowMs: number,
  options: { includeSecret?: boolean } = {}
): WatchReceipt {
  const expired = record.expiresAtMs <= nowMs;
  return {
    uri: watchReceiptUri(record.watchId),
    watchId: record.watchId,
    address: record.address,
    thresholds: record.thresholds,
    webhookUrl: record.webhookUrl,
    createdAt: new Date(record.createdAtMs).toISOString(),
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    ttlSeconds: record.ttlSeconds,
    status: expired ? "expired" : "active",
    firings: record.firings.slice(-MAX_WATCH_FIRINGS),
    ...(options.includeSecret ? { webhookSecret: record.webhookSecret } : {})
  };
}

export function newWatchRecord(input: WatchCreateInput, nowMs: number): WatchRecord {
  const ttlSeconds = getWatchTtlSeconds();
  return {
    watchId: mintWatchId(),
    address: input.address,
    thresholds: input.thresholds,
    webhookUrl: input.webhookUrl,
    webhookSecret: mintWatchSecret(),
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlSeconds * 1000,
    ttlSeconds,
    lastSnapshot: {},
    firings: []
  };
}

function remainingTtlSeconds(record: WatchRecord, nowMs: number): number {
  return Math.max(1, Math.ceil((record.expiresAtMs - nowMs) / 1000));
}

function appendFiring(record: WatchRecord, firing: WatchFiring): WatchFiring[] {
  return [...record.firings, firing].slice(-MAX_WATCH_FIRINGS);
}

export function withFiring(record: WatchRecord, firing: WatchFiring): WatchRecord {
  const existing = record.firings.find((item) => item.idempotencyKey === firing.idempotencyKey);
  if (existing) {
    return {
      ...record,
      firings: record.firings.map((item) =>
        item.idempotencyKey === firing.idempotencyKey ? { ...item, ...firing, firingId: item.firingId } : item
      )
    };
  }
  return { ...record, firings: appendFiring(record, firing) };
}

export class MemoryWatchStore implements WatchStore {
  private readonly records = new Map<string, WatchRecord>();

  constructor(private readonly clock: WatchClock = defaultClock) {}

  async create(input: WatchCreateInput, nowMs = this.clock.now()): Promise<WatchCreateResult> {
    const record = newWatchRecord(input, nowMs);
    this.records.set(record.watchId, record);
    return { ok: true, receipt: toWatchReceipt(record, nowMs, { includeSecret: true }) };
  }

  async refresh(
    watchId: string,
    options: { rotateSecret?: boolean } = {},
    nowMs = this.clock.now()
  ): Promise<WatchMutateResult> {
    const record = this.records.get(watchId);
    if (!record) {
      return { ok: false, reason: "invalid" };
    }
    if (record.expiresAtMs <= nowMs) {
      this.records.delete(watchId);
      return { ok: false, reason: "expired" };
    }
    const ttlSeconds = getWatchTtlSeconds();
    const refreshed: WatchRecord = {
      ...record,
      expiresAtMs: nowMs + ttlSeconds * 1000,
      ttlSeconds,
      webhookSecret: options.rotateSecret ? mintWatchSecret() : record.webhookSecret
    };
    this.records.set(watchId, refreshed);
    return {
      ok: true,
      receipt: toWatchReceipt(refreshed, nowMs, { includeSecret: options.rotateSecret === true })
    };
  }

  async get(watchId: string, nowMs = this.clock.now()): Promise<WatchGetResult> {
    const record = this.records.get(watchId);
    if (!record) {
      return { ok: false, reason: "invalid" };
    }
    if (record.expiresAtMs <= nowMs) {
      this.records.delete(watchId);
      return { ok: false, reason: "expired" };
    }
    return { ok: true, receipt: toWatchReceipt(record, nowMs) };
  }

  async rotateSecret(
    watchId: string,
    currentSecret: string,
    nowMs = this.clock.now()
  ): Promise<WatchMutateResult> {
    const record = this.records.get(watchId);
    if (!record) {
      return { ok: false, reason: "invalid" };
    }
    if (record.expiresAtMs <= nowMs) {
      this.records.delete(watchId);
      return { ok: false, reason: "expired" };
    }
    if (!secretsEqual(record.webhookSecret, currentSecret)) {
      return { ok: false, reason: "unauthorized" };
    }
    const rotated: WatchRecord = { ...record, webhookSecret: mintWatchSecret() };
    this.records.set(watchId, rotated);
    return { ok: true, receipt: toWatchReceipt(rotated, nowMs, { includeSecret: true }) };
  }

  async listActive(nowMs = this.clock.now()): Promise<WatchRecord[]> {
    const active: WatchRecord[] = [];
    for (const [id, record] of this.records) {
      if (record.expiresAtMs <= nowMs) {
        this.records.delete(id);
        continue;
      }
      active.push(record);
    }
    return active;
  }

  async save(record: WatchRecord, nowMs = this.clock.now()): Promise<WatchMutateResult> {
    if (record.expiresAtMs <= nowMs) {
      this.records.delete(record.watchId);
      return { ok: false, reason: "expired" };
    }
    this.records.set(record.watchId, record);
    return { ok: true, receipt: toWatchReceipt(record, nowMs) };
  }

  getRecord(watchId: string): WatchRecord | undefined {
    return this.records.get(watchId);
  }

  put(record: WatchRecord): void {
    this.records.set(record.watchId, record);
  }

  clear(): void {
    this.records.clear();
  }
}

function defaultRedisClient(): WatchRedisClient | null {
  return getOrCreateRedisClient();
}

export class RedisWatchStore implements WatchStore {
  private readonly clock: WatchClock;

  constructor(
    clock: WatchClock = defaultClock,
    private readonly getClient: () => WatchRedisClient | null = defaultRedisClient
  ) {
    this.clock = clock ?? defaultClock;
  }

  async create(input: WatchCreateInput, nowMs = this.clock.now()): Promise<WatchCreateResult> {
    const client = this.getClient();
    if (!client) {
      return { ok: false, reason: "unavailable" };
    }
    const record = newWatchRecord(input, nowMs);
    try {
      await client.set(
        watchCacheKey(record.watchId),
        JSON.stringify(record),
        "EX",
        remainingTtlSeconds(record, nowMs)
      );
      await client.sadd(WATCH_INDEX_KEY, record.watchId);
      return { ok: true, receipt: toWatchReceipt(record, nowMs, { includeSecret: true }) };
    } catch (error) {
      logStoreError("create", error);
      return { ok: false, reason: "unavailable" };
    }
  }

  async refresh(
    watchId: string,
    options: { rotateSecret?: boolean } = {},
    nowMs = this.clock.now()
  ): Promise<WatchMutateResult> {
    const loaded = await this.loadRecord(watchId, nowMs);
    if (!loaded.ok) {
      return loaded;
    }
    const ttlSeconds = getWatchTtlSeconds();
    const refreshed: WatchRecord = {
      ...loaded.record,
      expiresAtMs: nowMs + ttlSeconds * 1000,
      ttlSeconds,
      webhookSecret: options.rotateSecret ? mintWatchSecret() : loaded.record.webhookSecret
    };
    const saved = await this.persist(refreshed, nowMs);
    if (!saved.ok) {
      return saved;
    }
    return {
      ok: true,
      receipt: toWatchReceipt(refreshed, nowMs, { includeSecret: options.rotateSecret === true })
    };
  }

  async get(watchId: string, nowMs = this.clock.now()): Promise<WatchGetResult> {
    const loaded = await this.loadRecord(watchId, nowMs);
    if (!loaded.ok) {
      return loaded;
    }
    return { ok: true, receipt: toWatchReceipt(loaded.record, nowMs) };
  }

  async rotateSecret(
    watchId: string,
    currentSecret: string,
    nowMs = this.clock.now()
  ): Promise<WatchMutateResult> {
    const loaded = await this.loadRecord(watchId, nowMs);
    if (!loaded.ok) {
      return loaded;
    }
    if (!secretsEqual(loaded.record.webhookSecret, currentSecret)) {
      return { ok: false, reason: "unauthorized" };
    }
    const rotated: WatchRecord = { ...loaded.record, webhookSecret: mintWatchSecret() };
    const saved = await this.persist(rotated, nowMs);
    if (!saved.ok) {
      return saved;
    }
    return { ok: true, receipt: toWatchReceipt(rotated, nowMs, { includeSecret: true }) };
  }

  async listActive(nowMs = this.clock.now()): Promise<WatchRecord[]> {
    const client = this.getClient();
    if (!client) {
      return [];
    }
    try {
      const ids = await client.smembers(WATCH_INDEX_KEY);
      const active: WatchRecord[] = [];
      for (const watchId of ids) {
        const loaded = await this.loadRecord(watchId, nowMs);
        if (loaded.ok) {
          active.push(loaded.record);
        }
      }
      return active;
    } catch (error) {
      logStoreError("listActive", error);
      return [];
    }
  }

  async save(record: WatchRecord, nowMs = this.clock.now()): Promise<WatchMutateResult> {
    return this.persist(record, nowMs);
  }

  private async loadRecord(
    watchId: string,
    nowMs: number
  ): Promise<{ ok: true; record: WatchRecord } | { ok: false; reason: "invalid" | "expired" | "unavailable" }> {
    const client = this.getClient();
    if (!client) {
      return { ok: false, reason: "unavailable" };
    }
    try {
      const raw = await client.get(watchCacheKey(watchId));
      if (!raw) {
        await client.srem(WATCH_INDEX_KEY, watchId);
        return { ok: false, reason: "invalid" };
      }
      const record = JSON.parse(raw) as WatchRecord;
      if (record.expiresAtMs <= nowMs) {
        await client.del(watchCacheKey(watchId));
        await client.srem(WATCH_INDEX_KEY, watchId);
        return { ok: false, reason: "expired" };
      }
      return { ok: true, record };
    } catch (error) {
      logStoreError("get", error);
      return { ok: false, reason: "unavailable" };
    }
  }

  private async persist(record: WatchRecord, nowMs: number): Promise<WatchMutateResult> {
    const client = this.getClient();
    if (!client) {
      return { ok: false, reason: "unavailable" };
    }
    if (record.expiresAtMs <= nowMs) {
      try {
        await client.del(watchCacheKey(record.watchId));
        await client.srem(WATCH_INDEX_KEY, record.watchId);
      } catch (error) {
        logStoreError("expire", error);
      }
      return { ok: false, reason: "expired" };
    }
    try {
      await client.set(
        watchCacheKey(record.watchId),
        JSON.stringify(record),
        "EX",
        remainingTtlSeconds(record, nowMs)
      );
      await client.sadd(WATCH_INDEX_KEY, record.watchId);
      return { ok: true, receipt: toWatchReceipt(record, nowMs) };
    } catch (error) {
      logStoreError("save", error);
      return { ok: false, reason: "unavailable" };
    }
  }
}

class UnavailableWatchStore implements WatchStore {
  async create(): Promise<WatchCreateResult> {
    return { ok: false, reason: "unavailable" };
  }
  async refresh(): Promise<WatchMutateResult> {
    return { ok: false, reason: "unavailable" };
  }
  async get(): Promise<WatchGetResult> {
    return { ok: false, reason: "unavailable" };
  }
  async rotateSecret(): Promise<WatchMutateResult> {
    return { ok: false, reason: "unavailable" };
  }
  async listActive(): Promise<WatchRecord[]> {
    return [];
  }
  async save(): Promise<WatchMutateResult> {
    return { ok: false, reason: "unavailable" };
  }
}

function resolveWatchStore(): WatchStore {
  if (injectedStore) {
    return injectedStore;
  }
  if (process.env.REDIS_URL?.trim()) {
    return new RedisWatchStore(injectedClock ?? defaultClock);
  }
  if (process.env.NODE_ENV === "production") {
    return new UnavailableWatchStore();
  }
  memoryStore ??= new MemoryWatchStore(injectedClock ?? defaultClock);
  return memoryStore;
}

export function getWatchStore(): WatchStore {
  return resolveWatchStore();
}

export function setWatchStoreForTests(store: WatchStore | undefined): void {
  injectedStore = store;
  if (!store) {
    memoryStore = undefined;
  }
}

export function setWatchClockForTests(clock: WatchClock | undefined): void {
  injectedClock = clock;
}

export function resetWatchStoreForTests(): void {
  injectedStore = undefined;
  injectedClock = undefined;
  memoryStore = undefined;
}

function logStoreError(op: string, error: unknown): void {
  getAppLogger().error(
    {
      event: "watch_store_error",
      op,
      err: error instanceof Error ? error.message : String(error)
    },
    "Watch store operation failed"
  );
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
