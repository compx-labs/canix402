import algosdk from "algosdk";

import { isOpportunityCacheEnabled, pingRedisCache } from "./redis-cache.js";

const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

export type ReadinessStatus = "ready" | "degraded" | "not_ready";

export interface DependencyCheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface RedisCheckResult extends DependencyCheckResult {
  configured: boolean;
}

export interface ReadinessReport {
  service: "canix402";
  status: ReadinessStatus;
  checks: {
    algod: DependencyCheckResult;
    redis: RedisCheckResult;
  };
}

export interface ReadinessDependencies {
  checkAlgod: () => Promise<DependencyCheckResult>;
  checkRedis: () => Promise<RedisCheckResult>;
}

let dependencyOverrides: Partial<ReadinessDependencies> | null = null;

export function setReadinessDependencyOverrides(
  overrides: Partial<ReadinessDependencies> | null
): void {
  dependencyOverrides = overrides;
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const deps = resolveDependencies();
  const [algod, redis] = await Promise.all([deps.checkAlgod(), deps.checkRedis()]);

  // Redis is soft: cache is fail-open, so only Algod gates readiness.
  const status: ReadinessStatus = !algod.ok
    ? "not_ready"
    : redis.configured && !redis.ok
      ? "degraded"
      : "ready";

  return {
    service: "canix402",
    status,
    checks: { algod, redis }
  };
}

function resolveDependencies(): ReadinessDependencies {
  return {
    checkAlgod: dependencyOverrides?.checkAlgod ?? defaultCheckAlgod,
    checkRedis: dependencyOverrides?.checkRedis ?? defaultCheckRedis
  };
}

async function defaultCheckAlgod(
  env: NodeJS.ProcessEnv = process.env
): Promise<DependencyCheckResult> {
  const started = Date.now();
  const server = env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = env.X402_ALGOD_TOKEN ?? "";
  const algod = new algosdk.Algodv2(token, trimTrailingSlash(server), "");

  try {
    await withTimeout(algod.status().do(), DEFAULT_CHECK_TIMEOUT_MS, "algod status timeout");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function defaultCheckRedis(
  env: NodeJS.ProcessEnv = process.env
): Promise<RedisCheckResult> {
  if (!isOpportunityCacheEnabled(env)) {
    return { configured: false, ok: true };
  }
  return pingRedisCache(DEFAULT_CHECK_TIMEOUT_MS, env);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
