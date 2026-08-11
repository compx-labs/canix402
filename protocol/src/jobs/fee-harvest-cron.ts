import cron, { type ScheduledTask } from "node-cron";

import { getAppLogger } from "../observability/logger.js";
import { runFeeHarvest } from "../services/fee-harvest.js";
import {
  CANIX_CACHE_KEY_PREFIX,
  tryAcquireRedisLock
} from "../services/redis-cache.js";

/** Wednesday 00:00 UTC. */
export const FEE_HARVEST_CRON_EXPRESSION = "0 0 * * 3";

export const FEE_HARVEST_LOCK_KEY = `${CANIX_CACHE_KEY_PREFIX}fee-harvest:lock`;

/** Lock TTL — long enough for one harvest, short enough to recover from crashes. */
export const FEE_HARVEST_LOCK_TTL_SEC = 60 * 60;

let scheduledTask: ScheduledTask | null = null;

export function isFeeHarvestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RECEIVER_MNEMONIC?.trim());
}

/**
 * Run one harvest attempt with Redis NX lock. Safe to call from cron or tests.
 * Never throws — errors are logged.
 */
export async function runFeeHarvestJob(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const log = getAppLogger();

  const lock = await tryAcquireRedisLock(
    FEE_HARVEST_LOCK_KEY,
    FEE_HARVEST_LOCK_TTL_SEC,
    env
  );

  if (lock === "unavailable") {
    log.warn(
      { event: "fee_harvest_cron", lock },
      "Fee harvest skipped: Redis lock unavailable (REDIS_URL required)"
    );
    return;
  }

  if (lock === "not_acquired") {
    log.info(
      { event: "fee_harvest_cron", lock },
      "Fee harvest skipped: another instance holds the lock"
    );
    return;
  }

  try {
    const result = await runFeeHarvest({ env });
    log.info(
      {
        event: "fee_harvest_cron",
        status: result.status,
        sendUsdc: result.sendUsdc,
        transfers: result.transfers.length,
        reason: result.reason
      },
      "Fee harvest job completed"
    );
  } catch (error) {
    log.error(
      {
        event: "fee_harvest_cron",
        err: error instanceof Error ? error.message : String(error)
      },
      "Fee harvest job failed"
    );
  }
}

/**
 * Start the weekly fee harvest cron when RECEIVER_MNEMONIC is set. Idempotent.
 * Returns true when a schedule was started.
 */
export function startFeeHarvestCron(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (scheduledTask) {
    return true;
  }

  if (!isFeeHarvestEnabled(env)) {
    getAppLogger().info(
      { event: "fee_harvest_cron", enabled: false },
      "Fee harvest cron not started (RECEIVER_MNEMONIC missing)"
    );
    return false;
  }

  scheduledTask = cron.schedule(
    FEE_HARVEST_CRON_EXPRESSION,
    () => {
      void runFeeHarvestJob(env);
    },
    { timezone: "UTC" }
  );

  getAppLogger().info(
    {
      event: "fee_harvest_cron",
      expression: FEE_HARVEST_CRON_EXPRESSION,
      timezone: "UTC"
    },
    "Fee harvest cron started"
  );
  return true;
}

/** Stop the cron task (shutdown). Idempotent. */
export function stopFeeHarvestCron(): void {
  if (!scheduledTask) {
    return;
  }
  scheduledTask.stop();
  scheduledTask = null;
  getAppLogger().info({ event: "fee_harvest_cron" }, "Fee harvest cron stopped");
}

/** Test helper — clear singleton schedule state. */
export function resetFeeHarvestCronForTests(): void {
  if (scheduledTask) {
    scheduledTask.stop();
  }
  scheduledTask = null;
}
