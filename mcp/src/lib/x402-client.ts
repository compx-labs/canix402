import algosdk from "algosdk";

import type { McpConfig } from "./config.js";
import { hasWallet } from "./config.js";

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

export interface PaidCallResult {
  status: number;
  body: unknown;
  paymentResponseHeader: string | null;
  paymentRequired: PaymentRequest | null;
}

export class WalletRequiredError extends Error {
  readonly paymentRequired: PaymentRequest | null;
  readonly estimatedPriceUsdc: string | undefined;

  constructor(
    message: string,
    paymentRequired: PaymentRequest | null = null,
    estimatedPriceUsdc?: string
  ) {
    super(message);
    this.name = "WalletRequiredError";
    this.paymentRequired = paymentRequired;
    this.estimatedPriceUsdc = estimatedPriceUsdc;
  }
}

export class X402ClientError extends Error {
  readonly status: number | undefined;
  readonly bodySnippet: string | undefined;

  constructor(message: string, status?: number, bodySnippet?: string) {
    super(message);
    this.name = "X402ClientError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export type FetchFn = typeof fetch;

export class X402Client {
  constructor(
    private readonly config: McpConfig,
    private readonly fetchImpl: FetchFn = fetch
  ) {}

  buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path.startsWith("/") ? path : `/${path}`, `${this.config.apiUrl}/`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async fetchFree(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<unknown> {
    const requestUrl = this.buildUrl(path, query);
    const response = await this.fetchImpl(requestUrl);
    const bodyText = await response.text();

    if (response.status !== 200) {
      throw new X402ClientError(
        `${path}: expected 200, got ${response.status}`,
        response.status,
        bodyText.slice(0, 400)
      );
    }

    return bodyText.length === 0 ? null : (JSON.parse(bodyText) as unknown);
  }

  async fetchPaid(
    path: string,
    options?: {
      method?: "GET" | "POST" | "PUT" | "PATCH";
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      headers?: Record<string, string>;
      estimatedPriceUsdc?: string;
    }
  ): Promise<PaidCallResult> {
    const method = options?.method ?? (options?.body === undefined ? "GET" : "POST");
    const requestUrl = this.buildUrl(path, options?.query);
    const headers: Record<string, string> = { ...(options?.headers ?? {}) };
    let serializedBody: string | undefined;

    if (options?.body !== undefined) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      serializedBody =
        typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    const preflight = await this.fetchImpl(requestUrl, {
      method,
      headers,
      ...(serializedBody === undefined ? {} : { body: serializedBody })
    });

    if (preflight.status === 200) {
      const bodyText = await preflight.text();
      return {
        status: 200,
        body: bodyText.length === 0 ? null : (JSON.parse(bodyText) as unknown),
        paymentResponseHeader: preflight.headers.get("payment-response"),
        paymentRequired: null
      };
    }

    if (preflight.status !== 402) {
      const bodyText = await preflight.text();
      throw new X402ClientError(
        `${path}: expected 402 preflight or 200, got ${preflight.status}`,
        preflight.status,
        bodyText.slice(0, 400)
      );
    }

    const paymentRequiredHeader = preflight.headers.get("payment-required");
    if (!paymentRequiredHeader) {
      throw new X402ClientError(`${path}: missing PAYMENT-REQUIRED header`, 402);
    }

    const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);

    if (!hasWallet(this.config) || !this.config.walletMnemonic) {
      const accepted = tryGetAlgorandAccept(paymentRequired);
      const amount = accepted
        ? microUsdcToUsdc(accepted.maxAmountRequired ?? accepted.amount)
        : options?.estimatedPriceUsdc;

      throw new WalletRequiredError(
        [
          `Paid endpoint ${path} requires x402 payment.`,
          `Set CANIX402_WALLET_MNEMONIC (or X402_CLIENT_MNEMONIC) to enable automatic payment.`,
          amount ? `Estimated price: ${amount} USDC.` : undefined,
          "Wallet must hold ALGO for fees and be opted into USDC."
        ]
          .filter(Boolean)
          .join(" "),
        paymentRequired,
        amount
      );
    }

    const paymentSignature = await buildPaymentSignature({
      paymentRequest: paymentRequired,
      requestUrl,
      clientMnemonic: this.config.walletMnemonic,
      algodUrl: this.config.algodUrl
    });

    const paidResponse = await this.fetchImpl(requestUrl, {
      method,
      headers: {
        ...headers,
        "PAYMENT-SIGNATURE": paymentSignature
      },
      ...(serializedBody === undefined ? {} : { body: serializedBody })
    });
    const paidBody = await paidResponse.text();

    if (paidResponse.status !== 200) {
      throw new X402ClientError(
        `${path}: expected paid response status 200; got ${paidResponse.status}`,
        paidResponse.status,
        paidBody.slice(0, 400)
      );
    }

    return {
      status: paidResponse.status,
      body: paidBody.length === 0 ? null : (JSON.parse(paidBody) as unknown),
      paymentResponseHeader: paidResponse.headers.get("payment-response"),
      paymentRequired
    };
  }
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
  const accepted = tryGetAlgorandAccept(paymentRequest);
  if (!accepted) {
    throw new Error(
      `PAYMENT-REQUIRED does not contain an Algorand accept option. Networks: ${paymentRequest.accepts
        .map((accept) => accept.network)
        .join(", ")}`
    );
  }
  return accepted;
}

function tryGetAlgorandAccept(paymentRequest: PaymentRequest): PaymentRequestAccept | undefined {
  return paymentRequest.accepts.find((accept) => {
    const network = accept.network.toLowerCase();
    return network === "algorand-mainnet" || network.startsWith("algorand:");
  });
}

export function microUsdcToUsdc(rawAmount: string | undefined): string | undefined {
  if (!rawAmount) {
    return undefined;
  }
  if (rawAmount.includes(".")) {
    return rawAmount;
  }
  try {
    const micro = BigInt(rawAmount);
    const whole = micro / 1_000_000n;
    const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  } catch {
    return rawAmount;
  }
}

interface BuildPaymentSignatureInput {
  paymentRequest: PaymentRequest;
  requestUrl: string;
  clientMnemonic: string;
  algodUrl: string;
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

  const paymentSignaturePayload = {
    x402Version: input.paymentRequest.x402Version ?? 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network,
    resource: input.paymentRequest.resource ?? { url: input.requestUrl },
    accepted: {
      ...accepted,
      amount: rawAmount.includes(".") ? usdcToMicro(rawAmount) : rawAmount
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
