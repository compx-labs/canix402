import { FastifyInstance } from "fastify";

import { registerDiscoveryRoutes } from "./discovery.js";
import { registerHealthRoutes } from "./health.js";
import { registerOpportunityRoutes } from "./opportunities.js";
import { registerProtocolRoutes } from "./protocols.js";

export function registerRoutes(app: FastifyInstance) {
  registerHealthRoutes(app);
  registerDiscoveryRoutes(app);
  registerOpportunityRoutes(app);
  registerProtocolRoutes(app);
}
