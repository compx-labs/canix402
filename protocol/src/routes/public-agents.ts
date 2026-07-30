import type { FastifyInstance } from "fastify";

import {
  BROWNIE_BOT_AGENT_ID,
  BROWNIE_BOT_WALLET,
  PUBLIC_BROWNIE_POSITIONS_PATH
} from "../constants/public-agents.js";
import { fetchWalletPositions } from "../services/aggregate-positions.js";
import type { ApiError } from "../types/errors.js";
import type { WalletPositionsResponse } from "../types/position.js";
import { WalletPositionsResponseSchema } from "../types/position-schema.js";

export function registerPublicAgentRoutes(app: FastifyInstance): void {
  app.get<{
    Reply: WalletPositionsResponse | ApiError;
  }>(
    PUBLIC_BROWNIE_POSITIONS_PATH,
    {
      schema: {
        response: {
          200: WalletPositionsResponseSchema
        }
      }
    },
    async (_request, reply) => {
      const positions = await fetchWalletPositions(BROWNIE_BOT_WALLET);
      return reply.send({
        ...positions,
        meta: {
          ...positions.meta,
          agentId: BROWNIE_BOT_AGENT_ID
        }
      });
    }
  );
}
