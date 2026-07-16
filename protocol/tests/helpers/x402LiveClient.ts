import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import algosdk from "algosdk";

import { buildProductionUrl, type ProductionEndpoint } from "./productionEndpoints.js";
import type { ExecutableQuote } from "../../src/execution/types.js";

export async function buildLivePaymentSignature(
  input: BuildPaymentSignatureInput
): Promise<string> {
  return buildPaymentSignature(input);
}

export interface LiveEnv {
  facilitatorUrl: string;
  payTo: string;
  network: string;
  scheme: string;
  priceAggregateUsdc: string;
  priceSearchUsdc: string;
  pricePersonalizedUsdc: string;
  priceProtocolUsdc: string;
  priceExecutionQuoteUsdc: string;
  priceHaystackSwapUsdc: string;
  algodUrl: string;
}

export function loadLiveEnvFiles(): void {
  for (const filePath of [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "caddy/.env")
  ]) {
    loadEnvFileIfPresent(filePath);
  }
}

export function getLiveEnv(): LiveEnv {
  const payTo =
    process.env.X402_PAYMENT_RECEIVER_ADDRESS
    ?? process.env.X402_PAY_TO
    ?? "REPLACE_WITH_PAYTO_ADDRESS";

  const defaultPrice = process.env.X402_PAYMENT_AMOUNT_USDC ?? "0.01";

  return {
    facilitatorUrl:
      process.env.X402_FACILITATOR_BASE_URL ?? "https://facilitator.goplausible.xyz",
    payTo,
    network: process.env.X402_NETWORK ?? "algorand-mainnet",
    scheme: process.env.X402_SCHEME ?? "exact",
    priceAggregateUsdc: process.env.X402_PRICE_AGGREGATE_USDC ?? defaultPrice,
    priceSearchUsdc: process.env.X402_PRICE_SEARCH_USDC ?? defaultPrice,
    pricePersonalizedUsdc: process.env.X402_PRICE_PERSONALIZED_USDC ?? "0.05",
    priceProtocolUsdc: process.env.X402_PRICE_PROTOCOL_USDC ?? defaultPrice,
    priceExecutionQuoteUsdc: process.env.X402_PRICE_EXECUTION_QUOTE_USDC ?? "0.1",
    priceHaystackSwapUsdc: process.env.X402_PRICE_HAYSTACK_SWAP_USDC ?? "0.005",
    algodUrl: process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud"
  };
}

export function getProductionBaseUrl(): string {
  const configured =
    process.env.X402_PRODUCTION_BASE_URL?.trim()
    ?? process.env.CANIX402_API_URL?.trim();
  return (configured || "https://canix402-api.compx.io").replace(/\/+$/, "");
}

export function requireClientMnemonic(context = "live x402 test"): string {
  const mnemonic =
    process.env.X402_CLIENT_MNEMONIC?.trim()
    ?? process.env.CANIX402_WALLET_MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error(
      `X402_CLIENT_MNEMONIC (or CANIX402_WALLET_MNEMONIC) is required for ${context}. Add it to .env or export it before running.`
    );
  }
  return mnemonic;
}

export interface ExecutePaidRequestInput {
  baseUrl: string;
  path: string;
  clientMnemonic: string;
  algodUrl: string;
}

export interface PaidRequestResult {
  status: number;
  body: string;
  paymentResponseHeader: string | null;
}

export interface ExecutePaidJsonRequestInput {
  baseUrl: string;
  path: string;
  method?: "POST" | "PUT" | "PATCH";
  body: unknown;
  clientMnemonic: string;
  algodUrl: string;
  headers?: Record<string, string>;
}

export interface PaidJsonResult {
  status: number;
  body: unknown;
  paymentResponseHeader: string | null;
}

export interface FetchPaidExecutionQuoteInput {
  baseUrl: string;
  shapeKey: string;
  input: Record<string, unknown>;
  clientMnemonic: string;
  algodUrl: string;
}

export interface ExecutionQuoteResponse {
  data: ExecutableQuote;
  meta: {
    paymentRequired: boolean;
    executionSubmitted: boolean;
  };
}

export async function assertFreeEndpoint(
  baseUrl: string,
  endpoint: string | ProductionEndpoint
): Promise<void> {
  const path = typeof endpoint === "string" ? endpoint : endpoint.path;
  const requestUrl = buildProductionUrl(baseUrl, path);
  const method = typeof endpoint === "string" ? "GET" : endpoint.method ?? "GET";
  const serializedBody =
    typeof endpoint !== "string" && endpoint.body !== undefined
      ? JSON.stringify(endpoint.body)
      : undefined;
  const response = await fetch(requestUrl, {
    method,
    ...(serializedBody === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: serializedBody
        })
  });

  if (response.status !== 200) {
    throw new Error(`${path}: expected 200, got ${response.status}`);
  }

  if (path === "/favicon.ico" || path === "/favicon.png") {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) {
      throw new Error(`${path}: expected non-empty favicon body`);
    }
    return;
  }

  const body = (await response.json()) as Record<string, unknown>;

  if (path === "/health") {
    const data = body.data as Record<string, unknown> | undefined;
    if (data?.service !== "canix402" || data?.status !== "ok") {
      throw new Error(`${path}: unexpected health payload`);
    }
    return;
  }

  if (path === "/metadata") {
    const data = body.data as Record<string, unknown> | undefined;
    if (data?.service !== "canix402") {
      throw new Error(`${path}: unexpected metadata payload`);
    }
    return;
  }

  if (path === "/discovery") {
    const data = body.data as { endpoints?: unknown[] } | undefined;
    if (!Array.isArray(data?.endpoints) || data.endpoints.length === 0) {
      throw new Error(`${path}: discovery endpoints missing`);
    }
    return;
  }

  if (path === "/openapi.json") {
    const servers = Array.isArray(body.servers) ? body.servers : [];
    const hasBaseServer = servers.some(
      (entry) => typeof entry === "object" && entry !== null && (entry as { url?: string }).url === baseUrl
    );
    if (!hasBaseServer) {
      throw new Error(`${path}: missing server URL ${baseUrl}`);
    }
    return;
  }

  if (path === "/.well-known/x402.json") {
    if (body.openapiUrl !== `${baseUrl}/openapi.json`) {
      throw new Error(`${path}: openapiUrl mismatch`);
    }
    if (body.discoveryUrl !== `${baseUrl}/discovery`) {
      throw new Error(`${path}: discoveryUrl mismatch`);
    }
    return;
  }

  if (path === "/.well-known/x402") {
    const resources = body.resources;
    if (!Array.isArray(resources) || resources.length === 0) {
      throw new Error(`${path}: resources missing`);
    }
  }

  if (path === "/pricing") {
    const data = body.data as { prices?: unknown[] } | undefined;
    if (!Array.isArray(data?.prices)) {
      throw new Error(`${path}: prices missing`);
    }
  }
}

export async function assertPaidPreflight(
  baseUrl: string,
  path: string,
  init?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }
): Promise<PaymentRequest> {
  const requestUrl = buildProductionUrl(baseUrl, path);
  const headers: Record<string, string> = { ...(init?.headers ?? {}) };
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  }

  const response = await fetch(requestUrl, {
    method: init?.method ?? "GET",
    ...(body === undefined ? {} : { body }),
    headers
  });

  if (response.status !== 402) {
    throw new Error(`${path}: expected 402 preflight, got ${response.status}`);
  }

  const paymentRequiredHeader = response.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    throw new Error(`${path}: missing payment-required header`);
  }

  return decodePaymentRequiredHeader(paymentRequiredHeader);
}

export async function executePaidRequest(
  input: ExecutePaidRequestInput
): Promise<PaidRequestResult> {
  const requestUrl = buildProductionUrl(input.baseUrl, input.path);
  const preflight = await fetch(requestUrl);

  if (preflight.status !== 402) {
    throw new Error(
      `${input.path}: expected 402 preflight before payment, got ${preflight.status}`
    );
  }

  const paymentRequiredHeader = preflight.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    throw new Error(`${input.path}: missing payment-required header`);
  }

  const paymentRequest = decodePaymentRequiredHeader(paymentRequiredHeader);
  const paymentSignature = await buildPaymentSignature({
    paymentRequest,
    requestUrl,
    clientMnemonic: input.clientMnemonic,
    algodUrl: input.algodUrl
  });

  const paidResponse = await fetch(requestUrl, {
    headers: {
      "PAYMENT-SIGNATURE": paymentSignature
    }
  });
  const paidBody = await paidResponse.text();

  if (paidResponse.status !== 200) {
    throw new Error(
      `${input.path}: expected paid response status 200; got ${paidResponse.status}. Body: ${paidBody.slice(0, 400)}`
    );
  }

  if (!paidResponse.headers.get("payment-response")) {
    throw new Error(`${input.path}: missing payment-response header`);
  }

  const parsed = JSON.parse(paidBody) as { data?: unknown[] };
  if (!Array.isArray(parsed.data)) {
    throw new Error(`${input.path}: paid response missing data array`);
  }

  return {
    status: paidResponse.status,
    body: paidBody,
    paymentResponseHeader: paidResponse.headers.get("payment-response")
  };
}

export async function executePaidJsonRequest(
  input: ExecutePaidJsonRequestInput
): Promise<PaidJsonResult> {
  const requestUrl = buildProductionUrl(input.baseUrl, input.path);
  const method = input.method ?? "POST";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(input.headers ?? {})
  };
  const serializedBody = JSON.stringify(input.body);
  const preflight = await fetch(requestUrl, {
    method,
    headers,
    body: serializedBody
  });
  if (preflight.status !== 402) {
    throw new Error(
      `${input.path}: expected 402 preflight before payment, got ${preflight.status}`
    );
  }

  const paymentRequiredHeader = preflight.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    throw new Error(`${input.path}: missing payment-required header`);
  }

  const paymentRequest = decodePaymentRequiredHeader(paymentRequiredHeader);
  const paymentSignature = await buildPaymentSignature({
    paymentRequest,
    requestUrl,
    clientMnemonic: input.clientMnemonic,
    algodUrl: input.algodUrl
  });

  const paidResponse = await fetch(requestUrl, {
    method,
    headers: {
      ...headers,
      "PAYMENT-SIGNATURE": paymentSignature
    },
    body: serializedBody
  });
  const paidBody = await paidResponse.text();

  if (paidResponse.status !== 200) {
    throw new Error(
      `${input.path}: expected paid response status 200; got ${paidResponse.status}. Body: ${paidBody.slice(0, 400)}`
    );
  }

  if (!paidResponse.headers.get("payment-response")) {
    throw new Error(`${input.path}: missing payment-response header`);
  }

  return {
    status: paidResponse.status,
    body: JSON.parse(paidBody) as unknown,
    paymentResponseHeader: paidResponse.headers.get("payment-response")
  };
}

export async function fetchPaidExecutionQuote(
  input: FetchPaidExecutionQuoteInput
): Promise<ExecutionQuoteResponse> {
  const result = await executePaidJsonRequest({
    baseUrl: input.baseUrl,
    path: "/execution/quotes",
    method: "POST",
    body: {
      shapeKey: input.shapeKey,
      input: input.input
    },
    clientMnemonic: input.clientMnemonic,
    algodUrl: input.algodUrl
  });

  const parsed = result.body as Partial<ExecutionQuoteResponse>;
  if (typeof parsed !== "object" || parsed === null || parsed.data === undefined) {
    throw new Error("/execution/quotes: paid response missing data quote.");
  }
  if (parsed.meta?.executionSubmitted !== false) {
    throw new Error("/execution/quotes: expected meta.executionSubmitted to be false.");
  }

  return parsed as ExecutionQuoteResponse;
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

export interface PaymentRequestAccept {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amount?: string;
  maxAmountRequired?: string;
  extra?: unknown;
  [key: string]: unknown;
}

export interface PaymentRequest {
  x402Version?: number;
  accepts: PaymentRequestAccept[];
  resource?: {
    url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface BuildPaymentSignatureInput {
  paymentRequest: PaymentRequest;
  requestUrl: string;
  clientMnemonic: string;
  algodUrl: string;
}

export function decodePaymentRequiredHeader(headerValue: string): PaymentRequest {
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

export function getAlgorandAccept(paymentRequest: PaymentRequest): PaymentRequestAccept {
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

export async function buildPaymentSignature(
  input: BuildPaymentSignatureInput
): Promise<string> {
  const accepted = getAlgorandAccept(input.paymentRequest);
  const rawAmount = accepted.maxAmountRequired ?? accepted.amount;
  if (!rawAmount) {
    throw new Error("Accepted payment option is missing amount/maxAmountRequired.");
  }

  const amountMicroUsdc = BigInt(rawAmount.includes(".") ? usdcToMicro(rawAmount) : rawAmount);
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

  const normalizedAmount = rawAmount.includes(".") ? usdcToMicro(rawAmount) : rawAmount;

  const paymentSignaturePayload = {
    x402Version: input.paymentRequest.x402Version ?? 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network,
    resource: input.paymentRequest.resource ?? { url: input.requestUrl },
    accepted: {
      ...accepted,
      amount: normalizedAmount
    },
    extensions: {},
    outputSchema: null,
    payload: {
      paymentGroup: payment.paymentGroup,
      paymentIndex: payment.paymentIndex
    },
    paymentRequired: input.paymentRequest
  };

  return Buffer.from(JSON.stringify(paymentSignaturePayload), "utf-8").toString("base64");
}

function usdcToMicro(usdcAmount: string): string {
  const [wholePart = "0", fractionPart = ""] = usdcAmount.split(".");
  const paddedFraction = `${fractionPart}000000`.slice(0, 6);
  return `${BigInt(wholePart) * 1_000_000n + BigInt(paddedFraction)}`;
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
