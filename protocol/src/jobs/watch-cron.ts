import cron, { type ScheduledTask } from "node-cron";

import { getAppLogger } from "../observability/logger.js";
import {
  CANIX_CACHE_KEY_PREFIX,
  tryAcquireRedisLock
} from "../services/redis-cache.js";
import { runWatchPoll } from "../services/watch-poll.js";
import { getWatchPollSeconds } from "../services/watch-store.js";

export const WATCH_LOCK_KEY = `${CANIX_CACHE_KEY_PREFIX}watch:lock`;

let scheduledTask: ScheduledTask | null = null;

export function watchCronExpression(pollSeconds: number): string {
  const seconds = Math.max(60, pollSeconds);
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes >= 60) {
    const hours = Math.max(1, Math.round(minutes / 60));
    return `0 */${hours} * * *`;
  }
  return `*/${minutes} * * * *`;
}

export async function runWatchPollJob(
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const log = getAppLogger();
  const pollSeconds = getWatchPollSeconds(env);
  const lockTtl = Math.max(60, pollSeconds);

  const lock = await tryAcquireRedisLock(WATCH_LOCK_KEY, lockTtl, env);
  if (lock === "not_acquired") {
    log.info(
      { event: "watch_poll_cron", lock },
      "Watch poll skipped: another instance holds the lock"
    );
    return;
  }

  try {
    const summary = await runWatchPoll();
    log.info({ event: "watch_poll_cron", lock, ...summary }, "Watch poll completed");
  } catch (error) {
    log.error(
      {
        event: "watch_poll_cron",
        err: error instanceof Error ? error.message : String(error)
      },
      "Watch poll job failed"
    );
  }
}

export function startWatchCron(env: NodeJS.ProcessEnv = process.env): boolean {
  if (scheduledTask) {
    return true;
  }
  if (env.X402_WATCH_CRON_DISABLED === "1") {
    getAppLogger().info(
      { event: "watch_poll_cron", enabled: false },
      "Watch poll cron not started (X402_WATCH_CRON_DISABLED=1)"
    );
    return false;
  }

  const pollSeconds = getWatchPollSeconds(env);
  const expression = watchCronExpression(pollSeconds);
  scheduledTask = cron.schedule(
    expression,
    () => {
      void runWatchPollJob(env);
    },
    { timezone: "UTC" }
  );
  getAppLogger().info(
    { event: "watch_poll_cron", expression, timezone: "UTC", pollSeconds },
    "Watch poll cron started"
  );
  return true;
}

export function stopWatchCron(): void {
  if (!scheduledTask) {
    return;
  }
  scheduledTask.stop();
  scheduledTask = null;
  getAppLogger().info({ event: "watch_poll_cron" }, "Watch poll cron stopped");
}

export function resetWatchCronForTests(): void {
  if (scheduledTask) {
    scheduledTask.stop();
  }
  scheduledTask = null;
}
