import { isValidAddress } from "algosdk";

import type {
  AsaStatsGroup,
  AsaStatsGroupResponse,
  AsaStatsGroupTransaction,
  AsaStatsQuote,
  AsaStatsQuoteRequest,
  AsaStatsQuoteResponse,
  AsaStatsRouterScore
} from "../types/asastats-router-schema.js";
import {
  createRequestGate,
  retryRateLimited,
  type RequestGate
} from "./request-throttle.js";

/** Public marketing site. The router quote/group paths are **not** mounted here. */
export const ASASTATS_PUBLIC_API_BASE_URL = "https://www.asastats.com";

export const ASASTATS_QUOTE_PATH = "/api/v2/internal/router/quote/";
export const ASASTATS_GROUP_PATH = "/api/v2/internal/router/group/";

/** Mainnet application id as of the v1.0.0 unrestricted deploy (2026-09-02). */
export const ASASTATS_DEFAULT_ROUTER_APP_ID = 3_692_588_382;

/** List-price platform fee. Holder discounts are applied by ASA Stats. */
export const ASASTATS_PLATFORM_FEE_BPS = 5 as const;

export const ASASTATS_DEFAULT_QUOTE_TTL_MS = 30_000;
export const ASASTATS_DEFAULT_HTTP_TIMEOUT_MS = 8_000;
export const ASASTATS_DEFAULT_SLIPPAGE_PCT = 0.5;

export const ASASTATS_SWAP_META = {
  paymentRequired: false as const,
  executionSubmitted: false as const
};

export const ASASTATS_REQUIRED_SCOPES = ["router:quote", "router:group"] as const;

export const ASASTATS_ACCESS_BLOCKER = [
  "ASA Stats Smart Router quote/group is not a public integrator API.",
  `POST ${ASASTATS_QUOTE_PATH} and ${ASASTATS_GROUP_PATH} are engine-internal`,
  `(scopes ${ASASTATS_REQUIRED_SCOPES.join(" + ")} on a deployment token).`,
  `Unauthenticated POST to ${ASASTATS_PUBLIC_API_BASE_URL}${ASASTATS_QUOTE_PATH} returns 404 HTML;`,
  "the public /api/v2/ portfolio API is Bearer-gated and does not expose these paths.",
  "Need from ASA Stats: (1) engine base URL, (2) Bearer token with router:quote and router:group.",
  "Do not scrape the website UI. Do not use window.asastatsSwap.signAndSend (Canix never submits).",
  "On-chain app 3692588382 is open to any caller but quoting requires their engine;",
  "Canix will not invent a client-side route graph."
].join(" ");

export type AsaStatsErrorKind =
  | "configuration"
  | "validation"
  | "access-blocked"
  | "stale-quote"
  | "rate-limit"
  | "upstream";

export class AsaStatsRouterError extends Error {
  constructor(
    message: string,
    readonly kind: AsaStatsErrorKind,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "AsaStatsRouterError";
  }
}

export class AsaStatsAccessBlockedError extends AsaStatsRouterError {
  constructor(message = ASASTATS_ACCESS_BLOCKER, details?: unknown) {
    super(message, "access-blocked", details);
    this.name = "AsaStatsAccessBlockedError";
  }
}

export class AsaStatsQuoteStaleError extends AsaStatsRouterError {
  constructor(
    message = "ASA Stats rejected the quote floor (HTTP 409); fetch a fresh quote.",
    details?: unknown
  ) {
    super(message, "stale-quote", details);
    this.name = "AsaStatsQuoteStaleError";
  }
}

export interface AsaStatsRouterAccessStatus {
  configured: boolean;
  ready: boolean;
  blocker: string | null;
  requiredScopes: readonly string[];
  quotePath: string;
  groupPath: string;
}

export interface AsaStatsRouterService {
  getQuote(input: AsaStatsQuoteRequest): Promise<AsaStatsQuote>;
  buildSwapGroup(address: string, quote: AsaStatsQuote): Promise<AsaStatsGroup>;
}

interface AsaStatsRouterConfig {
  apiToken: string | undefined;
  apiBaseUrl: string;
  routerAppId: string;
  quoteTtlMs: number;
  httpTimeoutMs: number;
}

interface AsaStatsClientDependencies {
  fetch: typeof fetch;
  now: () => number;
}

let dependencyOverrides: Partial<AsaStatsClientDependencies> | undefined;
let requestGate: RequestGate | undefined;

export function setAsaStatsRouterDependenciesForTests(
  overrides?: Partial<AsaStatsClientDependencies>
): void {
  dependencyOverrides = overrides;
  requestGate = undefined;
}

function resolveDependencies(): AsaStatsClientDependencies {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    now: Date.now,
    ...dependencyOverrides
  };
}

export function isAsaStatsRouterConfigured(
  token = process.env.ASASTATS_API_TOKEN
): boolean {
  return (token ?? "").trim().length > 0;
}

export function asaStatsRouterAccessStatus(): AsaStatsRouterAccessStatus {
  const configured = isAsaStatsRouterConfigured();
  return {
    configured,
    ready: configured,
    blocker: configured ? null : ASASTATS_ACCESS_BLOCKER,
    requiredScopes: ASASTATS_REQUIRED_SCOPES,
    quotePath: ASASTATS_QUOTE_PATH,
    groupPath: ASASTATS_GROUP_PATH
  };
}

export function wrapAsaStatsQuote(quote: AsaStatsQuote): AsaStatsQuoteResponse {
  return { data: quote, meta: { ...ASASTATS_SWAP_META } };
}

export function wrapAsaStatsGroup(group: AsaStatsGroup): AsaStatsGroupResponse {
  return { data: group, meta: { ...ASASTATS_SWAP_META } };
}

export function scoreAsaStatsQuote(quote: AsaStatsQuote): AsaStatsRouterScore {
  return {
    router: "asastats",
    mode: quote.mode,
    amountInBaseUnits: quote.amountIn,
    expectedNetOutBaseUnits: quote.amountOut,
    minOutBaseUnits: quote.minimumReceived ?? null,
    maxInBaseUnits: quote.maximumSent ?? null,
    networkFeeMicroAlgos: quote.networkFeeMicroAlgos,
    platformFeeBps: ASASTATS_PLATFORM_FEE_BPS,
    platformFeeAlreadyNetted: true,
    subtractPlatformFee: false
  };
}

export function createAsaStatsRouterService(
  overrides: Partial<AsaStatsRouterConfig> = {}
): AsaStatsRouterService {
  const config = resolveConfig(overrides);

  return {
    async getQuote(input) {
      validateAddress(input.address);
      const type = input.type ?? "fixed-input";
      const mode = type === "fixed-output" ? "buy" : "sell";
      const slippagePct = normalizeSlippage(input.slippagePct);
      const payload = await postEngineJson(config, ASASTATS_QUOTE_PATH, {
        address: input.address,
        from_asset_id: toAssetIdNumber(input.fromAssetId, "fromAssetId"),
        to_asset_id: toAssetIdNumber(input.toAssetId, "toAssetId"),
        amount: toBaseUnitString(input.amount, "amount"),
        mode,
        slippage_pct: slippagePct
      });
      return parseAsaStatsQuote(payload, {
        address: input.address,
        fromAssetId: String(input.fromAssetId),
        toAssetId: String(input.toAssetId),
        amount: toBaseUnitString(input.amount, "amount"),
        type,
        slippagePct,
        appId: config.routerAppId,
        createdAtMs: resolveDependencies().now(),
        quoteTtlMs: config.quoteTtlMs
      });
    },

    async buildSwapGroup(address, quote) {
      validateQuoteAddress(address, quote);
      validateQuoteFreshness(quote, resolveDependencies().now());
      const payload = await postEngineJson(config, ASASTATS_GROUP_PATH, {
        address,
        quote: quote.raw
      });
      return parseAsaStatsGroup(payload, quote, {
        createdAtMs: resolveDependencies().now()
      });
    }
  };
}

function resolveConfig(overrides: Partial<AsaStatsRouterConfig>): AsaStatsRouterConfig {
  return {
    apiToken: overrides.apiToken ?? process.env.ASASTATS_API_TOKEN,
    apiBaseUrl: trimTrailingSlash(
      overrides.apiBaseUrl
        ?? process.env.ASASTATS_API_BASE_URL
        ?? ASASTATS_PUBLIC_API_BASE_URL
    ),
    routerAppId: String(
      overrides.routerAppId
        ?? process.env.ASASTATS_ROUTER_APP_ID
        ?? ASASTATS_DEFAULT_ROUTER_APP_ID
    ),
    quoteTtlMs: overrides.quoteTtlMs
      ?? readPositiveInteger(process.env.ASASTATS_QUOTE_TTL_MS, ASASTATS_DEFAULT_QUOTE_TTL_MS),
    httpTimeoutMs: overrides.httpTimeoutMs
      ?? readPositiveInteger(
        process.env.ASASTATS_HTTP_TIMEOUT_MS,
        ASASTATS_DEFAULT_HTTP_TIMEOUT_MS
      )
  };
}

function sharedGate(): RequestGate {
  if (requestGate === undefined) {
    requestGate = createRequestGate({
      concurrency: readPositiveInteger(process.env.ASASTATS_HTTP_CONCURRENCY, 2),
      delayMs: readNonNegativeInteger(process.env.ASASTATS_HTTP_DELAY_MS, 50)
    });
  }
  return requestGate;
}

async function postEngineJson(
  config: AsaStatsRouterConfig,
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const token = config.apiToken?.trim();
  if (!token) {
    throw new AsaStatsAccessBlockedError();
  }

  const { fetch: fetchImpl } = resolveDependencies();
  const url = `${config.apiBaseUrl}${path}`;
  return sharedGate().run(() =>
    retryRateLimited(
      async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.httpTimeoutMs);
        try {
          const response = await fetchImpl(url, {
            method: "POST",
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          const payload = await readJsonBody(response);
          if (response.status === 429) {
            throw new AsaStatsRouterError(
              `ASA Stats returned HTTP 429 for ${path}.`,
              "rate-limit",
              { status: 429, body: payload }
            );
          }
          if (!response.ok) {
            throw mapHttpError(path, response.status, payload);
          }
          return payload;
        } catch (error) {
          if (isAbortError(error)) {
            throw new AsaStatsRouterError(
              `ASA Stats ${path} timed out after ${config.httpTimeoutMs}ms.`,
              "upstream"
            );
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      },
      {
        maxRetries: readNonNegativeInteger(process.env.ASASTATS_429_MAX_RETRIES, 2),
        baseDelayMs: readNonNegativeInteger(process.env.ASASTATS_429_RETRY_BASE_MS, 250),
        getStatus: (error) =>
          error instanceof AsaStatsRouterError
            ? statusFromDetails(error.details)
            : undefined
      }
    )
  );
}

function mapHttpError(path: string, status: number, payload: unknown): AsaStatsRouterError {
  const detail = errorDetail(payload);
  const details = { status, body: payload, path };
  if (status === 401 || status === 403 || status === 404) {
    return new AsaStatsAccessBlockedError(
      `${ASASTATS_ACCESS_BLOCKER} Upstream HTTP ${status}${detail.length > 0 ? `: ${detail}` : "."}`,
      details
    );
  }
  if (status === 409) {
    return new AsaStatsQuoteStaleError(
      detail.length > 0
        ? `ASA Stats quote floor no longer clears (HTTP 409): ${detail}`
        : undefined,
      details
    );
  }
  if (status >= 400 && status < 500) {
    return new AsaStatsRouterError(
      detail.length > 0
        ? `ASA Stats rejected ${path}: ${detail}`
        : `ASA Stats rejected ${path} (HTTP ${status}).`,
      "validation",
      details
    );
  }
  return new AsaStatsRouterError(
    detail.length > 0
      ? `ASA Stats ${path} returned HTTP ${status}: ${detail}`
      : `ASA Stats ${path} returned HTTP ${status}.`,
    "upstream",
    details
  );
}

export interface ParseAsaStatsQuoteContext {
  address: string;
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  type: "fixed-input" | "fixed-output";
  slippagePct: number;
  appId: string;
  createdAtMs: number;
  quoteTtlMs: number;
}

export function parseAsaStatsQuote(
  payload: unknown,
  context: ParseAsaStatsQuoteContext
): AsaStatsQuote {
  const record = asRecord(payload);
  if (record === null) {
    throw new AsaStatsRouterError("ASA Stats quote response is not an object.", "upstream");
  }
  const amountIn = parseBaseUnitString(record.amount_in, "amount_in");
  const amountOutField = parseBaseUnitString(record.amount_out, "amount_out", { allowZero: true });
  const minimumReceived = parseOptionalBaseUnit(record.minimum_received);
  const maximumSent = parseOptionalBaseUnit(record.maximum_sent);
  const mode = context.type === "fixed-output" ? "buy" : "sell";
  const amountOut =
    mode === "buy" && minimumReceived !== undefined ? minimumReceived : amountOutField;
  const routeLabel =
    typeof record.route_label === "string" ? record.route_label.trim() : "";
  if (routeLabel.length === 0) {
    throw new AsaStatsRouterError("ASA Stats quote is missing route_label.", "upstream");
  }
  const quotedAmount = mode === "buy" ? amountIn : amountOut;

  return {
    router: "asastats",
    address: context.address,
    fromAssetId: context.fromAssetId,
    toAssetId: context.toAssetId,
    amount: context.amount,
    type: context.type,
    mode,
    amountIn,
    amountOut,
    ...(mode === "sell" && minimumReceived !== undefined
      ? { minimumReceived }
      : {}),
    ...(mode === "buy" && maximumSent !== undefined && maximumSent !== "0"
      ? { maximumSent }
      : {}),
    quotedAmount,
    priceImpactPct: parseNullableNumber(record.price_impact_pct),
    routeLabel,
    routeVenues: parseRouteVenues(routeLabel),
    networkFeeMicroAlgos: parseBaseUnitString(record.fees_total, "fees_total", {
      allowZero: true
    }),
    platformFeeBps: ASASTATS_PLATFORM_FEE_BPS,
    platformFeeAlreadyNetted: true,
    slippagePct: context.slippagePct,
    ...(typeof record.value_usdc === "number" && Number.isFinite(record.value_usdc)
      ? { valueUsdc: record.value_usdc }
      : {}),
    appId: context.appId,
    createdAt: new Date(context.createdAtMs).toISOString(),
    expiresAt: new Date(context.createdAtMs + context.quoteTtlMs).toISOString(),
    raw: record
  };
}

export function parseAsaStatsGroup(
  payload: unknown,
  quote: AsaStatsQuote,
  options: { createdAtMs: number }
): AsaStatsGroup {
  const record = asRecord(payload);
  if (record === null) {
    throw new AsaStatsRouterError("ASA Stats group response is not an object.", "upstream");
  }
  const encoded = parseTransactionBlobs(record.transactions);
  if (encoded.length === 0) {
    throw new AsaStatsRouterError(
      "ASA Stats returned an empty swap transaction group.",
      "upstream"
    );
  }
  const signedMap = parseSignedTransactions(record.signed_transactions);
  const quoteSignerIndex = parseOptionalIndex(record.quote_signer_index);
  const transactions: AsaStatsGroupTransaction[] = encoded.map((encodedTransaction, index) => {
    const signedTransaction = signedMap.get(index);
    const isProtocol =
      signedTransaction !== undefined || quoteSignerIndex === index;
    if (isProtocol) {
      if (signedTransaction === undefined) {
        throw new AsaStatsRouterError(
          `ASA Stats named quote signer index ${index} without signed_transactions[${index}].`,
          "upstream"
        );
      }
      return {
        index,
        encodedTransaction,
        signer: "protocol",
        signedTransaction
      };
    }
    return {
      index,
      encodedTransaction,
      signer: "user"
    };
  });

  return {
    router: "asastats",
    transactions,
    userSignIndexes: transactions
      .filter((txn) => txn.signer === "user")
      .map((txn) => txn.index),
    ...(quoteSignerIndex === undefined ? {} : { quoteSignerIndex }),
    createdAt: new Date(options.createdAtMs).toISOString(),
    quoteExpiresAt: quote.expiresAt,
    quote
  };
}

function parseTransactionBlobs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new AsaStatsRouterError(
        `ASA Stats group transactions[${index}] is not a base64 string.`,
        "upstream"
      );
    }
    return entry;
  });
}

function parseSignedTransactions(value: unknown): Map<number, string> {
  const map = new Map<number, string>();
  const record = asRecord(value);
  if (record === null) {
    return map;
  }
  for (const [key, blob] of Object.entries(record)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) {
      throw new AsaStatsRouterError(
        `ASA Stats signed_transactions has a non-index key ${JSON.stringify(key)}.`,
        "upstream"
      );
    }
    if (typeof blob !== "string" || blob.length === 0) {
      throw new AsaStatsRouterError(
        `ASA Stats signed_transactions[${index}] is not a base64 string.`,
        "upstream"
      );
    }
    map.set(index, blob);
  }
  return map;
}

function parseRouteVenues(routeLabel: string): string[] {
  return routeLabel
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseOptionalIndex(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AsaStatsRouterError(
      "ASA Stats quote_signer_index is not a non-negative integer.",
      "upstream"
    );
  }
  return parsed;
}

function parseBaseUnitString(
  value: unknown,
  field: string,
  options: { allowZero?: boolean } = {}
): string {
  if (typeof value === "bigint") {
    if (value < 0n || (!options.allowZero && value === 0n)) {
      throw new AsaStatsRouterError(`ASA Stats ${field} must be a non-negative integer string.`, "upstream");
    }
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || (!options.allowZero && value === 0)) {
      throw new AsaStatsRouterError(
        `ASA Stats ${field} must be a BigInt-safe decimal string (got ${String(value)}).`,
        "upstream"
      );
    }
    return String(value);
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new AsaStatsRouterError(
      `ASA Stats ${field} must be a decimal string in base units.`,
      "upstream"
    );
  }
  if (!options.allowZero && value === "0") {
    throw new AsaStatsRouterError(`ASA Stats ${field} must be greater than zero.`, "upstream");
  }
  return value;
}

function parseOptionalBaseUnit(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return parseBaseUnitString(value, "optional amount", { allowZero: true });
}

function parseNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function toBaseUnitString(value: number | string, field: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new AsaStatsRouterError(`${field} must be a positive integer.`, "validation");
    }
    return String(value);
  }
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new AsaStatsRouterError(`${field} must be a positive decimal string.`, "validation");
  }
  return value;
}

function toAssetIdNumber(value: number | string, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AsaStatsRouterError(`${field} must be a non-negative asset id.`, "validation");
  }
  return parsed;
}

function normalizeSlippage(value: number | undefined): number {
  const slippage = value ?? ASASTATS_DEFAULT_SLIPPAGE_PCT;
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100) {
    throw new AsaStatsRouterError(
      "Slippage must be a percentage between 0 and 100.",
      "validation"
    );
  }
  return slippage;
}

function validateQuoteAddress(address: string, quote: AsaStatsQuote): void {
  validateAddress(address);
  if (quote.address !== address) {
    throw new AsaStatsRouterError(
      "The quote was created for a different wallet address.",
      "validation"
    );
  }
}

function validateAddress(address: string): void {
  if (!isValidAddress(address)) {
    throw new AsaStatsRouterError(
      "A valid wallet address is required.",
      "validation"
    );
  }
}

function validateQuoteFreshness(quote: AsaStatsQuote, nowMs: number): void {
  const expiresAt = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expiresAt) || nowMs >= expiresAt) {
    throw new AsaStatsQuoteStaleError(
      "The ASA Stats quote has expired; fetch a fresh quote before building the group."
    );
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorDetail(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.slice(0, 300);
  }
  const record = asRecord(payload);
  if (record === null) {
    return "";
  }
  if (typeof record.error === "string") {
    return record.error;
  }
  if (typeof record.detail === "string") {
    return record.detail;
  }
  if (typeof record.message === "string") {
    return record.message;
  }
  return "";
}

function statusFromDetails(details: unknown): number | undefined {
  const record = asRecord(details);
  return typeof record?.status === "number" ? record.status : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
