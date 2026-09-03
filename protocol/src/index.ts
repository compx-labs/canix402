import { buildApp } from "./app.js";
import {
  startFeeHarvestCron,
  stopFeeHarvestCron
} from "./jobs/fee-harvest-cron.js";
import { startWatchCron, stopWatchCron } from "./jobs/watch-cron.js";
import { closeRedisCache } from "./services/redis-cache.js";

async function main() {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    stopWatchCron();
    stopFeeHarvestCron();
    try {
      await app.close();
    } finally {
      await closeRedisCache();
    }
    process.exit(0);
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  await app.listen({ port, host });
  startFeeHarvestCron();
  startWatchCron();
}

main().catch(async (error) => {
  console.error(error);
  stopWatchCron();
  stopFeeHarvestCron();
  await closeRedisCache();
  process.exit(1);
});
