import { FastifyInstance } from "fastify";

import { registerHealthRoutes } from "./health.js";
import { registerOpportunityRoutes } from "./opportunities.js";
import { registerProtocolRoutes } from "./protocols.js";

export function registerRoutes(app: FastifyInstance) {
  registerHealthRoutes(app);
  registerOpportunityRoutes(app);
  registerProtocolRoutes(app);
}
