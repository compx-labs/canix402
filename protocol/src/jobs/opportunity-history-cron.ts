import cron, { type ScheduledTask } from "node-cron";

import { getAppLogger } from "../observability/logger.js";
import {
  fetchOpportunitiesResult,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "../services/aggregate-opportunities.js";
import {
  historySnapshotsFromOpportunities,
  recordOpportunitySnapshots
} from "../services/opportunity-history.js";
import {
  CANIX_CACHE_KEY_PREFIX,
  tryAcquireRedisLock
} from "../services/redis-cache.js";

/** Hourly at minute 17 UTC — cheap, not a warehouse backfill. */
export const OPPORTUNITY_HISTORY_CRON_EXPRESSION = "17 * * * *";

export const OPPORTUNITY_HISTORY_LOCK_KEY = `${CANIX_CACHE_KEY_PREFIX}history:lock`;

/** Lock TTL — long enough for one aggregate pass, short enough to recover. */
export const OPPORTUNITY_HISTORY_LOCK_TTL_SEC = 10 * 60;

let scheduledTask: ScheduledTask | null = null;

export function isOpportunityHistoryCronEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.OPPORTUNITY_HISTORY_DISABLED === "1") {
    return false;
  }
  return Boolean(env.REDIS_URL?.trim());
}

/**
 * Snapshot current opportunity APY/TVL into the rolling ~30d Redis series.
 * Safe to call from cron or tests. Never throws.
 */
export async function runOpportunityHistoryJob(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const log = getAppLogger();

  if (env.OPPORTUNITY_HISTORY_DISABLED === "1") {
    return;
  }

  const lock = await tryAcquireRedisLock(
    OPPORTUNITY_HISTORY_LOCK_KEY,
    OPPORTUNITY_HISTORY_LOCK_TTL_SEC,
    env
  );

  if (lock === "unavailable") {
    log.warn(
      { event: "opportunity_history_cron", lock },
      "Opportunity history snapshot skipped: Redis lock unavailable"
    );
    return;
  }

  if (lock === "not_acquired") {
    log.info(
      { event: "opportunity_history_cron", lock },
      "Opportunity history snapshot skipped: another instance holds the lock"
    );
    return;
  }

  try {
    const { data } = await fetchOpportunitiesResult(SUPPORTED_AGGREGATE_PROTOCOLS);
    const written = await recordOpportunitySnapshots(
      historySnapshotsFromOpportunities(data)
    );
    log.info(
      {
        event: "opportunity_history_cron",
        opportunities: data.length,
        written
      },
      "Opportunity history snapshot job completed"
    );
  } catch (error) {
    log.error(
      {
        event: "opportunity_history_cron",
        err: error instanceof Error ? error.message : String(error)
      },
      "Opportunity history snapshot job failed"
    );
  }
}

export function startOpportunityHistoryCron(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (scheduledTask) {
    return true;
  }

  if (!isOpportunityHistoryCronEnabled(env)) {
    getAppLogger().info(
      { event: "opportunity_history_cron", enabled: false },
      "Opportunity history cron not started (REDIS_URL missing or OPPORTUNITY_HISTORY_DISABLED=1)"
    );
    return false;
  }

  scheduledTask = cron.schedule(
    OPPORTUNITY_HISTORY_CRON_EXPRESSION,
    () => {
      void runOpportunityHistoryJob(env);
    },
    { timezone: "UTC" }
  );

  getAppLogger().info(
    {
      event: "opportunity_history_cron",
      expression: OPPORTUNITY_HISTORY_CRON_EXPRESSION,
      timezone: "UTC"
    },
    "Opportunity history cron started"
  );
  return true;
}

export function stopOpportunityHistoryCron(): void {
  if (!scheduledTask) {
    return;
  }
  scheduledTask.stop();
  scheduledTask = null;
  getAppLogger().info(
    { event: "opportunity_history_cron" },
    "Opportunity history cron stopped"
  );
}

export function resetOpportunityHistoryCronForTests(): void {
  if (scheduledTask) {
    scheduledTask.stop();
  }
  scheduledTask = null;
}
