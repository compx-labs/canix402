import { FastifyInstance } from "fastify";

import { registerAssetRoutes } from "./assets.js";
import { registerDiscoveryRoutes } from "./discovery.js";
import { registerExecutionRoutes } from "./execution.js";
import { registerHealthRoutes } from "./health.js";
import { registerOpportunityRoutes } from "./opportunities.js";
import { registerPositionRoutes } from "./positions.js";
import { registerPricingRoutes } from "./pricing.js";
import { registerProtocolRoutes } from "./protocols.js";
import { registerSwapRoutes } from "./swaps.js";

export function registerRoutes(app: FastifyInstance) {
  registerAssetRoutes(app);
  registerHealthRoutes(app);
  registerDiscoveryRoutes(app);
  registerExecutionRoutes(app);
  registerOpportunityRoutes(app);
  registerPositionRoutes(app);
  registerPricingRoutes(app);
  registerProtocolRoutes(app);
  registerSwapRoutes(app);
}
