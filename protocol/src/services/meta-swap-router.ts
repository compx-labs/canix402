import type {
  MetaRouterId,
  MetaSwapAlternative,
  MetaSwapQuote,
  SwapOptInResponse,
  SwapQuoteRequest,
  SwapTransactionsResponse
} from "../types/swap-schema.js";
import {
  createDefaultMetaSwapAdapters,
  type MetaSwapAdapter,
  type MetaSwapAdapterInput
} from "./meta-swap-adapters.js";
import {
  alternativeFromRoute,
  DEFAULT_META_SWAP_QUOTE_TIMEOUT_MS,
  DEFAULT_META_SWAP_QUOTE_TTL_MS,
  percentSlippageToBps,
  resolveQuoteSlippagePercent,
  selectMetaSwapWinner,
  serializeScore,
  type MetaSwapQuotedRoute,
  type MetaSwapType
} from "./meta-swap-score.js";

export type MetaSwapErrorKind =
  | "validation"
  | "configuration"
  | "rate-limit"
  | "upstream"
  | "expired"
  | "no-route";

export class MetaSwapError extends Error {
  constructor(
    message: string,
    readonly kind: MetaSwapErrorKind,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "MetaSwapError";
  }
}

export interface MetaSwapService {
  getQuote(input: SwapQuoteRequest): Promise<MetaSwapQuote>;
  buildOptIns(address: string, quote: MetaSwapQuote): Promise<SwapOptInResponse["data"]>;
  buildSwapTransactions(
    address: string,
    quote: MetaSwapQuote,
    slippage: number
  ): Promise<SwapTransactionsResponse["data"]>;
}

interface MetaSwapServiceDependencies {
  adapters: MetaSwapAdapter[];
  now: () => number;
  timeoutMs: number;
}

const META_ROUTER_IDS: readonly MetaRouterId[] = [
  "haystack",
  "hogswap",
  "tinyman",
  "pact-smart-router",
  "folks-router",
  "asastats"
];

export function createMetaSwapService(
  overrides: Partial<MetaSwapServiceDependencies> = {}
): MetaSwapService {
  const dependencies: MetaSwapServiceDependencies = {
    adapters: overrides.adapters ?? createDefaultMetaSwapAdapters(),
    now: overrides.now ?? Date.now,
    timeoutMs: overrides.timeoutMs ?? readTimeoutMs()
  };

  return {
    async getQuote(input) {
      const address = input.address?.trim();
      if (!address) {
        throw new MetaSwapError("address is required.", "validation");
      }
      const type: MetaSwapType = input.type ?? "fixed-input";
      let slippagePercent: number;
      try {
        slippagePercent = resolveQuoteSlippagePercent(input.slippage);
      } catch (error) {
        throw new MetaSwapError(
          error instanceof Error ? error.message : "Invalid slippage.",
          "validation"
        );
      }
      const slippageBps = percentSlippageToBps(slippagePercent);
      const fromAssetId = Number(input.fromAssetId);
      const toAssetId = Number(input.toAssetId);
      if (!Number.isInteger(fromAssetId) || !Number.isInteger(toAssetId)) {
        throw new MetaSwapError("Asset ids must be integers.", "validation");
      }
      if (fromAssetId === toAssetId) {
        throw new MetaSwapError(
          "fromAssetId and toAssetId must be different assets.",
          "validation"
        );
      }
      const amount = BigInt(input.amount);
      const adapterInput: MetaSwapAdapterInput = {
        address,
        fromAssetId,
        toAssetId,
        amount,
        type,
        slippagePercent,
        slippageBps,
        request: input
      };

      const selected = selectAdapters(dependencies.adapters, input.router);
      const { routes, alternatives } = await quoteAdapters(
        selected,
        adapterInput,
        dependencies.timeoutMs
      );
      if (routes.length === 0) {
        throw new MetaSwapError(
          "No enabled swap router returned a quote for this pair.",
          "no-route",
          { alternatives }
        );
      }

      const winner = selectMetaSwapWinner(type, routes);
      const now = dependencies.now();
      const expiresAtMs = Number.isFinite(winner.expiresAtMs)
        ? winner.expiresAtMs
        : now + DEFAULT_META_SWAP_QUOTE_TTL_MS;

      return {
        router: winner.router,
        address,
        fromAssetId: String(fromAssetId),
        toAssetId: String(toAssetId),
        amount: amount.toString(),
        type,
        quotedAmount: winner.score.expectedNetOut.toString(),
        minOut: winner.score.minOut.toString(),
        networkFeeMicroAlgos: winner.score.networkFeeMicroAlgos.toString(),
        slippageBps,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        score: serializeScore(winner.score),
        alternatives,
        legs: winner.legs,
        payload: winner.payload
      };
    },

    async buildOptIns(address, quote) {
      validateQuote(address, quote, dependencies.now());
      const adapter = findAdapter(dependencies.adapters, quote.router);
      try {
        return await adapter.buildOptIns(address, quote);
      } catch (error) {
        throw mapAdapterError(error, "Unable to build swap opt-ins.");
      }
    },

    async buildSwapTransactions(address, quote, slippage) {
      validateQuote(address, quote, dependencies.now());
      if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100) {
        throw new MetaSwapError(
          "Slippage must be a percentage between 0 and 100.",
          "validation"
        );
      }
      const adapter = findAdapter(dependencies.adapters, quote.router);
      try {
        const group = await adapter.buildSwapTransactions(address, quote, slippage);
        return {
          ...group,
          router: quote.router
        };
      } catch (error) {
        throw mapAdapterError(error, "Unable to build swap transactions.");
      }
    }
  };
}

function selectAdapters(
  adapters: readonly MetaSwapAdapter[],
  router: MetaRouterId | undefined
): MetaSwapAdapter[] {
  if (router === undefined) {
    const enabled = adapters.filter((adapter) => adapter.isEnabled());
    if (enabled.length === 0) {
      throw new MetaSwapError("No swap routers are enabled.", "configuration");
    }
    return enabled;
  }
  if (!META_ROUTER_IDS.includes(router)) {
    throw new MetaSwapError(`Unknown swap router '${router}'.`, "validation");
  }
  const adapter = adapters.find((candidate) => candidate.id === router);
  if (adapter === undefined) {
    throw new MetaSwapError(`Unknown swap router '${router}'.`, "validation");
  }
  if (!adapter.isEnabled()) {
    throw new MetaSwapError(
      `Swap router '${router}' is not configured.`,
      "configuration"
    );
  }
  return [adapter];
}

async function quoteAdapters(
  adapters: readonly MetaSwapAdapter[],
  input: MetaSwapAdapterInput,
  timeoutMs: number
): Promise<{ routes: MetaSwapQuotedRoute[]; alternatives: MetaSwapAlternative[] }> {
  const settled = await Promise.all(
    adapters.map(async (adapter) => {
      const skipReason = adapter.skipReason?.(input);
      if (skipReason !== undefined) {
        return {
          adapter,
          result: { status: "skipped" as const, reason: skipReason }
        };
      }
      const result = await quoteOne(adapter, input, timeoutMs);
      return { adapter, result };
    })
  );

  const routes: MetaSwapQuotedRoute[] = [];
  const alternatives: MetaSwapAlternative[] = [];
  for (const { adapter, result } of settled) {
    if (result.status === "quoted") {
      routes.push(result.route);
      alternatives.push(alternativeFromRoute(result.route));
      continue;
    }
    alternatives.push({
      router: adapter.id,
      status: result.status,
      reason: result.reason
    });
  }
  return { routes, alternatives };
}

async function quoteOne(
  adapter: MetaSwapAdapter,
  input: MetaSwapAdapterInput,
  timeoutMs: number
): Promise<
  | { status: "quoted"; route: MetaSwapQuotedRoute }
  | { status: "timeout"; reason: string }
  | { status: "error"; reason: string }
> {
  try {
    const route = await withTimeout(adapter.quote(input), timeoutMs, adapter.id);
    return { status: "quoted", route };
  } catch (error) {
    if (error instanceof TimeoutError) {
      return {
        status: "timeout",
        reason: `${adapter.id} quote timed out after ${timeoutMs}ms`
      };
    }
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Quote failed."
    };
  }
}

class TimeoutError extends Error {
  constructor(router: MetaRouterId, timeoutMs: number) {
    super(`${router} quote timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  router: MetaRouterId
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(router, timeoutMs)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function findAdapter(
  adapters: readonly MetaSwapAdapter[],
  router: MetaRouterId
): MetaSwapAdapter {
  const adapter = adapters.find((candidate) => candidate.id === router);
  if (adapter === undefined) {
    throw new MetaSwapError(`Unknown swap router '${router}'.`, "validation");
  }
  return adapter;
}

function validateQuote(address: string, quote: MetaSwapQuote, now: number): void {
  if (quote.address !== address) {
    throw new MetaSwapError(
      "The quote was created for a different Algorand address.",
      "validation"
    );
  }
  const expiresAt = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expiresAt) || now >= expiresAt) {
    throw new MetaSwapError(
      "The swap quote has expired; fetch a fresh quote.",
      "expired"
    );
  }
}

function mapAdapterError(error: unknown, fallback: string): MetaSwapError {
  if (error instanceof MetaSwapError) {
    return error;
  }
  const kind = readErrorKind(error);
  const message = error instanceof Error ? error.message : fallback;
  return new MetaSwapError(message, kind, { cause: error });
}

function readErrorKind(error: unknown): MetaSwapErrorKind {
  if (typeof error !== "object" || error === null || !("kind" in error)) {
    return "upstream";
  }
  const kind = (error as { kind?: unknown }).kind;
  if (kind === "validation" || kind === "configuration" || kind === "rate-limit" || kind === "expired") {
    return kind;
  }
  if (kind === "opt-in" || kind === "no-route") {
    return kind === "no-route" ? "no-route" : "validation";
  }
  return "upstream";
}

function readTimeoutMs(): number {
  const raw = process.env.META_SWAP_QUOTE_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_META_SWAP_QUOTE_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_META_SWAP_QUOTE_TIMEOUT_MS;
  }
  return parsed;
}
