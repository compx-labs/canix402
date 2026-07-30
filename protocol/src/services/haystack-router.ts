import {
  Protocol,
  RouterClient,
  type FetchQuoteResponse,
  type Signature,
  type SwapQuote,
  type SwapTransaction
} from "@txnlab/haystack-router";
import algosdk, {
  Algodv2,
  LogicSigAccount,
  Transaction,
  isValidAddress,
  makeApplicationOptInTxnFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  msgpackRawDecode,
  signLogicSigTransactionObject,
  signTransaction
} from "algosdk";

import type {
  HaystackQuote,
  SwapOptInResponse,
  SwapQuoteRequest,
  SwapTransactionsResponse
} from "../types/swap-schema.js";
import {
  createRequestGate,
  retryRateLimited,
  type RequestGate
} from "./request-throttle.js";

const DEFAULT_HAYSTACK_API_BASE_URL = "https://hayrouter.txnlab.dev/api";
const DEFAULT_QUOTE_TTL_MS = 30_000;
const DEFAULT_OPT_IN_TTL_MS = 120_000;
/** Always excluded from Haystack routing (legacy / unmaintained venues). */
export const DEFAULT_DISABLED_HAYSTACK_PROTOCOLS = [
  "Tinyman",
  "Humble",
  "Algofi",
  "Algomint"
] as const;

export type HaystackErrorKind = "configuration" | "validation" | "rate-limit" | "upstream";

export class HaystackRouterError extends Error {
  constructor(
    message: string,
    readonly kind: HaystackErrorKind,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "HaystackRouterError";
  }
}

export interface HaystackService {
  getQuote(input: SwapQuoteRequest): Promise<HaystackQuote>;
  buildOptIns(address: string, quote: HaystackQuote): Promise<SwapOptInResponse["data"]>;
  buildSwapTransactions(
    address: string,
    quote: HaystackQuote,
    slippage: number
  ): Promise<SwapTransactionsResponse["data"]>;
}

interface HaystackServiceConfig {
  apiKey: string | undefined;
  apiBaseUrl: string;
  algodUrl: string;
  algodToken: string;
  referrerAddress: string | undefined;
  quoteTtlMs: number;
}

interface PendingOptIn {
  txn: Transaction;
  kind: "asset-opt-in" | "application-opt-in";
  assetId?: string;
  appId?: string;
}

export function createHaystackService(
  overrides: Partial<HaystackServiceConfig> = {}
): HaystackService {
  const config: HaystackServiceConfig = {
    apiKey: overrides.apiKey ?? process.env.HAYSTACK_API_KEY,
    apiBaseUrl:
      overrides.apiBaseUrl
      ?? process.env.HAYSTACK_API_BASE_URL
      ?? DEFAULT_HAYSTACK_API_BASE_URL,
    algodUrl:
      overrides.algodUrl
      ?? process.env.X402_ALGOD_URL
      ?? "https://mainnet-api.algonode.cloud",
    algodToken: overrides.algodToken ?? process.env.X402_ALGOD_TOKEN ?? "",
    referrerAddress:
      overrides.referrerAddress
      ?? process.env.HAYSTACK_REFERRER_ADDRESS
      ?? process.env.X402_PAYMENT_RECEIVER_ADDRESS,
    quoteTtlMs: overrides.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS
  };
  const gate = createRequestGate({
    concurrency: readPositiveInteger(process.env.HAYSTACK_REQUEST_CONCURRENCY, 2),
    delayMs: readNonNegativeInteger(process.env.HAYSTACK_REQUEST_DELAY_MS, 100)
  });
  const algod = new algosdk.Algodv2(
    config.algodToken,
    trimTrailingSlash(config.algodUrl),
    ""
  );

  return {
    async getQuote(input) {
      validateAddress(input.address);
      const router = createRouterClient(config);

      try {
        const response = await runHaystackRequest(gate, () =>
          router.newQuote({
            address: input.address,
            fromASAID: BigInt(input.fromAssetId),
            toASAID: BigInt(input.toAssetId),
            amount: BigInt(input.amount),
            type: input.type ?? "fixed-input",
            disabledProtocols: [
              ...new Set([
                ...DEFAULT_DISABLED_HAYSTACK_PROTOCOLS,
                ...(input.disabledProtocols ?? [])
              ])
            ] as Protocol[],
            maxGroupSize: input.maxGroupSize ?? 16,
            maxDepth: input.maxDepth ?? 3,
            // Opt-ins are prepared by the separate walletless endpoint.
            optIn: false
          })
        );

        return normalizeQuote(response, input, config.quoteTtlMs);
      } catch (error) {
        throw mapHaystackError(error, "Unable to fetch a Haystack swap quote.");
      }
    },

    async buildOptIns(address, quote) {
      validateQuoteAddress(address, quote);
      const accountInfo = await runAlgodRequest(gate, () =>
        algod.accountInformation(address).do()
      );
      const suggestedParams = await runAlgodRequest(gate, () =>
        algod.getTransactionParams().do()
      );
      const pending: PendingOptIn[] = [];
      const outputAssetId = BigInt(quote.toAssetId);

      if (
        outputAssetId !== 0n
        && !accountInfo.assets?.some((asset) => asset.assetId === outputAssetId)
      ) {
        pending.push({
          txn: makeAssetTransferTxnWithSuggestedParamsFromObject({
            sender: address,
            receiver: address,
            assetIndex: outputAssetId,
            amount: 0,
            suggestedParams
          }),
          kind: "asset-opt-in",
          assetId: outputAssetId.toString()
        });
      }

      const optedInApps = new Set(
        (accountInfo.appsLocalState ?? []).map((app) => app.id.toString())
      );
      for (const appId of quote.requiredAppOptIns) {
        if (optedInApps.has(appId)) continue;
        pending.push({
          txn: makeApplicationOptInTxnFromObject({
            sender: address,
            appIndex: BigInt(appId),
            suggestedParams
          }),
          kind: "application-opt-in",
          appId
        });
      }

      const grouped =
        pending.length > 1
          ? algosdk.assignGroupID(pending.map(({ txn }) => txn))
          : pending.map(({ txn }) => txn);
      const now = Date.now();

      return {
        required: grouped.length > 0,
        transactions: grouped.map((txn, index) => {
          const descriptor = pending[index]!;
          return {
            index,
            kind: descriptor.kind,
            encodedTransaction: encodeBase64(algosdk.encodeUnsignedTransaction(txn)),
            signer: "user" as const,
            ...(descriptor.assetId ? { assetId: descriptor.assetId } : {}),
            ...(descriptor.appId ? { appId: descriptor.appId } : {})
          };
        }),
        userSignIndexes: grouped.map((_, index) => index),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + DEFAULT_OPT_IN_TTL_MS).toISOString()
      };
    },

    async buildSwapTransactions(address, quote, slippage) {
      validateQuoteAddress(address, quote);
      validateQuoteFreshness(quote);
      if (quote.txnPayload === null) {
        throw new HaystackRouterError(
          "The quote does not contain an executable transaction payload.",
          "validation"
        );
      }
      if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100) {
        throw new HaystackRouterError(
          "Slippage must be a percentage between 0 and 100.",
          "validation"
        );
      }

      const router = createRouterClient(config);
      let response: { txns: SwapTransaction[] };
      try {
        response = await runHaystackRequest(gate, () =>
          router.fetchSwapTransactions({
            quote: denormalizeQuote(quote),
            address,
            slippage
          })
        );
      } catch (error) {
        throw mapHaystackError(
          error,
          "Unable to build Haystack swap transactions."
        );
      }

      if (response.txns.length === 0) {
        throw new HaystackRouterError(
          "Haystack returned an empty swap transaction group.",
          "upstream"
        );
      }

      const transactions = response.txns.map((swapTxn, index) =>
        prepareSwapTransaction(swapTxn, address, index)
      );

      return {
        transactions,
        userSignIndexes: transactions
          .filter(({ signer }) => signer === "user")
          .map(({ index }) => index),
        createdAt: new Date().toISOString(),
        quoteExpiresAt: quote.expiresAt
      };
    }
  };
}

function createRouterClient(config: HaystackServiceConfig): RouterClient {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new HaystackRouterError(
      "HAYSTACK_API_KEY is not configured.",
      "configuration"
    );
  }

  const referrerAddress = config.referrerAddress?.trim();
  if (referrerAddress && !isValidAddress(referrerAddress)) {
    throw new HaystackRouterError(
      "The configured Haystack referrer is not a valid Algorand address.",
      "configuration"
    );
  }

  const algodUrl = new URL(config.algodUrl);
  return new RouterClient({
    apiKey,
    apiBaseUrl: trimTrailingSlash(config.apiBaseUrl),
    algodUri: `${algodUrl.protocol}//${algodUrl.hostname}${algodUrl.pathname}`,
    algodToken: config.algodToken,
    ...(algodUrl.port ? { algodPort: Number(algodUrl.port) } : {}),
    ...(referrerAddress ? { referrerAddress } : {})
    // Intentionally omit feeBps to follow the installed SDK default.
  });
}

function normalizeQuote(
  response: SwapQuote,
  input: SwapQuoteRequest,
  quoteTtlMs: number
): HaystackQuote {
  const createdAt = response.createdAt;
  return {
    address: input.address,
    fromAssetId: BigInt(response.fromASAID).toString(),
    toAssetId: BigInt(response.toASAID).toString(),
    amount: BigInt(input.amount).toString(),
    type: input.type ?? "fixed-input",
    quotedAmount: response.quote.toString(),
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + quoteTtlMs).toISOString(),
    requiredAppOptIns: response.requiredAppOptIns.map((appId) =>
      BigInt(appId).toString()
    ),
    txnPayload: response.txnPayload,
    ...(response.usdIn === undefined ? {} : { usdIn: response.usdIn }),
    ...(response.usdOut === undefined ? {} : { usdOut: response.usdOut }),
    ...(response.userPriceImpact === undefined
      ? {}
      : { userPriceImpact: response.userPriceImpact }),
    ...(response.marketPriceImpact === undefined
      ? {}
      : { marketPriceImpact: response.marketPriceImpact }),
    ...(response.priceBaseline === undefined
      ? {}
      : { priceBaseline: response.priceBaseline }),
    route: [...response.route],
    quotes: [...response.quotes],
    protocolFees: { ...response.protocolFees }
  };
}

function denormalizeQuote(quote: HaystackQuote): FetchQuoteResponse {
  return {
    quote: quote.quotedAmount,
    profit: {
      amount: 0,
      asa: {
        id: Number(quote.toAssetId),
        decimals: 0,
        unit_name: "",
        name: "",
        price_algo: 0,
        price_usd: 0
      }
    },
    priceBaseline: quote.priceBaseline ?? 0,
    ...(quote.userPriceImpact === undefined
      ? {}
      : { userPriceImpact: quote.userPriceImpact }),
    ...(quote.marketPriceImpact === undefined
      ? {}
      : { marketPriceImpact: quote.marketPriceImpact }),
    usdIn: quote.usdIn ?? 0,
    usdOut: quote.usdOut ?? 0,
    route: quote.route as FetchQuoteResponse["route"],
    flattenedRoute: {},
    quotes: quote.quotes as FetchQuoteResponse["quotes"],
    requiredAppOptIns: quote.requiredAppOptIns.map(Number),
    txnPayload: quote.txnPayload,
    protocolFees: quote.protocolFees,
    fromASAID: Number(quote.fromAssetId),
    toASAID: Number(quote.toAssetId),
    type: quote.type
  };
}

function prepareSwapTransaction(
  swapTxn: SwapTransaction,
  address: string,
  index: number
): SwapTransactionsResponse["data"]["transactions"][number] {
  const txnBytes = decodeBase64(swapTxn.data);
  const txn = algosdk.decodeUnsignedTransaction(txnBytes);
  const legacySignedBlob = swapTxn.logicSigBlob;

  if (swapTxn.signature === false && legacySignedBlob === false) {
    if (txn.sender.toString() !== address) {
      throw new HaystackRouterError(
        `Haystack requested a user signature from an unexpected sender at index ${index}.`,
        "upstream"
      );
    }
    return {
      index,
      encodedTransaction: swapTxn.data,
      signer: "user"
    };
  }

  if (legacySignedBlob !== false && swapTxn.signature === false) {
    return {
      index,
      encodedTransaction: swapTxn.data,
      signer: "haystack",
      signedTransaction: encodeBase64(signatureBytes(legacySignedBlob))
    };
  }

  if (swapTxn.signature === false) {
    throw new HaystackRouterError(
      `Haystack omitted transaction authorization data at index ${index}.`,
      "upstream"
    );
  }

  return {
    index,
    encodedTransaction: swapTxn.data,
    signer: "haystack",
    signedTransaction: encodeBase64(signHaystackTransaction(txn, swapTxn.signature))
  };
}

function signHaystackTransaction(
  transaction: Transaction,
  signature: Signature
): Uint8Array {
  const valueBytes = signatureBytes(signature.value);
  if (signature.type === "secret_key") {
    return signTransaction(transaction, valueBytes).blob;
  }

  const decoded = msgpackRawDecode(valueBytes) as {
    lsig?: { l: Uint8Array; arg?: Uint8Array[] };
  };
  if (!decoded.lsig) {
    throw new HaystackRouterError(
      "Haystack returned a malformed logic signature.",
      "upstream"
    );
  }
  const logicSig = new LogicSigAccount(decoded.lsig.l, decoded.lsig.arg);
  return signLogicSigTransactionObject(transaction, logicSig).blob;
}

function signatureBytes(value: unknown): Uint8Array {
  if (typeof value === "string") return decodeBase64(value);
  if (value && typeof value === "object") {
    return new Uint8Array(
      Object.values(value as Record<string, number>).map((entry) => Number(entry))
    );
  }
  throw new HaystackRouterError(
    "Haystack returned an unsupported transaction signature.",
    "upstream"
  );
}

function validateQuoteAddress(address: string, quote: HaystackQuote): void {
  validateAddress(address);
  if (quote.address !== address) {
    throw new HaystackRouterError(
      "The quote was created for a different Algorand address.",
      "validation"
    );
  }
}

function validateAddress(address: string): void {
  if (!isValidAddress(address)) {
    throw new HaystackRouterError(
      "A valid Algorand address is required.",
      "validation"
    );
  }
}

function validateQuoteFreshness(quote: HaystackQuote): void {
  const expiresAt = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    throw new HaystackRouterError(
      "The Haystack quote has expired; fetch a fresh quote before building the swap.",
      "validation"
    );
  }
}

async function runAlgodRequest<T>(
  gate: RequestGate,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await retryRateLimited(() => gate.run(operation), {
      maxRetries: readNonNegativeInteger(process.env.ALGOD_429_MAX_RETRIES, 2),
      baseDelayMs: readNonNegativeInteger(
        process.env.ALGOD_429_RETRY_BASE_MS,
        250
      ),
      getStatus: extractStatus
    });
  } catch (error) {
    throw mapHaystackError(error, "Unable to read Algorand account state.");
  }
}

async function runHaystackRequest<T>(
  gate: RequestGate,
  operation: () => Promise<T>
): Promise<T> {
  return retryRateLimited(() => gate.run(operation), {
    maxRetries: readNonNegativeInteger(process.env.HAYSTACK_429_MAX_RETRIES, 2),
    baseDelayMs: readNonNegativeInteger(
      process.env.HAYSTACK_429_RETRY_BASE_MS,
      250
    ),
    getStatus: extractStatus
  });
}

function mapHaystackError(error: unknown, fallbackMessage: string): HaystackRouterError {
  if (error instanceof HaystackRouterError) return error;
  const status = extractStatus(error);
  if (status === 429) {
    return new HaystackRouterError(
      "Haystack rate limit exceeded; retry later.",
      "rate-limit"
    );
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new HaystackRouterError(
      "Haystack rejected the swap request.",
      "validation",
      { upstreamStatus: status }
    );
  }
  return new HaystackRouterError(fallbackMessage, "upstream", {
    ...(status === undefined ? {} : { upstreamStatus: status })
  });
}

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  for (const key of ["status", "statusCode", "response"]) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
    if (
      value
      && typeof value === "object"
      && typeof (value as { status?: unknown }).status === "number"
    ) {
      return (value as { status: number }).status;
    }
  }
  return undefined;
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
