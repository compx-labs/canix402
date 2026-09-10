import algosdk, { Algodv2 } from "algosdk";

import {
  tinymanSwapFixedInputShape,
  tinymanSwapFixedOutputShape
} from "../execution/shapes/tinyman/swap-router.js";
import { encodeUnsignedTransactionBase64 } from "../execution/types.js";
import { buildPactSmartRouterGroup } from "../execution/shapes/pact/router-abi.js";
import type { ShapeBuildContext } from "../execution/types.js";
import type {
  FolksSwapQuote,
  HaystackQuote,
  MetaRouterId,
  MetaSwapQuote,
  SwapOptInResponse,
  SwapQuoteRequest,
  SwapTransactionsResponse
} from "../types/swap-schema.js";
import type { AsaStatsQuote } from "../types/asastats-router-schema.js";
import {
  createAsaStatsRouterService,
  isAsaStatsRouterConfigured
} from "./asastats-router.js";
import { createFolksRouterService } from "./folks-router.js";
import { createHaystackService } from "./haystack-router.js";
import {
  createHogswapSwapService,
  type HogswapSwapQuoteDto
} from "./hogswap-router.js";
import {
  quotePactSmartRouter,
  resolvePactSmartRouterAppId,
  type PactSmartRouterQuote
} from "./pact-smart-router.js";
import {
  applyBpsHaircut,
  type MetaSwapQuotedRoute,
  type MetaSwapType
} from "./meta-swap-score.js";

const DEFAULT_OPT_IN_TTL_MS = 120_000;
const ALGO_ASSET_ID = 0;

export interface MetaSwapAdapterInput {
  address: string;
  fromAssetId: number;
  toAssetId: number;
  amount: bigint;
  type: MetaSwapType;
  slippagePercent: number;
  slippageBps: number;
  request: SwapQuoteRequest;
}

export interface MetaSwapAdapter {
  id: MetaRouterId;
  isEnabled(): boolean;
  skipReason?(input: MetaSwapAdapterInput): string | undefined;
  quote(input: MetaSwapAdapterInput): Promise<MetaSwapQuotedRoute>;
  buildOptIns(
    address: string,
    quote: MetaSwapQuote
  ): Promise<SwapOptInResponse["data"]>;
  buildSwapTransactions(
    address: string,
    quote: MetaSwapQuote,
    slippagePercent: number
  ): Promise<SwapTransactionsResponse["data"]>;
}

export function createDefaultMetaSwapAdapters(): MetaSwapAdapter[] {
  return [
    createHaystackAdapter(),
    createHogswapAdapter(),
    createFolksAdapter(),
    createTinymanAdapter(),
    createPactAdapter(),
    createAsaStatsAdapter()
  ];
}

function createAlgod(): Algodv2 {
  return new algosdk.Algodv2(
    process.env.X402_ALGOD_TOKEN ?? "",
    (process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud").replace(/\/+$/, ""),
    ""
  );
}

function shapeContext(): ShapeBuildContext {
  return { network: "mainnet", algod: createAlgod() };
}

function emptyOptIns(now = Date.now()): SwapOptInResponse["data"] {
  return {
    required: false,
    transactions: [],
    userSignIndexes: [],
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEFAULT_OPT_IN_TTL_MS).toISOString()
  };
}

function requirePayload<T>(quote: MetaSwapQuote, router: MetaRouterId): T {
  if (quote.router !== router) {
    throw new Error(`Quote router ${quote.router} does not match ${router}.`);
  }
  return quote.payload as T;
}

function createHaystackAdapter(): MetaSwapAdapter {
  return {
    id: "haystack",
    isEnabled() {
      return (process.env.HAYSTACK_API_KEY ?? "").trim().length > 0;
    },
    async quote(input) {
      const haystack = createHaystackService();
      const native = await haystack.getQuote(input.request);
      const quoted = BigInt(native.quotedAmount);
      const expectedOut = input.type === "fixed-output" ? input.amount : quoted;
      const expectedIn = input.type === "fixed-output" ? quoted : input.amount;
      const minOut =
        input.type === "fixed-output"
          ? expectedOut
          : applyBpsHaircut(expectedOut, input.slippageBps);
      const maxIn =
        input.type === "fixed-output"
          ? expectedIn + (expectedIn * BigInt(input.slippageBps)) / 10_000n
          : expectedIn;
      return {
        router: "haystack",
        score: {
          expectedNetOut: expectedOut,
          minOut,
          expectedIn,
          maxIn,
          networkFeeMicroAlgos: 0n,
          feeAlreadyNetted: true
        },
        expiresAtMs: Date.parse(native.expiresAt),
        legs: native.route,
        payload: native
      };
    },
    async buildOptIns(address, quote) {
      const haystack = createHaystackService();
      return haystack.buildOptIns(address, requirePayload<HaystackQuote>(quote, "haystack"));
    },
    async buildSwapTransactions(address, quote, slippagePercent) {
      const haystack = createHaystackService();
      return haystack.buildSwapTransactions(
        address,
        requirePayload<HaystackQuote>(quote, "haystack"),
        slippagePercent
      );
    }
  };
}

function createHogswapAdapter(): MetaSwapAdapter {
  return {
    id: "hogswap",
    isEnabled() {
      return true;
    },
    async quote(input) {
      const service = createHogswapSwapService();
      const native = await service.getQuote({
        address: input.address,
        fromAssetId: input.fromAssetId,
        toAssetId: input.toAssetId,
        amount: input.amount.toString(),
        type: input.type,
        slippageBps: input.slippageBps
      });
      const expectedOut = BigInt(native.quotedAmount);
      const expectedIn = BigInt(native.amountIn);
      return {
        router: "hogswap",
        score: {
          expectedNetOut: expectedOut,
          minOut: BigInt(native.minOutAtSlippage),
          expectedIn,
          maxIn: expectedIn,
          networkFeeMicroAlgos: BigInt(native.networkFeeMicroalgo),
          feeAlreadyNetted: true
        },
        expiresAtMs: Date.parse(native.expiresAt),
        legs: native.legs,
        payload: native
      };
    },
    async buildOptIns(address, quote) {
      return buildOutputAssetOptIn(address, Number(quote.toAssetId));
    },
    async buildSwapTransactions(address, quote) {
      const service = createHogswapSwapService();
      const native = await service.buildSwapTransactions(
        address,
        requirePayload<HogswapSwapQuoteDto>(quote, "hogswap")
      );
      return {
        router: "hogswap",
        transactions: native.transactions.map((txn) => ({
          index: txn.index,
          encodedTransaction: txn.encodedTransaction,
          signer: "user" as const
        })),
        userSignIndexes: native.userSignIndexes,
        createdAt: native.createdAt,
        quoteExpiresAt: native.quoteExpiresAt
      };
    }
  };
}

function createFolksAdapter(): MetaSwapAdapter {
  return {
    id: "folks-router",
    isEnabled() {
      return true;
    },
    async quote(input) {
      const service = createFolksRouterService();
      const native = await service.getQuote({
        address: input.address,
        fromAssetId: input.fromAssetId,
        toAssetId: input.toAssetId,
        amount: input.amount.toString(),
        type: input.type
      });
      const quoted = BigInt(native.quotedAmount);
      const expectedOut = input.type === "fixed-output" ? input.amount : quoted;
      const expectedIn = input.type === "fixed-output" ? quoted : input.amount;
      return {
        router: "folks-router",
        score: {
          expectedNetOut: expectedOut,
          minOut:
            input.type === "fixed-output"
              ? expectedOut
              : applyBpsHaircut(expectedOut, input.slippageBps),
          expectedIn,
          maxIn:
            input.type === "fixed-output"
              ? expectedIn + (expectedIn * BigInt(input.slippageBps)) / 10_000n
              : expectedIn,
          networkFeeMicroAlgos: BigInt(native.microalgoTxnsFee),
          feeAlreadyNetted: true
        },
        expiresAtMs: Date.parse(native.expiresAt),
        legs: native.requiredAppOptIns,
        payload: native
      };
    },
    async buildOptIns(address, quote) {
      const service = createFolksRouterService();
      return service.buildOptIns(
        address,
        requirePayload<FolksSwapQuote>(quote, "folks-router")
      );
    },
    async buildSwapTransactions(address, quote, slippagePercent) {
      const service = createFolksRouterService();
      const native = await service.buildSwapTransactions(
        address,
        requirePayload<FolksSwapQuote>(quote, "folks-router"),
        slippagePercent
      );
      return {
        router: "folks-router",
        transactions: native.transactions.map((txn) => ({
          index: txn.index,
          encodedTransaction: txn.encodedTransaction,
          signer: "user" as const
        })),
        userSignIndexes: native.userSignIndexes,
        createdAt: native.createdAt,
        quoteExpiresAt: native.quoteExpiresAt
      };
    }
  };
}

interface TinymanMetaPayload {
  swapType: MetaSwapType;
  assetInId: number;
  assetOutId: number;
  amount: string;
  maxSlippageBps: number;
}

function createTinymanAdapter(): MetaSwapAdapter {
  return {
    id: "tinyman",
    isEnabled() {
      return true;
    },
    async quote(input) {
      const shape =
        input.type === "fixed-output"
          ? tinymanSwapFixedOutputShape
          : tinymanSwapFixedInputShape;
      const parsed = {
        userAddress: input.address,
        assetInId: input.fromAssetId,
        assetOutId: input.toAssetId,
        amount: input.amount,
        maxSlippageBps: input.slippageBps
      };
      const state = await shape.resolveState(shapeContext(), parsed);
      const selected = state.winner === "router" ? state.router : state.direct;
      if (selected === undefined) {
        throw new Error("Tinyman quote did not include a scored path.");
      }
      return {
        router: "tinyman",
        score: {
          expectedNetOut: selected.expectedOut,
          minOut: selected.minOut,
          expectedIn: selected.expectedIn,
          maxIn: selected.maxIn,
          networkFeeMicroAlgos: selected.networkFeeMicroAlgos,
          feeAlreadyNetted: true
        },
        expiresAtMs: Date.now() + 30_000,
        legs: [{ path: state.winner, hopCount: state.hopCount }],
        payload: {
          swapType: input.type,
          assetInId: input.fromAssetId,
          assetOutId: input.toAssetId,
          amount: input.amount.toString(),
          maxSlippageBps: input.slippageBps
        } satisfies TinymanMetaPayload
      };
    },
    async buildOptIns(address, quote) {
      return buildOutputAssetOptIn(address, Number(quote.toAssetId));
    },
    async buildSwapTransactions(address, quote) {
      const payload = requirePayload<TinymanMetaPayload>(quote, "tinyman");
      const shape =
        payload.swapType === "fixed-output"
          ? tinymanSwapFixedOutputShape
          : tinymanSwapFixedInputShape;
      const parsed = {
        userAddress: address,
        assetInId: payload.assetInId,
        assetOutId: payload.assetOutId,
        amount: BigInt(payload.amount),
        maxSlippageBps: payload.maxSlippageBps
      };
      const context = shapeContext();
      const state = await shape.resolveState(context, parsed);
      const built = await shape.build(context, parsed, state);
      return encodeShapeGroup("tinyman", built.transactions, quote.expiresAt);
    }
  };
}

interface PactMetaPayload {
  routerAppId: number;
  fromAssetId: number;
  toAssetId: number;
  amountIn: string;
  minAmountOut: string;
  hops: Array<{
    poolAppId: number;
    poolEscrowAddress: string;
    fromAssetId: number;
    toAssetId: number;
    amountIn: string;
    amountOut: string;
    feeBps: number;
  }>;
}

function serializePactQuote(quote: PactSmartRouterQuote, routerAppId: number): PactMetaPayload {
  return {
    routerAppId,
    fromAssetId: quote.fromAssetId,
    toAssetId: quote.toAssetId,
    amountIn: quote.amountIn.toString(),
    minAmountOut: quote.minAmountOut.toString(),
    hops: quote.hops.map((hop) => ({
      poolAppId: hop.poolAppId,
      poolEscrowAddress: hop.poolEscrowAddress,
      fromAssetId: hop.fromAssetId,
      toAssetId: hop.toAssetId,
      amountIn: hop.amountIn.toString(),
      amountOut: hop.amountOut.toString(),
      feeBps: hop.feeBps
    }))
  };
}

function createPactAdapter(): MetaSwapAdapter {
  return {
    id: "pact-smart-router",
    isEnabled() {
      return (process.env.PACT_SMART_ROUTER_APP_ID ?? "").trim().length > 0;
    },
    skipReason(input) {
      return input.type === "fixed-output"
        ? "Pact Smart Router does not support fixed-output swaps."
        : undefined;
    },
    async quote(input) {
      if (input.type === "fixed-output") {
        throw new Error("Pact Smart Router does not support fixed-output swaps.");
      }
      const routerAppId = resolvePactSmartRouterAppId();
      const native = await quotePactSmartRouter({
        fromAssetId: input.fromAssetId,
        toAssetId: input.toAssetId,
        amount: input.amount,
        maxSlippageBps: input.slippageBps,
        network: "mainnet",
        algod: createAlgod()
      });
      return {
        router: "pact-smart-router",
        score: {
          expectedNetOut: native.amountOut,
          minOut: native.minAmountOut,
          expectedIn: native.amountIn,
          maxIn: native.amountIn,
          networkFeeMicroAlgos: 0n,
          feeAlreadyNetted: true
        },
        expiresAtMs: Date.now() + 30_000,
        legs: native.hops.map((hop) => ({
          poolAppId: hop.poolAppId,
          fromAssetId: hop.fromAssetId,
          toAssetId: hop.toAssetId
        })),
        payload: serializePactQuote(native, routerAppId)
      };
    },
    async buildOptIns(address, quote) {
      return buildOutputAssetOptIn(address, Number(quote.toAssetId));
    },
    async buildSwapTransactions(address, quote) {
      const payload = requirePayload<PactMetaPayload>(quote, "pact-smart-router");
      const algod = createAlgod();
      const suggestedParams = await algod.getTransactionParams().do();
      const txns = buildPactSmartRouterGroup({
        userAddress: address,
        routerAppId: payload.routerAppId,
        fromAssetId: payload.fromAssetId,
        amountIn: BigInt(payload.amountIn),
        minAmountOut: BigInt(payload.minAmountOut),
        hops: payload.hops.map((hop) => ({
          poolAppId: hop.poolAppId,
          poolEscrowAddress: hop.poolEscrowAddress,
          fromAssetId: hop.fromAssetId,
          toAssetId: hop.toAssetId,
          amountIn: BigInt(hop.amountIn),
          amountOut: BigInt(hop.amountOut),
          feeBps: hop.feeBps
        })),
        suggestedParams
      });
      return encodeShapeGroup("pact-smart-router", txns, quote.expiresAt);
    }
  };
}

function createAsaStatsAdapter(): MetaSwapAdapter {
  return {
    id: "asastats",
    isEnabled() {
      return isAsaStatsRouterConfigured();
    },
    async quote(input) {
      const service = createAsaStatsRouterService();
      const native = await service.getQuote({
        address: input.address,
        fromAssetId: input.fromAssetId,
        toAssetId: input.toAssetId,
        amount: input.amount.toString(),
        type: input.type,
        slippagePct: input.slippagePercent
      });
      const expectedOut = BigInt(native.amountOut);
      const expectedIn = BigInt(native.amountIn);
      return {
        router: "asastats",
        score: {
          expectedNetOut: expectedOut,
          minOut: BigInt(native.minimumReceived ?? native.amountOut),
          expectedIn,
          maxIn: BigInt(native.maximumSent ?? native.amountIn),
          networkFeeMicroAlgos: BigInt(native.networkFeeMicroAlgos),
          feeAlreadyNetted: true
        },
        expiresAtMs: Date.parse(native.expiresAt),
        legs: native.routeVenues,
        payload: native
      };
    },
    async buildOptIns(address, quote) {
      return buildOutputAssetOptIn(address, Number(quote.toAssetId));
    },
    async buildSwapTransactions(address, quote) {
      const service = createAsaStatsRouterService();
      const native = await service.buildSwapGroup(
        address,
        requirePayload<AsaStatsQuote>(quote, "asastats")
      );
      return {
        router: "asastats",
        transactions: native.transactions.map((txn) => ({
          index: txn.index,
          encodedTransaction: txn.encodedTransaction,
          signer: txn.signer === "protocol" ? ("protocol" as const) : ("user" as const),
          ...(txn.signedTransaction === undefined
            ? {}
            : { signedTransaction: txn.signedTransaction })
        })),
        userSignIndexes: native.userSignIndexes,
        createdAt: native.createdAt,
        quoteExpiresAt: native.quoteExpiresAt
      };
    }
  };
}

function encodeShapeGroup(
  router: MetaRouterId,
  transactions: algosdk.Transaction[],
  quoteExpiresAt: string
): SwapTransactionsResponse["data"] {
  const encoded = transactions.map((txn, index) => ({
    index,
    encodedTransaction: encodeUnsignedTransactionBase64(txn),
    signer: "user" as const
  }));
  return {
    router,
    transactions: encoded,
    userSignIndexes: encoded.map((txn) => txn.index),
    createdAt: new Date().toISOString(),
    quoteExpiresAt
  };
}

async function buildOutputAssetOptIn(
  address: string,
  toAssetId: number
): Promise<SwapOptInResponse["data"]> {
  if (toAssetId === ALGO_ASSET_ID) {
    return emptyOptIns();
  }
  const algod = createAlgod();
  const accountInfo = await algod.accountInformation(address).do();
  const optedIn = accountInfo.assets?.some(
    (asset) => Number(asset.assetId) === toAssetId
  );
  if (optedIn) {
    return emptyOptIns();
  }
  const suggestedParams = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    assetIndex: BigInt(toAssetId),
    amount: 0,
    suggestedParams
  });
  const now = Date.now();
  return {
    required: true,
    transactions: [
      {
        index: 0,
        kind: "asset-opt-in",
        encodedTransaction: encodeUnsignedTransactionBase64(txn),
        signer: "user",
        assetId: String(toAssetId)
      }
    ],
    userSignIndexes: [0],
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEFAULT_OPT_IN_TTL_MS).toISOString()
  };
}
