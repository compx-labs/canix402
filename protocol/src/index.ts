import { buildApp } from "./app.js";
import {
  startFeeHarvestCron,
  stopFeeHarvestCron
} from "./jobs/fee-harvest-cron.js";
import {
  startOpportunityHistoryCron,
  stopOpportunityHistoryCron
} from "./jobs/opportunity-history-cron.js";
import { closeRedisCache } from "./services/redis-cache.js";

async function main() {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down");
    stopFeeHarvestCron();
    stopOpportunityHistoryCron();
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
  startOpportunityHistoryCron();
}

main().catch(async (error) => {
  console.error(error);
  stopFeeHarvestCron();
  stopOpportunityHistoryCron();
  await closeRedisCache();
  process.exit(1);
});
