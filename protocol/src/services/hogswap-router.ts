import algosdk, { isValidAddress } from "algosdk";

import {
  executeHogswapQuote,
  HogswapClientError,
  HogswapMissingOptInError,
  HogswapNoRouteError,
  HogswapQuoteExpiredError,
  HOGSWAP_QUOTE_TTL_MS,
  HOGSWAP_SWAP_DEFAULT_SLIPPAGE_BPS,
  quoteHogswapSwap,
  type HogswapExecuteResult,
  type HogswapPathBreakdown,
  type HogswapQuote,
  type HogswapQuoteLeg
} from "./hogswap-client.js";

export const HOGSWAP_ROUTER = "hogswap" as const;

export type HogswapSwapType = "fixed-input" | "fixed-output";

export type HogswapRouterErrorKind =
  | "validation"
  | "rate-limit"
  | "upstream"
  | "expired"
  | "opt-in"
  | "no-route";

export class HogswapRouterError extends Error {
  public constructor(
    message: string,
    readonly kind: HogswapRouterErrorKind,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "HogswapRouterError";
  }
}

export interface HogswapSwapQuoteRequest {
  address: string;
  fromAssetId: number | string;
  toAssetId: number | string;
  amount: number | string;
  type?: HogswapSwapType;
  slippageBps?: number;
  maxHops?: number;
  maxLegs?: number;
}

/**
 * Canix-normalized HOGSWAP quote. `quotedAmount` is `expected_out` with the
 * ~5 bps routing fee already netted — do not subtract `routerFeeAmount` again.
 */
export interface HogswapSwapQuoteDto {
  router: typeof HOGSWAP_ROUTER;
  address: string;
  fromAssetId: string;
  toAssetId: string;
  amount: string;
  type: HogswapSwapType;
  quotedAmount: string;
  minOutAtSlippage: string;
  expectedOutRobust: string;
  quoteId: string;
  createdAt: string;
  expiresAt: string;
  slippageBps: number;
  networkFeeMicroalgo: string;
  routerFeeBpsNominal: number;
  routerFeeBpsEffective: number;
  routerFeeAmount: string;
  legs: HogswapQuoteLeg[];
  pathBreakdown: HogswapPathBreakdown[];
}

export interface HogswapSwapGroupTransaction {
  index: number;
  encodedTransaction: string;
  signer: "user";
}

/**
 * Unsigned execute group mapped onto Canix swap / compile transaction shapes.
 * `signed` / `submitted` stay false — Canix never broadcasts.
 */
export interface HogswapSwapExecuteDto {
  router: typeof HOGSWAP_ROUTER;
  quoteId: string;
  transactions: HogswapSwapGroupTransaction[];
  userSignIndexes: number[];
  createdAt: string;
  quoteExpiresAt: string;
  routerAppId: number;
  groupIdB64: string;
  minOutAtSlippage: string;
  networkFeeMicroalgo: string;
  signed: false;
  submitted: false;
}

export interface HogswapSwapService {
  getQuote(input: HogswapSwapQuoteRequest): Promise<HogswapSwapQuoteDto>;
  buildSwapTransactions(
    address: string,
    quote: HogswapSwapQuoteDto
  ): Promise<HogswapSwapExecuteDto>;
}

interface HogswapSwapServiceDependencies {
  quoteSwap: typeof quoteHogswapSwap;
  executeQuote: typeof executeHogswapQuote;
  now: () => number;
  quoteTtlMs: number;
}

let dependencyOverrides: Partial<HogswapSwapServiceDependencies> | undefined;

export function setHogswapSwapServiceDependenciesForTests(
  overrides?: Partial<HogswapSwapServiceDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HogswapSwapServiceDependencies {
  return {
    quoteSwap: quoteHogswapSwap,
    executeQuote: executeHogswapQuote,
    now: Date.now,
    quoteTtlMs: HOGSWAP_QUOTE_TTL_MS,
    ...dependencyOverrides
  };
}

export function createHogswapSwapService(): HogswapSwapService {
  return {
    async getQuote(input) {
      validateAddress(input.address);
      const fromAssetId = parseAssetId(input.fromAssetId, "fromAssetId");
      const toAssetId = parseAssetId(input.toAssetId, "toAssetId");
      const amount = parsePositiveAmount(input.amount, "amount");
      const type: HogswapSwapType = input.type ?? "fixed-input";
      if (fromAssetId === toAssetId) {
        throw new HogswapRouterError(
          "fromAssetId and toAssetId must be different assets.",
          "validation"
        );
      }

      const dependencies = resolveDependencies();
      let quote: HogswapQuote;
      try {
        quote = await dependencies.quoteSwap({
          assetIn: fromAssetId,
          assetOut: toAssetId,
          slippageBps: input.slippageBps ?? HOGSWAP_SWAP_DEFAULT_SLIPPAGE_BPS,
          sender: input.address,
          ...(type === "fixed-output" ? { amountOut: amount } : { amountIn: amount }),
          ...(input.maxHops === undefined ? {} : { maxHops: input.maxHops }),
          ...(input.maxLegs === undefined ? {} : { maxLegs: input.maxLegs })
        });
      } catch (error) {
        throw mapHogswapRouterError(error, "Unable to fetch a HOGSWAP swap quote.");
      }

      return toSwapQuoteDto(quote, {
        address: input.address,
        fromAssetId,
        toAssetId,
        amount,
        type,
        now: dependencies.now(),
        quoteTtlMs: dependencies.quoteTtlMs
      });
    },

    async buildSwapTransactions(address, quote) {
      validateAddress(address);
      if (quote.router !== HOGSWAP_ROUTER) {
        throw new HogswapRouterError(
          "The quote was not produced by the HOGSWAP router.",
          "validation"
        );
      }
      if (quote.address !== address) {
        throw new HogswapRouterError(
          "The quote was created for a different Algorand address.", // pragma: allowlist secret
          "validation"
        );
      }
      const expiresAt = Date.parse(quote.expiresAt);
      const now = resolveDependencies().now();
      if (!Number.isFinite(expiresAt) || now >= expiresAt) {
        throw new HogswapRouterError(
          "The HOGSWAP quote has expired; fetch a fresh quote before building the swap.",
          "expired"
        );
      }

      let execute: HogswapExecuteResult;
      try {
        execute = await resolveDependencies().executeQuote(quote.quoteId, address);
      } catch (error) {
        throw mapHogswapRouterError(error, "Unable to build HOGSWAP swap transactions.");
      }

      if (execute.unsignedGroup.length === 0) {
        throw new HogswapRouterError(
          "HOGSWAP returned an empty unsigned swap group.",
          "upstream"
        );
      }

      const transactions = execute.unsignedGroup.map((member, index) => {
        let txn: algosdk.Transaction;
        try {
          txn = algosdk.decodeUnsignedTransaction(Buffer.from(member.txnB64, "base64"));
        } catch (error) {
          throw new HogswapRouterError(
            `HOGSWAP unsigned_group[${index}] is not a valid unsigned transaction.`,
            "upstream",
            { cause: error }
          );
        }
        if (txn.sender.toString() !== address) {
          throw new HogswapRouterError(
            `HOGSWAP requested a user signature from an unexpected sender at index ${index}.`,
            "upstream"
          );
        }
        return {
          index,
          encodedTransaction: member.txnB64,
          signer: "user" as const
        };
      });

      return {
        router: HOGSWAP_ROUTER,
        quoteId: execute.quoteId,
        transactions,
        userSignIndexes: transactions.map((txn) => txn.index),
        createdAt: new Date(now).toISOString(),
        quoteExpiresAt: quote.expiresAt,
        routerAppId: execute.routerAppId,
        groupIdB64: execute.groupIdB64,
        minOutAtSlippage: String(execute.minOutAtSlippage ?? quote.minOutAtSlippage),
        networkFeeMicroalgo: String(
          execute.networkFeeMicroalgo ?? quote.networkFeeMicroalgo
        ),
        signed: false,
        submitted: false
      };
    }
  };
}

export function toSwapQuoteDto(
  quote: HogswapQuote,
  input: {
    address: string;
    fromAssetId: number;
    toAssetId: number;
    amount: bigint;
    type: HogswapSwapType;
    now: number;
    quoteTtlMs: number;
  }
): HogswapSwapQuoteDto {
  return {
    router: HOGSWAP_ROUTER,
    address: input.address,
    fromAssetId: String(input.fromAssetId),
    toAssetId: String(input.toAssetId),
    amount: input.amount.toString(),
    type: input.type,
    quotedAmount: String(quote.expectedOut),
    minOutAtSlippage: String(quote.minOutAtSlippage),
    expectedOutRobust: String(quote.expectedOutRobust),
    quoteId: quote.quoteId,
    createdAt: new Date(quote.quotedAtMs).toISOString(),
    expiresAt: new Date(input.now + input.quoteTtlMs).toISOString(),
    slippageBps: quote.slippageBps,
    networkFeeMicroalgo: String(quote.networkFeeMicroalgo),
    routerFeeBpsNominal: quote.routerFeeBpsNominal,
    routerFeeBpsEffective: quote.routerFeeBpsEffective,
    routerFeeAmount: String(quote.routerFeeAmount),
    legs: quote.legs,
    pathBreakdown: quote.pathBreakdown
  };
}

function mapHogswapRouterError(error: unknown, fallback: string): HogswapRouterError {
  if (error instanceof HogswapRouterError) {
    return error;
  }
  if (error instanceof HogswapQuoteExpiredError) {
    return new HogswapRouterError(
      "The HOGSWAP quote has expired; fetch a fresh quote before building the swap.",
      "expired",
      { status: error.status }
    );
  }
  if (error instanceof HogswapNoRouteError) {
    return new HogswapRouterError(
      "HOGSWAP found no route for the requested swap.",
      "no-route",
      { status: error.status }
    );
  }
  if (error instanceof HogswapMissingOptInError) {
    return new HogswapRouterError(
      "HOGSWAP execute failed because the wallet is missing a required ASA opt-in. Opt-in first, then re-quote.",
      "opt-in",
      { status: error.status, assetIds: error.assetIds }
    );
  }
  if (error instanceof HogswapClientError) {
    if (error.status === 429) {
      return new HogswapRouterError(
        "HOGSWAP rate limit exceeded; retry later.",
        "rate-limit",
        { status: error.status }
      );
    }
    if (error.message.includes("timed out")) {
      return new HogswapRouterError(error.message, "upstream", { status: error.status });
    }
    return new HogswapRouterError(fallback, "upstream", {
      status: error.status,
      upstreamMessage: error.message
    });
  }
  return new HogswapRouterError(fallback, "upstream", { cause: error });
}

function validateAddress(address: string): void {
  if (!isValidAddress(address)) {
    throw new HogswapRouterError(
      "A valid Algorand address is required.", // pragma: allowlist secret
      "validation"
    );
  }
}

function parseAssetId(value: number | string, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new HogswapRouterError(`${field} must be a non-negative integer asset id.`, "validation");
  }
  return numeric;
}

function parsePositiveAmount(value: number | string, field: string): bigint {
  let amount: bigint;
  try {
    amount = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new HogswapRouterError(`${field} must be a positive integer in base units.`, "validation");
  }
  if (amount <= 0n) {
    throw new HogswapRouterError(`${field} must be greater than zero.`, "validation");
  }
  return amount;
}
