import { FastifyInstance } from "fastify";

import { registerAssetRoutes } from "./assets.js";
import { registerDiscoveryRoutes } from "./discovery.js";
import { registerEligibilityRoutes } from "./eligibility.js";
import { registerExecutionRoutes } from "./execution.js";
import { registerPlanRoutes } from "./plans.js";
import { registerHealthRoutes } from "./health.js";
import { registerOpportunityRoutes } from "./opportunities.js";
import { registerPositionRoutes } from "./positions.js";
import { registerPricingRoutes } from "./pricing.js";
import { registerProtocolRoutes } from "./protocols.js";
import { registerPublicAgentRoutes } from "./public-agents.js";
import { registerSwapRoutes } from "./swaps.js";
import { registerSessionRoutes } from "./sessions.js";

export function registerRoutes(app: FastifyInstance) {
  registerAssetRoutes(app);
  registerHealthRoutes(app);
  registerDiscoveryRoutes(app);
  registerEligibilityRoutes(app);
  registerExecutionRoutes(app);
  registerPlanRoutes(app);
  registerOpportunityRoutes(app);
  registerPositionRoutes(app);
  registerPublicAgentRoutes(app);
  registerPricingRoutes(app);
  registerProtocolRoutes(app);
  registerSwapRoutes(app);
  registerSessionRoutes(app);
}
