import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { loadWorkerConfig, type WorkerEnv } from "./config.js";
import { createCanixWorkerMcpServer } from "./server.js";

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const config = loadWorkerConfig(env, request.url);

    if (url.pathname === "/health") {
      return Response.json({
        data: {
          service: "canix402-mcp-worker",
          status: "ok",
          gatewayUrl: config.gatewayUrl
        }
      });
    }

    if (url.pathname === "/.well-known/mcp") {
      return Response.json({
        name: "canix402",
        transport: "streamable-http",
        url: config.publicUrl
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response("not found", { status: 404 });
    }

    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createCanixWorkerMcpServer({ config });
    await server.connect(transport);
    return transport.handleRequest(request);
  }
};
