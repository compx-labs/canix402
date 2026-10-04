import cron, { type ScheduledTask } from "node-cron";

import { getAppLogger } from "../observability/logger.js";
import { publishNfStats, redactSecrets } from "../services/nf-stats.js";
import { CANIX_CACHE_KEY_PREFIX, tryAcquireRedisLock } from "../services/redis-cache.js";

/** Hourly at minute 15 UTC. */
export const NF_STATS_CRON_EXPRESSION = "15 * * * *";

export const NF_STATS_LOCK_KEY = `${CANIX_CACHE_KEY_PREFIX}nf-stats:lock`;

/** Long enough for one catalog pass, short enough to recover if the process dies. */
export const NF_STATS_LOCK_TTL_SEC = 10 * 60;

let scheduledTask: ScheduledTask | null = null;

export function isNfStatsCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NF_STATS_URL?.trim());
}

/**
 * Publish the current stats document.
 * Safe to call from cron, startup, or tests. Never throws.
 */
export async function runNfStatsJob(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const log = getAppLogger();

  if (!isNfStatsCronEnabled(env)) {
    return;
  }

  if (env.REDIS_URL?.trim()) {
    const lock = await tryAcquireRedisLock(NF_STATS_LOCK_KEY, NF_STATS_LOCK_TTL_SEC, env);
    if (lock === "unavailable") {
      log.warn(
        { event: "nf_stats_cron", lock },
        "Neon Forge stats upload skipped: Redis lock unavailable"
      );
      return;
    }
    if (lock !== "acquired") {
      log.info(
        { event: "nf_stats_cron", lock },
        "Neon Forge stats upload skipped: another instance holds the lock"
      );
      return;
    }
  }

  try {
    await publishNfStats({ env });
  } catch (error) {
    const token = env.NF_STATS_TOKEN?.trim() ?? "";
    log.error(
      {
        event: "nf_stats_cron",
        err: redactSecrets(error instanceof Error ? error.message : String(error), token)
      },
      "Neon Forge stats upload failed"
    );
  }
}

export function startNfStatsCron(env: NodeJS.ProcessEnv = process.env): boolean {
  if (scheduledTask) {
    return true;
  }

  if (!isNfStatsCronEnabled(env)) {
    getAppLogger().info(
      { event: "nf_stats_cron", enabled: false },
      "Neon Forge stats cron not started (NF_STATS_URL missing)"
    );
    return false;
  }

  scheduledTask = cron.schedule(
    NF_STATS_CRON_EXPRESSION,
    () => {
      void runNfStatsJob(env);
    },
    { timezone: "UTC" }
  );

  getAppLogger().info(
    {
      event: "nf_stats_cron",
      expression: NF_STATS_CRON_EXPRESSION,
      timezone: "UTC"
    },
    "Neon Forge stats cron started"
  );
  return true;
}

export function stopNfStatsCron(): void {
  if (!scheduledTask) {
    return;
  }
  scheduledTask.stop();
  scheduledTask = null;
  getAppLogger().info({ event: "nf_stats_cron" }, "Neon Forge stats cron stopped");
}

export function resetNfStatsCronForTests(): void {
  if (scheduledTask) {
    scheduledTask.stop();
  }
  scheduledTask = null;
}
