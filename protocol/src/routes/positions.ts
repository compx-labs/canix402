import algosdk from "algosdk";
import type { FastifyInstance } from "fastify";

import { fetchWalletPositions } from "../services/aggregate-positions.js";
import type { ApiError } from "../types/errors.js";
import type { WalletPositionsResponse } from "../types/position.js";
import {
  WalletPositionsQuerySchema,
  WalletPositionsResponseSchema,
  type WalletPositionsQuery
} from "../types/position-schema.js";

export function registerPositionRoutes(app: FastifyInstance): void {
  app.get<{
    Querystring: WalletPositionsQuery;
    Reply: WalletPositionsResponse | ApiError;
  }>(
    "/positions",
    {
      schema: {
        querystring: WalletPositionsQuerySchema,
        response: {
          200: WalletPositionsResponseSchema
        }
      }
    },
    async (request, reply) => {
      const { address } = request.query;
      if (!algosdk.isValidAddress(address)) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Query parameter 'address' is not a valid Algorand address."
          }
        });
      }

      return reply.send(await fetchWalletPositions(address));
    }
  );
}
