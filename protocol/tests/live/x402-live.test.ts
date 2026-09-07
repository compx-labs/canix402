import assert from "node:assert/strict";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, Server } from "node:http";
import { resolve } from "node:path";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import {
  buildLivePaymentSignature,
  decodePaymentRequiredHeader,
  getAlgorandAccept,
  getLiveEnv,
  loadLiveEnvFiles,
  requireClientMnemonic,
  type LiveEnv
} from "../helpers/x402LiveClient.js";

const CADDY_BINARY = resolve(process.cwd(), ".bin/caddy-x402");

loadLiveEnvFiles();

test("live x402 preflight returns 402 + payment requirements", async () => {
  const env = getLiveEnv();
  const harness = await startLiveCaddyHarness(env);
  try {
    const response = await fetch(`${harness.caddyBaseUrl}/opportunities`);
    assert.equal(response.status, 402);

    const paymentRequiredHeader = response.headers.get("payment-required");
    assert.ok(paymentRequiredHeader);

    const paymentRequest = decodePaymentRequiredHeader(paymentRequiredHeader);
    const accepted = getAlgorandAccept(paymentRequest);

    assert.equal(typeof accepted.payTo, "string");
    assert.equal(accepted.payTo.length > 0, true);
    assert.equal(
      typeof (accepted.maxAmountRequired ?? accepted.amount) === "string",
      true
    );
    assert.equal(
      accepted.network === "algorand-mainnet" || accepted.network.startsWith("algorand:"),
      true
    );
  } finally {
    await harness.stop();
  }
});

test(
  "live x402 paid request settles via facilitator and returns data",
  async () => {
    const env = getLiveEnv();
    const clientMnemonic = requireClientMnemonic("npm run test:x402-live");

    const harness = await startLiveCaddyHarness(env);
    try {
      const paidPath = "/opportunities";
      const preflight = await fetch(`${harness.caddyBaseUrl}${paidPath}`);
      assert.equal(preflight.status, 402);

      const paymentRequiredHeader = preflight.headers.get("payment-required");
      assert.ok(paymentRequiredHeader);

      const paymentRequest = decodePaymentRequiredHeader(paymentRequiredHeader);
      const paymentSignature = await buildLivePaymentSignature({
        paymentRequest,
        requestUrl: `${harness.caddyBaseUrl}${paidPath}`,
        clientMnemonic,
        algodUrl: env.algodUrl
      });

      const paidResponse = await fetch(`${harness.caddyBaseUrl}${paidPath}`, {
        headers: {
          "PAYMENT-SIGNATURE": paymentSignature
        }
      });
      const paidBody = await paidResponse.text();

      assert.equal(
        paidResponse.status,
        200,
        `Expected paid response status 200; got ${paidResponse.status}. Body: ${paidBody.slice(0, 400)}`
      );
      assert.ok(paidResponse.headers.get("payment-response"));
    } finally {
      await harness.stop();
    }
  }
);

interface LiveCaddyHarness {
  caddyBaseUrl: string;
  stop: () => Promise<void>;
}

async function startLiveCaddyHarness(env: LiveEnv): Promise<LiveCaddyHarness> {
  if (!existsSync(CADDY_BINARY)) {
    throw new Error(
      `Caddy binary not found at ${CADDY_BINARY}. Run npm run build:caddy-x402 first.`
    );
  }

  const appServer = await startApiServer();
  const caddyPort = await getFreePort();
  const logs: string[] = [];

  const caddy = spawn(
    CADDY_BINARY,
    ["run", "--config", "caddy/Caddyfile", "--adapter", "caddyfile"],
    {
      cwd: resolve(process.cwd()),
      env: {
        ...process.env,
        CADDY_SITE_ADDRESS: `:${caddyPort}`,
        UPSTREAM_API: appServer.baseUrl,
        FACILITATOR_URL: env.facilitatorUrl,
        X402_PAY_TO: env.payTo,
        X402_PRICE_AGGREGATE_USDC: env.priceAggregateUsdc,
        X402_PRICE_SEARCH_USDC: env.priceSearchUsdc,
        X402_PRICE_PERSONALIZED_USDC: env.pricePersonalizedUsdc,
        X402_PRICE_HISTORY_USDC: env.priceHistoryUsdc,
        X402_PRICE_ELIGIBILITY_USDC: process.env.X402_PRICE_ELIGIBILITY_USDC || "0.01",
        X402_PRICE_PLANS_USDC: process.env.X402_PRICE_PLANS_USDC || "0.25",
        X402_PRICE_PLANS_REBALANCE_USDC:
          process.env.X402_PRICE_PLANS_REBALANCE_USDC || "0.25",
        X402_PRICE_POLICY_VALIDATE_USDC:
          process.env.X402_PRICE_POLICY_VALIDATE_USDC || "0.25",
        X402_PRICE_POSITIONS_USDC: process.env.X402_PRICE_POSITIONS_USDC || "0.005",
        X402_PRICE_POSITIONS_CLAIMABLE_USDC:
          process.env.X402_PRICE_POSITIONS_CLAIMABLE_USDC || "0.001",
        X402_PRICE_PROTOCOL_USDC: env.priceProtocolUsdc,
        X402_PRICE_EXECUTION_QUOTE_USDC: env.priceExecutionQuoteUsdc,
        X402_PRICE_EXECUTION_COMPOSE_USDC:
          process.env.X402_PRICE_EXECUTION_COMPOSE_USDC || "0.1",
        X402_PRICE_EXECUTION_SIMULATE_USDC:
          process.env.X402_PRICE_EXECUTION_SIMULATE_USDC || "0.1",
        X402_PRICE_HAYSTACK_SWAP_USDC: env.priceHaystackSwapUsdc,
        X402_PRICE_FOLKS_ROUTER_SWAP_USDC:
          process.env.X402_PRICE_FOLKS_ROUTER_SWAP_USDC || "0.005",
        X402_PRICE_SESSIONS_USDC: process.env.X402_PRICE_SESSIONS_USDC || "0.25",
        X402_PRICE_WATCH_USDC: process.env.X402_PRICE_WATCH_USDC || "0.25",
        X402_NETWORK: env.network,
        X402_SCHEME: env.scheme
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
    stop: async () => {
      await stopProcess(caddy);
      await appServer.close();
    }
  };
}

interface AppServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
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
