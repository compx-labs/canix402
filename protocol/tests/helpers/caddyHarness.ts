import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, Server } from "node:http";
import { resolve } from "node:path";

import { buildApp } from "../../src/app.js";
import { FacilitatorMock } from "./facilitatorMock.js";

export interface CaddyHarness {
  caddyBaseUrl: string;
  stop: () => Promise<void>;
  logs: string[];
}

interface AppServerHandle {
  close: () => Promise<void>;
  baseUrl: string;
}

export async function startCaddyHarness(
  facilitator: FacilitatorMock,
  caddyBinaryPath: string
): Promise<CaddyHarness> {
  const resolvedBinary = resolve(caddyBinaryPath);
  if (!existsSync(resolvedBinary)) {
    throw new Error(
      `Caddy binary not found at ${resolvedBinary}. Run npm run build:caddy-x402 first.`
    );
  }

  const appServer = await startApiServer();
  const caddyPort = await getFreePort();
  const logs: string[] = [];
  const defaultPrice = process.env.X402_PAYMENT_AMOUNT_USDC ?? "0.01";

  const caddy = spawn(
    resolvedBinary,
    ["run", "--config", "caddy/Caddyfile", "--adapter", "caddyfile"],
    {
      cwd: resolve(process.cwd()),
      env: {
        ...process.env,
        CADDY_SITE_ADDRESS: `:${caddyPort}`,
        UPSTREAM_API: appServer.baseUrl,
        FACILITATOR_URL: facilitator.baseUrl,
        X402_PAY_TO: "REPLACE_WITH_PAYTO_ADDRESS",
        X402_PRICE_AGGREGATE_USDC: process.env.X402_PRICE_AGGREGATE_USDC ?? defaultPrice,
        X402_PRICE_SEARCH_USDC: process.env.X402_PRICE_SEARCH_USDC ?? defaultPrice,
        X402_PRICE_PERSONALIZED_USDC: process.env.X402_PRICE_PERSONALIZED_USDC ?? "0.05",
        X402_PRICE_PROTOCOL_USDC: process.env.X402_PRICE_PROTOCOL_USDC ?? defaultPrice,
        X402_PRICE_EXECUTION_QUOTE_USDC:
          process.env.X402_PRICE_EXECUTION_QUOTE_USDC ?? "0.1",
        X402_NETWORK: "algorand-mainnet",
        X402_SCHEME: "exact",
        PROOF_SHARED_SECRET: "test-proof-secret"
      }
    }
  );

  caddy.stdout.on("data", (chunk) => {
    logs.push(chunk.toString("utf-8"));
  });
  caddy.stderr.on("data", (chunk) => {
    logs.push(chunk.toString("utf-8"));
  });

  await waitForCaddyHealth(caddyPort, caddy, logs);

  return {
    caddyBaseUrl: `http://127.0.0.1:${caddyPort}`,
    logs,
    stop: async () => {
      await stopProcess(caddy);
      await appServer.close();
    }
  };
}

async function startApiServer(): Promise<AppServerHandle> {
  const app = buildApp();
  const address = await app.listen({
    port: 0,
    host: "127.0.0.1"
  });

  return {
    baseUrl: address,
    close: async () => app.close()
  };
}

async function waitForCaddyHealth(
  port: number,
  process: ChildProcessWithoutNullStreams,
  logs: string[]
): Promise<void> {
  const timeoutMs = 20_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (process.exitCode !== null) {
      throw new Error(
        `Caddy exited early with code ${process.exitCode}.\n${logs.join("")}`
      );
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for Caddy readiness.\n${logs.join("")}`);
}

async function stopProcess(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null) {
    return;
  }

  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => {
      process.once("exit", () => resolve());
    }),
    sleep(5_000).then(() => {
      if (process.exitCode === null) {
        process.kill("SIGKILL");
      }
    })
  ]);
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Unable to allocate free port.");
  }

  const port = address.port;
  await closeServer(server);
  return port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
