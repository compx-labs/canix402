import { Redis } from "ioredis";

/**
 * Redis cache for Canix protocol.
 *
 * Isolation from CompX/Orbital (shared Redis server):
 * - Use a dedicated DB index in REDIS_URL (e.g. redis://host:6379/6)
 * - Every key is prefixed with `canix402:`
 *
 * Cache is disabled when REDIS_URL is unset or OPPORTUNITIES_CACHE_DISABLED=1.
 * Get/set errors fail open (treat as miss / skip write).
 */

export const CANIX_CACHE_KEY_PREFIX = "canix402:";

const DEFAULT_OPPORTUNITIES_TTL_SEC = 45;

let redisClient: Redis | null = null;

export function isOpportunityCacheEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.OPPORTUNITIES_CACHE_DISABLED === "1") {
    return false;
  }
  const url = env.REDIS_URL?.trim();
  return Boolean(url);
}

export function getOpportunitiesCacheTtlSec(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.OPPORTUNITIES_CACHE_TTL_SEC?.trim();
  if (!raw) {
    return DEFAULT_OPPORTUNITIES_TTL_SEC;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OPPORTUNITIES_TTL_SEC;
  }
  return Math.floor(parsed);
}

export function opportunityCacheKey(
  network: string,
  protocol: string
): string {
  return `${CANIX_CACHE_KEY_PREFIX}opportunities:protocol:${network}:${protocol}`;
}

function getRedisClient(
  env: NodeJS.ProcessEnv = process.env
): Redis | null {
  if (!isOpportunityCacheEnabled(env)) {
    return null;
  }
  if (redisClient) {
    return redisClient;
  }

  const redisUrl = env.REDIS_URL!.trim();

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times: number) => Math.min(times * 50, 2000)
    });

    redisClient.on("error", (error: Error) => {
      // Fail-open: log but do not crash the API process.
      console.error("[canix402:redis]", error.message);
    });

    return redisClient;
  } catch (error) {
    console.error(
      "[canix402:redis] failed to create client",
      error instanceof Error ? error.message : error
    );
    redisClient = null;
    return null;
  }
}

export async function getCacheJson<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const value = await client.get(key);
    if (!value) {
      return null;
    }
    return JSON.parse(value) as T;
  } catch (error) {
    console.error(
      `[canix402:redis] get failed for ${key}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export async function setCacheJson<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<boolean> {
  const client = getRedisClient();
  if (!client || ttlSeconds <= 0) {
    return false;
  }

  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(
      `[canix402:redis] set failed for ${key}:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

export async function getOrSetCacheJson<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number
): Promise<{ value: T; cacheHit: boolean }> {
  const cached = await getCacheJson<T>(key);
  if (cached !== null) {
    return { value: cached, cacheHit: true };
  }

  const value = await fetchFn();
  // Fire-and-forget write; caller already has the value.
  void setCacheJson(key, value, ttlSeconds);
  return { value, cacheHit: false };
}

export async function closeRedisCache(): Promise<void> {
  if (!redisClient) {
    return;
  }
  const client = redisClient;
  redisClient = null;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

/** Test helper — resets singleton state between tests. */
export function resetRedisCacheForTests(): void {
  if (redisClient) {
    try {
      redisClient.disconnect();
    } catch {
      // ignore
    }
  }
  redisClient = null;
}
