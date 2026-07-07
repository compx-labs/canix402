import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import algosdk from "algosdk";

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

export interface LiveEnv {
  facilitatorUrl: string;
  payTo: string;
  network: string;
  scheme: string;
  priceAggregateUsdc: string;
  priceSearchUsdc: string;
  pricePersonalizedUsdc: string;
  priceProtocolUsdc: string;
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
    algodUrl: process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud"
  };
}

export function getProductionBaseUrl(): string {
  return (
    process.env.X402_PRODUCTION_BASE_URL ?? "https://canix402-api.compx.io"
  ).replace(/\/+$/, "");
}

export function requireClientMnemonic(context = "live x402 test"): string {
  const mnemonic = process.env.X402_CLIENT_MNEMONIC;
  if (!mnemonic) {
    throw new Error(
      `X402_CLIENT_MNEMONIC is required for ${context}. Add it to .env or export it before running.`
    );
  }
  return mnemonic;
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

export async function buildLivePaymentSignature(
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
