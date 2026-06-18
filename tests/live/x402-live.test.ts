import assert from "node:assert/strict";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer, Server } from "node:http";
import { resolve } from "node:path";
import test from "node:test";

import algosdk from "algosdk";

import { buildApp } from "../../src/app.js";

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
    const clientMnemonic = requireClientMnemonic();

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

interface LiveEnv {
  facilitatorUrl: string;
  payTo: string;
  network: string;
  scheme: string;
  priceUsdc: string;
  algodUrl: string;
}

function getLiveEnv(): LiveEnv {
  const payTo =
    process.env.X402_PAYMENT_RECEIVER_ADDRESS
    ?? process.env.X402_PAY_TO
    ?? "REPLACE_WITH_PAYTO_ADDRESS";

  const configuredPrice = process.env.X402_PRICE_USDC ?? process.env.X402_PAYMENT_AMOUNT_USDC;

  return {
    facilitatorUrl:
      process.env.X402_FACILITATOR_BASE_URL ?? "https://facilitator.goplausible.xyz",
    payTo,
    network: process.env.X402_NETWORK ?? "algorand-mainnet",
    scheme: process.env.X402_SCHEME ?? "exact",
    priceUsdc: configuredPrice && configuredPrice.length > 0 ? configuredPrice : "0.01",
    algodUrl: process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud"
  };
}

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
        CADDY_LISTEN_PORT: String(caddyPort),
        UPSTREAM_API: appServer.baseUrl,
        FACILITATOR_URL: env.facilitatorUrl,
        X402_PAY_TO: env.payTo,
        X402_PRICE_USDC: env.priceUsdc,
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

interface PaymentRequestAccept {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount?: string;
  maxAmountRequired?: string;
  [key: string]: unknown;
}

interface PaymentRequest {
  x402Version?: number;
  accepts: PaymentRequestAccept[];
  resource?: {
    url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function decodePaymentRequiredHeader(headerValue: string): PaymentRequest {
  const decoded = Buffer.from(headerValue, "base64").toString("utf-8");
  const parsed = JSON.parse(decoded) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("PAYMENT-REQUIRED payload is not a JSON object.");
  }

  const candidate = parsed as Partial<PaymentRequest>;
  if (!Array.isArray(candidate.accepts) || candidate.accepts.length === 0) {
    throw new Error("PAYMENT-REQUIRED payload is missing accepts.");
  }

  return candidate as PaymentRequest;
}

function getAlgorandAccept(paymentRequest: PaymentRequest): PaymentRequestAccept {
  const accepted = paymentRequest.accepts.find((accept) => {
    const network = accept.network.toLowerCase();
    return network === "algorand-mainnet" || network.startsWith("algorand:");
  });

  if (!accepted) {
    throw new Error(
      `PAYMENT-REQUIRED does not contain an Algorand accept option. Networks: ${paymentRequest.accepts
        .map((accept) => accept.network)
        .join(", ")}`
    );
  }

  return accepted;
}

interface BuildPaymentSignatureInput {
  paymentRequest: PaymentRequest;
  requestUrl: string;
  clientMnemonic: string;
  algodUrl: string;
}

async function buildLivePaymentSignature(
  input: BuildPaymentSignatureInput
): Promise<string> {
  const accepted = getAlgorandAccept(input.paymentRequest);
  const rawAmount = accepted.maxAmountRequired ?? accepted.amount;
  if (!rawAmount) {
    throw new Error("Accepted payment option is missing amount/maxAmountRequired.");
  }

  const amountMicroUsdc = BigInt(rawAmount);

  const account = algosdk.mnemonicToSecretKey(input.clientMnemonic);
  const algod = new algosdk.Algodv2("", input.algodUrl, "");
  const suggested = await algod.getTransactionParams().do();
  const feePayer = getFeePayer(accepted);

  const payment = feePayer
    ? buildFeePayerPayment({
        account,
        accepted,
        amountMicroUsdc,
        suggested,
        feePayer
      })
    : buildDirectPayment({
        account,
        accepted,
        amountMicroUsdc,
        suggested
      });

  const paymentSignaturePayload = {
    x402Version: input.paymentRequest.x402Version ?? 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network,
    resource: input.paymentRequest.resource ?? { url: input.requestUrl },
    accepted: {
      ...accepted,
      amount: rawAmount
    },
    extensions: {},
    outputSchema: null,
    payload: {
      paymentGroup: payment.paymentGroup,
      paymentIndex: payment.paymentIndex
    },
    paymentRequired: input.paymentRequest
  };

  return Buffer.from(JSON.stringify(paymentSignaturePayload), "utf-8").toString(
    "base64"
  );
}

interface PaymentBuildInput {
  account: algosdk.Account;
  accepted: PaymentRequestAccept;
  amountMicroUsdc: bigint;
  suggested: algosdk.SuggestedParams;
}

interface BuiltPayment {
  paymentGroup: string[];
  paymentIndex: number;
}

function buildDirectPayment(input: PaymentBuildInput): BuiltPayment {
  const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: input.account.addr,
    receiver: input.accepted.payTo,
    amount: input.amountMicroUsdc,
    assetIndex: BigInt(input.accepted.asset),
    suggestedParams: {
      ...input.suggested,
      flatFee: true,
      fee: 1_000
    },
    note: new TextEncoder().encode("x402-payment-v2")
  });

  const signed = algosdk.signTransaction(transfer, input.account.sk);
  return {
    paymentGroup: [Buffer.from(signed.blob).toString("base64")],
    paymentIndex: 0
  };
}

function buildFeePayerPayment(
  input: PaymentBuildInput & { feePayer: string }
): BuiltPayment {
  const feePayerTxn = new algosdk.Transaction({
    type: algosdk.TransactionType.pay,
    sender: input.feePayer,
    suggestedParams: {
      ...input.suggested,
      flatFee: true,
      fee: 2_000
    },
    paymentParams: {
      receiver: input.feePayer,
      amount: 0
    },
    note: new TextEncoder().encode("x402-fee-payer")
  });

  const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: input.account.addr,
    receiver: input.accepted.payTo,
    amount: input.amountMicroUsdc,
    assetIndex: BigInt(input.accepted.asset),
    suggestedParams: {
      ...input.suggested,
      flatFee: true,
      fee: 0
    },
    note: new TextEncoder().encode("x402-payment-v2")
  });

  algosdk.assignGroupID([feePayerTxn, transfer]);

  const feePayerBytes = algosdk.encodeUnsignedTransaction(feePayerTxn);
  const signedTransfer = algosdk.signTransaction(transfer, input.account.sk);

  return {
    paymentGroup: [
      Buffer.from(feePayerBytes).toString("base64"),
      Buffer.from(signedTransfer.blob).toString("base64")
    ],
    paymentIndex: 1
  };
}

function getFeePayer(accepted: PaymentRequestAccept): string | undefined {
  const extra = accepted.extra;
  if (typeof extra !== "object" || extra === null) {
    return undefined;
  }

  const feePayer = (extra as { feePayer?: unknown }).feePayer;
  return typeof feePayer === "string" && feePayer.length > 0 ? feePayer : undefined;
}

function requireClientMnemonic(): string {
  const mnemonic = process.env.X402_CLIENT_MNEMONIC;
  if (!mnemonic) {
    throw new Error(
      "X402_CLIENT_MNEMONIC is required for npm run test:x402-live. Add it to .env or export it before running the live paid test."
    );
  }
  return mnemonic;
}

function loadLiveEnvFiles(): void {
  for (const filePath of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "caddy/.env")]) {
    loadEnvFileIfPresent(filePath);
  }
}

function loadEnvFileIfPresent(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf-8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().replace(/^export\s+/, "");
    const value = stripOptionalQuotes(line.slice(separatorIndex + 1).trim());
    process.env[key] ??= value;
  }
}

function stripOptionalQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
