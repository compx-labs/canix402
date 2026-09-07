import {
  FolksRouterClient,
  MainnetFolksRouterAppId,
  Network,
  SwapMode,
  TestnetFolksRouterAppId,
  type SwapParams,
  type SwapQuote
} from "@folks-router/js-sdk";
import algosdk, {
  isValidAddress,
  makeApplicationOptInTxnFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject
} from "algosdk";

import type {
  FolksSwapQuote,
  FolksSwapQuoteRequest,
  FolksSwapTransactionsResponse,
  SwapOptInResponse
} from "../types/swap-schema.js";
import {
  createRequestGate,
  retryRateLimited,
  type RequestGate
} from "./request-throttle.js";

export const FOLKS_ROUTER_V2_MAINNET_API_BASE = "https://api.folksrouter.io/v2";
export const FOLKS_ROUTER_V2_TESTNET_API_BASE = "https://api.folksrouter.io/testnet/v2";
export const FOLKS_ROUTER_V1_MAINNET_API_BASE = "https://api.folksrouter.io";
export const FOLKS_ROUTER_V1_TESTNET_API_BASE = "https://api.folksrouter.io/testnet";

export const FOLKS_ROUTER_MAINNET_APP_ID = MainnetFolksRouterAppId;
export const FOLKS_ROUTER_TESTNET_APP_ID = TestnetFolksRouterAppId;

/** Default Folks Router output fee before FOLKS-holdings discounts (0.1%). */
export const FOLKS_ROUTER_DEFAULT_FEE_BPS = 10;

export const DEFAULT_FOLKS_QUOTE_TTL_MS = 30_000;
const DEFAULT_OPT_IN_TTL_MS = 120_000;

/**
 * FOLKS holdings tiers that discount the 0.1% Folks Router fee.
 * `userFeeDiscount` is the percent off that fee (0–50), not a second fee.
 */
export const FOLKS_ROUTER_FEE_DISCOUNT_TIERS = [
  { minFolks: 0, maxFolksExclusive: 15, discountPercent: 0 },
  { minFolks: 15, maxFolksExclusive: 325, discountPercent: 10 },
  { minFolks: 325, maxFolksExclusive: 1000, discountPercent: 20 },
  { minFolks: 1000, maxFolksExclusive: 5000, discountPercent: 30 },
  { minFolks: 5000, maxFolksExclusive: 12_500, discountPercent: 40 },
  { minFolks: 12_500, discountPercent: 50 }
] as const;

export type FolksRouterErrorKind =
  | "configuration"
  | "validation"
  | "rate-limit"
  | "upstream";

export class FolksRouterError extends Error {
  constructor(
    message: string,
    readonly kind: FolksRouterErrorKind,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "FolksRouterError";
  }
}

export interface FolksRouterSdk {
  fetchUserDiscount(userAddress: string): Promise<number>;
  fetchSwapQuote(
    params: SwapParams,
    maxGroupSize?: number,
    feeBps?: number | bigint,
    userFeeDiscount?: number | bigint,
    referrer?: string
  ): Promise<SwapQuote>;
  prepareSwapTransactions(
    params: SwapParams,
    userAddress: string,
    slippageBps: number | bigint,
    swapQuote: SwapQuote
  ): Promise<string[]>;
}

export interface FolksRouterAlgod {
  accountInformation(address: string): { do(): Promise<{
    assets?: Array<{ assetId: bigint | number }>;
    appsLocalState?: Array<{ id: bigint | number }>;
  }> };
  getTransactionParams(): { do(): Promise<algosdk.SuggestedParams> };
}

export interface FolksRouterService {
  getQuote(input: FolksSwapQuoteRequest): Promise<FolksSwapQuote>;
  buildOptIns(address: string, quote: FolksSwapQuote): Promise<SwapOptInResponse["data"]>;
  buildSwapTransactions(
    address: string,
    quote: FolksSwapQuote,
    slippage: number
  ): Promise<FolksSwapTransactionsResponse["data"]>;
}

export interface FolksRouterServiceConfig {
  network: Network;
  apiKey: string | undefined;
  apiBaseUrl: string | undefined;
  algodUrl: string;
  algodToken: string;
  referrerAddress: string | undefined;
  quoteTtlMs: number;
}

interface FolksRouterServiceOverrides extends Partial<FolksRouterServiceConfig> {
  client?: FolksRouterSdk;
  createClient?: (network: Network, apiKey?: string) => FolksRouterSdk;
  algod?: FolksRouterAlgod;
  now?: () => number;
}

interface PendingOptIn {
  txn: algosdk.Transaction;
  kind: "asset-opt-in" | "application-opt-in";
  assetId?: string;
  appId?: string;
}

export function folksRouterAppId(network: Network): number {
  return network === Network.TESTNET
    ? FOLKS_ROUTER_TESTNET_APP_ID
    : FOLKS_ROUTER_MAINNET_APP_ID;
}

export function folksRouterV2ApiBase(network: Network): string {
  return network === Network.TESTNET
    ? FOLKS_ROUTER_V2_TESTNET_API_BASE
    : FOLKS_ROUTER_V2_MAINNET_API_BASE;
}

export function assertFolksRouterV2BaseUrl(url: string): void {
  const normalized = trimTrailingSlash(url.trim().toLowerCase());
  if (normalized.length === 0) {
    throw new FolksRouterError(
      "Folks Router API base URL is empty.",
      "configuration"
    );
  }
  if (!normalized.includes("/v2")) {
    throw new FolksRouterError(
      "Folks Router V1 base URLs are not supported after the December 2025 cutoff. Use https://api.folksrouter.io/v2/ (mainnet) or https://api.folksrouter.io/testnet/v2/.",
      "configuration",
      { apiBaseUrl: url }
    );
  }
}

export function percentSlippageToFolksBps(slippagePercent: number): number {
  return Math.round(slippagePercent * 100);
}

export function inferFolksRouteKind(groupSize: number): {
  routeKind: "direct" | "multi-hop";
  hopCount: number;
} {
  const hopCount = Math.max(1, groupSize - 2);
  return {
    hopCount,
    routeKind: hopCount > 1 ? "multi-hop" : "direct"
  };
}

export function createFolksRouterService(
  overrides: FolksRouterServiceOverrides = {}
): FolksRouterService {
  const network = resolveNetwork(overrides.network ?? process.env.FOLKS_ROUTER_NETWORK);
  const apiBaseUrl =
    overrides.apiBaseUrl
    ?? process.env.FOLKS_ROUTER_API_BASE_URL
    ?? folksRouterV2ApiBase(network);
  assertFolksRouterV2BaseUrl(apiBaseUrl);

  // FolksRouterClient(network, apiKey) selects the V2 host from Network.
  // apiBaseUrl is a V1-misconfig guard only; the SDK does not accept a base URL.

  const config: FolksRouterServiceConfig = {
    network,
    apiKey: overrides.apiKey ?? process.env.FOLKS_ROUTER_API_KEY,
    apiBaseUrl,
    algodUrl:
      overrides.algodUrl
      ?? process.env.X402_ALGOD_URL
      ?? "https://mainnet-api.algonode.cloud", // pragma: allowlist secret
    algodToken: overrides.algodToken ?? process.env.X402_ALGOD_TOKEN ?? "",
    referrerAddress:
      overrides.referrerAddress
      ?? process.env.FOLKS_ROUTER_REFERRER_ADDRESS
      ?? process.env.X402_PAYMENT_RECEIVER_ADDRESS,
    quoteTtlMs: overrides.quoteTtlMs ?? DEFAULT_FOLKS_QUOTE_TTL_MS
  };

  const gate = createRequestGate({
    concurrency: readPositiveInteger(process.env.FOLKS_ROUTER_REQUEST_CONCURRENCY, 2),
    delayMs: readNonNegativeInteger(process.env.FOLKS_ROUTER_REQUEST_DELAY_MS, 100)
  });
  const algod: FolksRouterAlgod =
    overrides.algod
    ?? new algosdk.Algodv2(
      config.algodToken,
      trimTrailingSlash(config.algodUrl),
      ""
    );
  const now = overrides.now ?? Date.now;
  const routerAppId = folksRouterAppId(config.network).toString();
  const client = resolveClient(config, overrides);

  return {
    async getQuote(input) {
      const address = input.address?.trim();
      if (address) validateAddress(address);

      const params = toSwapParams(input);
      const discount = await resolveDiscount(client, gate, address);

      try {
        const response = await runFolksRequest(gate, () =>
          client.fetchSwapQuote(
            params,
            input.maxGroupSize,
            undefined,
            discount.applied ? discount.userFeeDiscount : undefined,
            config.referrerAddress?.trim() || undefined
          )
        );
        return normalizeQuote(response, input, {
          routerAppId,
          quoteTtlMs: config.quoteTtlMs,
          discount,
          now: now()
        });
      } catch (error) {
        throw mapFolksError(error, "Unable to fetch a Folks Router V2 swap quote.");
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
        && !accountInfo.assets?.some((asset) => BigInt(asset.assetId) === outputAssetId)
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
        (accountInfo.appsLocalState ?? []).map((app) => BigInt(app.id).toString())
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
      const createdAt = now();

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
        createdAt: new Date(createdAt).toISOString(),
        expiresAt: new Date(createdAt + DEFAULT_OPT_IN_TTL_MS).toISOString()
      };
    },

    async buildSwapTransactions(address, quote, slippage) {
      validateQuoteAddress(address, quote);
      validateQuoteFreshness(quote, now());
      if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100) {
        throw new FolksRouterError(
          "Slippage must be a percentage between 0 and 100.",
          "validation"
        );
      }
      if (quote.source !== "folks-router" || quote.apiVersion !== "v2") {
        throw new FolksRouterError(
          "The quote is not a Folks Router V2 quote.",
          "validation"
        );
      }
      if (quote.routerAppId !== routerAppId) {
        throw new FolksRouterError(
          "The quote was created for a different Folks Router application.",
          "validation"
        );
      }

      const params = toSwapParams({
        fromAssetId: quote.fromAssetId,
        toAssetId: quote.toAssetId,
        amount: quote.amount,
        type: quote.type
      });
      const swapQuote: SwapQuote = {
        quoteAmount: BigInt(quote.quotedAmount),
        priceImpact: quote.priceImpact,
        microalgoTxnsFee: quote.microalgoTxnsFee,
        txnPayload: quote.txnPayload
      };

      let encodedTransactions: string[];
      try {
        encodedTransactions = await runFolksRequest(gate, () =>
          client.prepareSwapTransactions(
            params,
            address,
            percentSlippageToFolksBps(slippage),
            swapQuote
          )
        );
      } catch (error) {
        throw mapFolksError(
          error,
          "Unable to prepare Folks Router V2 swap transactions."
        );
      }

      if (encodedTransactions.length === 0) {
        throw new FolksRouterError(
          "Folks Router returned an empty swap transaction group.",
          "upstream"
        );
      }

      const { routeKind, hopCount } = inferFolksRouteKind(encodedTransactions.length);
      const transactions = encodedTransactions.map((encodedTransaction, index) => {
        if (typeof encodedTransaction !== "string" || encodedTransaction.length === 0) {
          throw new FolksRouterError(
            `Folks Router omitted unsigned transaction bytes at index ${index}.`,
            "upstream"
          );
        }
        return {
          index,
          encodedTransaction,
          signer: "user" as const
        };
      });

      return {
        source: "folks-router",
        apiVersion: "v2",
        routerAppId,
        routeKind,
        hopCount,
        transactions,
        userSignIndexes: transactions.map(({ index }) => index),
        createdAt: new Date(now()).toISOString(),
        quoteExpiresAt: quote.expiresAt
      };
    }
  };
}

function resolveClient(
  config: FolksRouterServiceConfig,
  overrides: FolksRouterServiceOverrides
): FolksRouterSdk {
  if (overrides.client) return overrides.client;
  const apiKey = config.apiKey?.trim() || undefined;
  if (overrides.createClient) {
    return overrides.createClient(config.network, apiKey);
  }
  return new FolksRouterClient(config.network, apiKey);
}

function resolveNetwork(value: Network | string | undefined): Network {
  if (value === Network.TESTNET || value === "testnet") return Network.TESTNET;
  return Network.MAINNET;
}

function toSwapParams(input: {
  fromAssetId: number | string;
  toAssetId: number | string;
  amount: number | string;
  type?: "fixed-input" | "fixed-output";
}): SwapParams {
  return {
    fromAssetId: Number(input.fromAssetId),
    toAssetId: Number(input.toAssetId),
    amount: BigInt(input.amount),
    swapMode: input.type === "fixed-output" ? SwapMode.FIXED_OUTPUT : SwapMode.FIXED_INPUT
  };
}

async function resolveDiscount(
  client: FolksRouterSdk,
  gate: RequestGate,
  address: string | undefined
): Promise<FolksSwapQuote["discount"]> {
  const tiers = FOLKS_ROUTER_FEE_DISCOUNT_TIERS.map((tier) => ({
    minFolks: tier.minFolks,
    discountPercent: tier.discountPercent,
    ...("maxFolksExclusive" in tier ? { maxFolksExclusive: tier.maxFolksExclusive } : {})
  }));

  if (!address) {
    return {
      sender: null,
      userFeeDiscount: 0,
      applied: false,
      tiers
    };
  }

  try {
    const raw = await runFolksRequest(gate, () => client.fetchUserDiscount(address));
    const userFeeDiscount = normalizeDiscountPercent(raw);
    return {
      sender: address,
      userFeeDiscount,
      applied: true,
      tiers
    };
  } catch {
    // Discount is optional. Quote at the list-price 0.1% fee so a discount
    // outage cannot block a Folks quote in a multi-router compare.
    return {
      sender: address,
      userFeeDiscount: 0,
      applied: false,
      tiers
    };
  }
}

function normalizeDiscountPercent(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 50) {
    throw new FolksRouterError(
      "Folks Router returned an invalid user fee discount.",
      "upstream",
      { userFeeDiscount: value }
    );
  }
  return parsed;
}

function normalizeQuote(
  response: SwapQuote,
  input: FolksSwapQuoteRequest,
  options: {
    routerAppId: string;
    quoteTtlMs: number;
    discount: FolksSwapQuote["discount"];
    now: number;
  }
): FolksSwapQuote {
  const type = input.type ?? "fixed-input";
  const createdAt = options.now;
  return {
    source: "folks-router",
    apiVersion: "v2",
    routerAppId: options.routerAppId,
    ...(input.address ? { address: input.address } : {}),
    fromAssetId: BigInt(input.fromAssetId).toString(),
    toAssetId: BigInt(input.toAssetId).toString(),
    amount: BigInt(input.amount).toString(),
    type,
    swapMode: type === "fixed-output" ? "FIXED_OUTPUT" : "FIXED_INPUT",
    quotedAmount: response.quoteAmount.toString(),
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + options.quoteTtlMs).toISOString(),
    requiredAppOptIns: [options.routerAppId],
    txnPayload: response.txnPayload,
    priceImpact: response.priceImpact,
    microalgoTxnsFee: response.microalgoTxnsFee,
    discount: options.discount
  };
}

function validateQuoteAddress(address: string, quote: FolksSwapQuote): void {
  validateAddress(address);
  if (quote.address && quote.address !== address) {
    throw new FolksRouterError(
      "The quote was created for a different Algorand address.", // pragma: allowlist secret
      "validation"
    );
  }
}

function validateAddress(address: string): void {
  if (!isValidAddress(address)) {
    throw new FolksRouterError(
      "A valid Algorand address is required.", // pragma: allowlist secret
      "validation"
    );
  }
}

function validateQuoteFreshness(quote: FolksSwapQuote, nowMs: number): void {
  const expiresAt = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expiresAt) || nowMs >= expiresAt) {
    throw new FolksRouterError(
      "The Folks Router quote has expired; fetch a fresh quote before building the swap.",
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
    throw mapFolksError(error, "Unable to read Algorand account state."); // pragma: allowlist secret
  }
}

async function runFolksRequest<T>(
  gate: RequestGate,
  operation: () => Promise<T>
): Promise<T> {
  return retryRateLimited(() => gate.run(operation), {
    maxRetries: readNonNegativeInteger(process.env.FOLKS_ROUTER_429_MAX_RETRIES, 2),
    baseDelayMs: readNonNegativeInteger(
      process.env.FOLKS_ROUTER_429_RETRY_BASE_MS,
      250
    ),
    getStatus: extractStatus
  });
}

function mapFolksError(error: unknown, fallbackMessage: string): FolksRouterError {
  if (error instanceof FolksRouterError) return error;
  const status = extractStatus(error);
  const details = extractUpstreamDetails(error, status);
  if (status === 429) {
    return new FolksRouterError(
      "Folks Router rate limit exceeded; retry later.",
      "rate-limit",
      details
    );
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new FolksRouterError(
      "Folks Router rejected the swap request.",
      "validation",
      details
    );
  }
  return new FolksRouterError(fallbackMessage, "upstream", details);
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

function extractUpstreamDetails(
  error: unknown,
  status: number | undefined
): Record<string, unknown> | undefined {
  if (!error || typeof error !== "object") {
    return status === undefined ? undefined : { upstreamStatus: status };
  }

  const record = error as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  if (status !== undefined) details.upstreamStatus = status;

  const statusText = record.statusText;
  if (typeof statusText === "string" && statusText.length > 0) {
    details.upstreamStatusText = statusText;
  }

  const message = record.message;
  if (typeof message === "string" && message.length > 0) {
    details.upstreamMessage = truncateDiagnostic(message);
  }

  const data = record.data;
  if (typeof data === "string" && data.length > 0) {
    details.upstreamBody = truncateDiagnostic(data);
  } else if (data !== undefined) {
    details.upstreamBody = truncateDiagnostic(JSON.stringify(data));
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function truncateDiagnostic(value: string, maxLength = 500): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
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
