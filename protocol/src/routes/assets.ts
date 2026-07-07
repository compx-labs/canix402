import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Type } from "@sinclair/typebox";
import { FastifyInstance } from "fastify";

const faviconPng = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../public/favicon.png")
);
const faviconIco = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../public/favicon.ico")
);

export function registerAssetRoutes(app: FastifyInstance) {
  app.get(
    "/favicon.png",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => {
      return reply.type("image/png").send(faviconPng);
    }
  );

  app.get(
    "/favicon.ico",
    {
      schema: {
        response: {
          200: Type.Any()
        }
      }
    },
    async (_request, reply) => {
      return reply.type("image/png").send(faviconIco);
    }
  );
}
