import { Algodv2 } from "algosdk";
import {
  CONTRACT_VERSION,
  Swap,
  SwapQuoteError,
  SwapQuoteType,
  SwapType,
  applySlippageToAmount,
  getSwapRoute,
  getSwapRouterAppID,
  getV2SwapTotalFee,
  getValidatorAppID,
  poolUtils
} from "@tinymanorg/tinyman-js-sdk";
import type {
  GenerateSwapTxnsParams,
  SignerTransaction,
  SwapQuote,
  SwapRouterResponse,
  V2PoolInfo
} from "@tinymanorg/tinyman-js-sdk";

import { resolveAssetDecimals } from "../../../services/asset-decimals.js";
import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey,
  type SerializedTransaction
} from "../../types.js";
import { orderTinymanAssets } from "./pool-state.js";
import {
  hopCountFromRouter,
  selectTinymanSwapWinner,
  type TinymanSwapCandidate,
  type TinymanSwapFallbackReason,
  type TinymanSwapPath,
  type TinymanSwapType
} from "./swap-compare.js";

const MIN_ALGO_FEE = 1000n;
const MAX_SLIPPAGE_BPS = 10_000;
const HIGH_SLIPPAGE_BPS = 500;
const ALGO_ASSET_ID = 0;
const DIRECT_SWAP_OUTER_TXN_COUNT = 2;

const FIXED_INPUT_IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "v2",
  action: "swap",
  variant: "fixedInput"
};

const FIXED_OUTPUT_IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "tinyman",
  protocolVersion: "v2",
  action: "swap",
  variant: "fixedOutput"
};

export interface TinymanSwapInput {
  userAddress: string;
  assetInId: number;
  assetOutId: number;
  amount: bigint;
  maxSlippageBps: number;
}

export interface TinymanSwapState {
  swapType: TinymanSwapType;
  winner: TinymanSwapPath;
  fallbackReason?: TinymanSwapFallbackReason;
  hopCount: number;
  routerAppId: number;
  validatorAppId: number;
  quote: SwapQuote;
  slippage: number;
  router?: TinymanSwapCandidate;
  direct?: TinymanSwapCandidate;
  poolAddress?: string;
}

export interface TinymanSwapRouterDependencies {
  resolveAssetDecimals: (
    assetIds: readonly number[],
    algodClient?: Algodv2
  ) => Promise<Map<number, number>>;
  getPoolInfo: (params: {
    client: Algodv2;
    network: ShapeBuildContext["network"];
    asset1ID: number;
    asset2ID: number;
  }) => Promise<V2PoolInfo>;
  getSwapRoute: (params: {
    amount: bigint;
    assetInID: number;
    assetOutID: number;
    swapType: SwapType;
    network: ShapeBuildContext["network"];
    slippage: string;
  }) => Promise<SwapRouterResponse>;
  getDirectQuote: (params: {
    swapType: TinymanSwapType;
    amount: bigint;
    assetIn: { id: number; decimals: number };
    assetOut: { id: number; decimals: number };
    pool: V2PoolInfo;
  }) => SwapQuote;
  generateTxns: (params: GenerateSwapTxnsParams) => Promise<SignerTransaction[]>;
  getRouterAppId: (network: ShapeBuildContext["network"]) => number;
  getValidatorAppId: (network: ShapeBuildContext["network"]) => number;
}

let dependencyOverrides: Partial<TinymanSwapRouterDependencies> | undefined;

export function setTinymanSwapRouterDependenciesForTests(
  overrides?: Partial<TinymanSwapRouterDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanSwapRouterDependencies {
  return {
    resolveAssetDecimals,
    getPoolInfo: (params) => poolUtils.v2.getPoolInfo(params),
    getSwapRoute: (params) => getSwapRoute(params),
    getDirectQuote: defaultDirectQuote,
    generateTxns: (params) => Swap.v2.generateTxns(params),
    getRouterAppId: (network) => {
      if (network !== "mainnet" && network !== "testnet") {
        throw new Error(`Tinyman swap router app id is not defined for network "${network}".`);
      }
      return getSwapRouterAppID(network);
    },
    getValidatorAppId: (network) => {
      if (network !== "mainnet" && network !== "testnet") {
        throw new Error(`Tinyman validator app id is not defined for network "${network}".`);
      }
      return getValidatorAppID(network, CONTRACT_VERSION.V2);
    },
    ...dependencyOverrides
  };
}

function defaultDirectQuote(params: {
  swapType: TinymanSwapType;
  amount: bigint;
  assetIn: { id: number; decimals: number };
  assetOut: { id: number; decimals: number };
  pool: V2PoolInfo;
}): SwapQuote {
  if (params.swapType === "fixed-input") {
    const quote = Swap.v2.getFixedInputDirectSwapQuote({
      amount: params.amount,
      assetIn: params.assetIn,
      assetOut: params.assetOut,
      pool: params.pool
    });
    return {
      type: SwapQuoteType.Direct,
      data: { pool: params.pool, quote }
    };
  }
  return Swap.v2.getFixedOutputDirectSwapQuote({
    amount: params.amount,
    assetIn: params.assetIn,
    assetOut: params.assetOut,
    pool: params.pool
  });
}

export const tinymanSwapFixedInputShape: TransactionShapeSpec<
  TinymanSwapInput,
  TinymanSwapState
> = createSwapShape(FIXED_INPUT_IDENTITY, "fixed-input");

export const tinymanSwapFixedOutputShape: TransactionShapeSpec<
  TinymanSwapInput,
  TinymanSwapState
> = createSwapShape(FIXED_OUTPUT_IDENTITY, "fixed-output");

function createSwapShape(
  identity: TransactionShapeIdentity,
  swapType: TinymanSwapType
): TransactionShapeSpec<TinymanSwapInput, TinymanSwapState> {
  const sdkSwapType = swapType === "fixed-input" ? SwapType.FixedInput : SwapType.FixedOutput;
  return {
    identity,
    key: buildShapeKey(identity),
    shapeVersion: "1.0.0",
    title:
      swapType === "fixed-input"
        ? "Tinyman v2 Swap Router (fixed-input)"
        : "Tinyman v2 Swap Router (fixed-output)",
    description:
      swapType === "fixed-input"
        ? "Quotes Tinyman Swap Router vs a single Tinyman v2 pool for a fixed input and returns an unsigned group. Uses the router when it beats the single-pool path; otherwise falls back and documents why. Tinyman-pool only — not a cross-DEX aggregator. Canix does not sign or submit."
        : "Quotes Tinyman Swap Router vs a single Tinyman v2 pool for a fixed output and returns an unsigned group. Uses the router when it beats the single-pool path; otherwise falls back and documents why. Tinyman-pool only — not a cross-DEX aggregator. Canix does not sign or submit.",
    supportedOpportunityTypes: [],
    opportunityRole: "enter",
    requiredInputs: ["userAddress", "assetInId", "assetOutId", "amount", "maxSlippageBps"],
    sources: [
      {
        kind: "sdk",
        description:
          "@tinymanorg/tinyman-js-sdk getSwapRoute + direct v2 quotes compared on net return (not Swap.v2.getQuote rate), then generateSwapRouterTxns / generateTxns (unsigned)",
        url: "https://github.com/tinymanorg/tinyman-js-sdk"
      },
      {
        kind: "docs",
        description: "Tinyman Swap Router (Tinyman-pool multi-hop, no extra router fee beyond AMM v2)",
        url: "https://docs.tinyman.org/swap-router"
      }
    ],

    parseInput(raw: unknown): TinymanSwapInput {
      return parseTinymanSwapInput(raw);
    },

    async resolveState(
      context: ShapeBuildContext,
      input: TinymanSwapInput
    ): Promise<TinymanSwapState> {
      return quoteTinymanSwap(context, input, swapType);
    },

    async build(
      context: ShapeBuildContext,
      input: TinymanSwapInput,
      state: TinymanSwapState
    ): Promise<ShapeBuildResult> {
      return buildTinymanSwapGroup(context, input, state, sdkSwapType);
    },

    validate(
      group: readonly SerializedTransaction[],
      input: TinymanSwapInput,
      state: TinymanSwapState
    ): ShapeValidationResult {
      return validateTinymanSwapGroup(group, input, state);
    }
  };
}

export async function quoteTinymanSwap(
  context: ShapeBuildContext,
  input: TinymanSwapInput,
  swapType: TinymanSwapType
): Promise<TinymanSwapState> {
  const dependencies = resolveDependencies();
  const slippage = input.maxSlippageBps / MAX_SLIPPAGE_BPS;
  const routerAppId = dependencies.getRouterAppId(context.network);
  const validatorAppId = dependencies.getValidatorAppId(context.network);
  const sdkSwapType = swapType === "fixed-input" ? SwapType.FixedInput : SwapType.FixedOutput;

  const decimals = await dependencies.resolveAssetDecimals(
    [input.assetInId, input.assetOutId],
    context.algod
  );
  const assetInDecimals = decimals.get(input.assetInId);
  const assetOutDecimals = decimals.get(input.assetOutId);
  if (assetInDecimals === undefined || assetOutDecimals === undefined) {
    throw new ShapeStateError("Could not resolve asset decimals for the swap pair.", {
      details: { assetInId: input.assetInId, assetOutId: input.assetOutId }
    });
  }

  const assetIn = { id: input.assetInId, decimals: assetInDecimals };
  const assetOut = { id: input.assetOutId, decimals: assetOutDecimals };

  const [routerResult, directResult] = await Promise.allSettled([
    quoteRouterPath(dependencies, {
      swapType,
      sdkSwapType,
      amount: input.amount,
      assetInId: input.assetInId,
      assetOutId: input.assetOutId,
      network: context.network,
      slippage
    }),
    quoteDirectPath(dependencies, {
      context,
      swapType,
      amount: input.amount,
      assetIn,
      assetOut,
      slippage
    })
  ]);

  const routerQuote = fulfilledValue(routerResult);
  const directQuote = fulfilledValue(directResult);

  if (routerQuote === undefined && directQuote === undefined) {
    const routerError = rejectedReason(routerResult);
    const directError = rejectedReason(directResult);
    throw new ShapeStateError(
      "Tinyman Swap Router and the single-pool path both failed to quote this pair.",
      {
        details: {
          assetInId: input.assetInId,
          assetOutId: input.assetOutId,
          routerError: diagnosticMessage(routerError),
          directError: diagnosticMessage(directError)
        },
        cause: routerError ?? directError
      }
    );
  }

  const router = routerQuote?.candidate;
  const direct = directQuote?.candidate;
  const selection = selectTinymanSwapWinner(swapType, router, direct);
  const quote = selection.winner === "router" ? routerQuote!.quote : directQuote!.quote;
  const hopCount =
    selection.winner === "router" ? router!.hopCount : (direct?.hopCount ?? 1);

  return {
    swapType,
    winner: selection.winner,
    hopCount,
    routerAppId,
    validatorAppId,
    quote,
    slippage,
    ...(selection.fallbackReason === undefined
      ? {}
      : { fallbackReason: selection.fallbackReason }),
    ...(router === undefined ? {} : { router }),
    ...(direct === undefined ? {} : { direct }),
    ...(directQuote?.poolAddress === undefined ? {} : { poolAddress: directQuote.poolAddress })
  };
}

async function quoteRouterPath(
  dependencies: TinymanSwapRouterDependencies,
  params: {
    swapType: TinymanSwapType;
    sdkSwapType: SwapType;
    amount: bigint;
    assetInId: number;
    assetOutId: number;
    network: ShapeBuildContext["network"];
    slippage: number;
  }
): Promise<{ quote: SwapQuote; candidate: TinymanSwapCandidate }> {
  let route: SwapRouterResponse;
  try {
    route = await dependencies.getSwapRoute({
      amount: params.amount,
      assetInID: params.assetInId,
      assetOutID: params.assetOutId,
      swapType: params.sdkSwapType,
      network: params.network,
      slippage: String(params.slippage)
    });
  } catch (error) {
    throw mapRouterQuoteError(error);
  }

  const expectedIn = BigInt(route.input_amount);
  const expectedOut = BigInt(route.output_amount);
  const minOut =
    params.swapType === "fixed-input" ? BigInt(route.output_amount_arg) : expectedOut;
  const maxIn =
    params.swapType === "fixed-output" ? BigInt(route.input_amount_arg) : expectedIn;

  return {
    quote: { type: SwapQuoteType.Router, data: route },
    candidate: {
      path: "router",
      hopCount: hopCountFromRouter(route),
      expectedIn,
      expectedOut,
      minOut,
      maxIn,
      networkFeeMicroAlgos: BigInt(route.transaction_fee),
      ...(route.price_impact === undefined ? {} : { priceImpact: Number(route.price_impact) })
    }
  };
}

async function quoteDirectPath(
  dependencies: TinymanSwapRouterDependencies,
  params: {
    context: ShapeBuildContext;
    swapType: TinymanSwapType;
    amount: bigint;
    assetIn: { id: number; decimals: number };
    assetOut: { id: number; decimals: number };
    slippage: number;
  }
): Promise<{ quote: SwapQuote; candidate: TinymanSwapCandidate; poolAddress: string }> {
  const { asset1Id, asset2Id } = orderTinymanAssets(params.assetIn.id, params.assetOut.id);
  let pool: V2PoolInfo;
  try {
    pool = await dependencies.getPoolInfo({
      client: params.context.algod,
      network: params.context.network,
      asset1ID: asset1Id,
      asset2ID: asset2Id
    });
  } catch (error) {
    throw new ShapeStateError("Failed to fetch the Tinyman v2 pool for the swap pair.", {
      details: { asset1Id, asset2Id },
      cause: error
    });
  }

  if (poolUtils.isPoolNotCreated(pool) || !poolUtils.isPoolReady(pool)) {
    throw new ShapeStateError("No ready Tinyman v2 pool exists for this asset pair.", {
      details: { asset1Id, asset2Id, status: pool.status }
    });
  }

  let quote: SwapQuote;
  try {
    quote = dependencies.getDirectQuote({
      swapType: params.swapType,
      amount: params.amount,
      assetIn: params.assetIn,
      assetOut: params.assetOut,
      pool
    });
  } catch (error) {
    throw mapDirectQuoteError(error);
  }

  if (quote.type !== SwapQuoteType.Direct) {
    throw new ShapeStateError("Tinyman single-pool quote did not return a direct swap.");
  }

  const expectedIn = quote.data.quote.assetInAmount;
  const expectedOut = quote.data.quote.assetOutAmount;
  const minOut =
    params.swapType === "fixed-input"
      ? applySlippageToAmount("negative", params.slippage, expectedOut)
      : expectedOut;
  const maxIn =
    params.swapType === "fixed-output"
      ? applySlippageToAmount("positive", params.slippage, expectedIn)
      : expectedIn;
  const sdkSwapType =
    params.swapType === "fixed-input" ? SwapType.FixedInput : SwapType.FixedOutput;

  return {
    quote,
    poolAddress: pool.account.address().toString(),
    candidate: {
      path: "direct",
      hopCount: 1,
      expectedIn,
      expectedOut,
      minOut,
      maxIn,
      networkFeeMicroAlgos: getV2SwapTotalFee(sdkSwapType, MIN_ALGO_FEE),
      priceImpact: quote.data.quote.priceImpact
    }
  };
}

async function buildTinymanSwapGroup(
  context: ShapeBuildContext,
  input: TinymanSwapInput,
  state: TinymanSwapState,
  sdkSwapType: SwapType
): Promise<ShapeBuildResult> {
  const dependencies = resolveDependencies();
  let signerTxns: SignerTransaction[];
  try {
    signerTxns = await dependencies.generateTxns({
      client: context.algod,
      network: context.network,
      quote: state.quote,
      swapType: sdkSwapType,
      slippage: state.slippage,
      initiatorAddr: input.userAddress
    });
  } catch (error) {
    throw new ShapeBuildError("Failed to generate unsigned Tinyman swap transactions.", {
      cause: error
    });
  }

  if (signerTxns.length === 0) {
    throw new ShapeBuildError("Tinyman swap generation returned an empty transaction group.");
  }

  const transactions = normalizeTransactions(signerTxns.map((entry) => entry.txn));
  const warnings: string[] = [];
  if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
    warnings.push(
      `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
    );
  }
  if (state.fallbackReason === "single-pool-better") {
    warnings.push(
      "Tinyman Swap Router lost to the single-pool path on net expected return; using the direct v2 swap."
    );
  } else if (state.fallbackReason === "tied-prefer-single-pool") {
    warnings.push(
      "Tinyman Swap Router tied the single-pool path; using the direct v2 swap (fewer transactions)."
    );
  } else if (state.fallbackReason === "router-unavailable") {
    warnings.push(
      "Tinyman Swap Router quote was unavailable; falling back to the single-pool v2 swap."
    );
  } else if (state.fallbackReason === "no-single-pool") {
    warnings.push(
      "No ready Tinyman v2 pool exists for this pair; using the Swap Router path."
    );
  }
  warnings.push(
    "Wallet must already be opted into the output ASA (and any intermediary ASA the router hops through). Router asset_opt_in is a separate group and is never merged."
  );

  return {
    transactions,
    warnings,
    metadata: buildSwapMetadata(input, state)
  };
}

function buildSwapMetadata(
  input: TinymanSwapInput,
  state: TinymanSwapState
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    router: "tinyman-swap-router",
    path: state.winner,
    hopCount: state.hopCount,
    swapType: state.swapType,
    assetInId: input.assetInId,
    assetOutId: input.assetOutId,
    amount: input.amount.toString(),
    slippageBps: input.maxSlippageBps,
    routerAppId: state.routerAppId,
    validatorAppId: state.validatorAppId,
    signed: false,
    submitted: false,
    crossDexAggregator: false
  };
  if (state.fallbackReason !== undefined) {
    metadata.fallbackReason = state.fallbackReason;
  }
  if (state.poolAddress !== undefined) {
    metadata.directPoolAddress = state.poolAddress;
  }
  if (state.router !== undefined) {
    metadata.routerQuote = serializeCandidate(state.router);
  }
  if (state.direct !== undefined) {
    metadata.directQuote = serializeCandidate(state.direct);
  }
  const selected = state.winner === "router" ? state.router : state.direct;
  if (selected !== undefined) {
    metadata.expectedIn = selected.expectedIn.toString();
    metadata.expectedOut = selected.expectedOut.toString();
    metadata.minOut = selected.minOut.toString();
    metadata.maxIn = selected.maxIn.toString();
    metadata.networkFeeMicroAlgos = selected.networkFeeMicroAlgos.toString();
    if (selected.priceImpact !== undefined) {
      metadata.priceImpact = selected.priceImpact;
    }
  }
  if (state.quote.type === SwapQuoteType.Router) {
    metadata.routeLegs = routeLegsFromRouter(state.quote.data);
  }
  return metadata;
}

function serializeCandidate(candidate: TinymanSwapCandidate): Record<string, unknown> {
  return {
    path: candidate.path,
    hopCount: candidate.hopCount,
    expectedIn: candidate.expectedIn.toString(),
    expectedOut: candidate.expectedOut.toString(),
    minOut: candidate.minOut.toString(),
    maxIn: candidate.maxIn.toString(),
    networkFeeMicroAlgos: candidate.networkFeeMicroAlgos.toString(),
    ...(candidate.priceImpact === undefined ? {} : { priceImpact: candidate.priceImpact })
  };
}

function routeLegsFromRouter(route: SwapRouterResponse): string[][] {
  if (Array.isArray(route.pool_mapping) && route.pool_mapping.length > 0) {
    return route.pool_mapping.map((row) => [...row]);
  }
  return [];
}

function validateTinymanSwapGroup(
  group: readonly SerializedTransaction[],
  input: TinymanSwapInput,
  state: TinymanSwapState
): ShapeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (group.length === 0) {
    return { valid: false, errors: ["Swap group must contain at least one transaction."], warnings };
  }

  if (group.some((txn) => !txn.groupPresent)) {
    errors.push("All transactions must belong to a single atomic group.");
  }
  for (const [index, txn] of group.entries()) {
    if (txn.sender !== input.userAddress) {
      errors.push(`Transaction ${index + 1} sender must be the user address.`);
    }
  }

  const swapCall = group.find(
    (txn) =>
      txn.type === "appl" &&
      txn.applicationCall?.appArgsText[0] === "swap"
  );
  if (swapCall === undefined || swapCall.applicationCall === undefined) {
    errors.push('Group must include an application call whose first app arg is "swap".');
    return { valid: errors.length === 0, errors, warnings };
  }

  const call = swapCall.applicationCall;
  const expectedMode = state.swapType;
  if (call.appArgsText[1] !== expectedMode) {
    errors.push(`Swap app call second arg must be "${expectedMode}".`);
  }

  if (state.winner === "router") {
    if (call.appIndex !== String(state.routerAppId)) {
      errors.push(
        `Router swap must call the Tinyman Swap Router app (${state.routerAppId}), got ${call.appIndex}.`
      );
    }
    if (call.foreignApps.length > 0 && !call.foreignApps.includes(String(state.validatorAppId))) {
      errors.push(
        `Router swap foreign apps should include the Tinyman validator (${state.validatorAppId}).`
      );
    }
  } else {
    if (group.length !== DIRECT_SWAP_OUTER_TXN_COUNT) {
      errors.push(
        `Single-pool swap expected ${DIRECT_SWAP_OUTER_TXN_COUNT} outer transactions, received ${group.length}.`
      );
    }
    if (call.appIndex !== String(state.validatorAppId)) {
      errors.push(
        `Direct swap must call the Tinyman validator app (${state.validatorAppId}), got ${call.appIndex}.`
      );
    }
  }

  const inputTxn = group[0];
  if (input.assetInId === ALGO_ASSET_ID) {
    if (inputTxn === undefined || inputTxn.type !== "pay" || !inputTxn.payment) {
      errors.push("First transaction must be an ALGO payment when the input asset is ALGO.");
    }
  } else if (
    inputTxn === undefined ||
    inputTxn.type !== "axfer" ||
    !inputTxn.assetTransfer
  ) {
    errors.push("First transaction must be an asset transfer of the input ASA.");
  } else if (inputTxn.assetTransfer.assetIndex !== String(input.assetInId)) {
    errors.push(
      `First transaction asset must be the input asset (${input.assetInId}), got ${inputTxn.assetTransfer.assetIndex}.`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

function parseTinymanSwapInput(raw: unknown): TinymanSwapInput {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidShapeInputError("Shape input must be an object.");
  }
  const value = raw as Record<string, unknown>;
  const userAddress = parseAddress(value.userAddress);
  const assetInId = parseAssetId(value.assetInId, "assetInId");
  const assetOutId = parseAssetId(value.assetOutId, "assetOutId");
  if (assetInId === assetOutId) {
    throw new InvalidShapeInputError("assetInId and assetOutId must be different assets.", {
      assetInId,
      assetOutId
    });
  }
  return {
    userAddress,
    assetInId,
    assetOutId,
    amount: parseBaseUnitAmount(value.amount, "amount"),
    maxSlippageBps: parseSlippageBps(value.maxSlippageBps)
  };
}

function parseAddress(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("userAddress must be a non-empty string.");
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError("userAddress must be a valid 58-character address.");
  }
  return value;
}

function parseAssetId(value: unknown, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0) {
    throw new InvalidShapeInputError(`${field} must be a non-negative integer asset id.`, {
      [field]: value
    });
  }
  return numeric;
}

function parseBaseUnitAmount(value: unknown, field: string): bigint {
  let result: bigint;
  if (typeof value === "bigint") {
    result = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new InvalidShapeInputError(`${field} must be an integer amount in base units.`, {
        [field]: value
      });
    }
    result = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    result = BigInt(value);
  } else {
    throw new InvalidShapeInputError(`${field} must be a positive integer amount in base units.`, {
      [field]: value
    });
  }
  if (result <= 0n) {
    throw new InvalidShapeInputError(`${field} must be greater than zero.`, {
      [field]: value
    });
  }
  return result;
}

function parseSlippageBps(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isInteger(numeric) ||
    numeric < 0 ||
    numeric > MAX_SLIPPAGE_BPS
  ) {
    throw new InvalidShapeInputError(
      `maxSlippageBps must be an integer between 0 and ${MAX_SLIPPAGE_BPS}.`,
      { maxSlippageBps: value }
    );
  }
  return numeric;
}

function fulfilledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

function rejectedReason(result: PromiseSettledResult<unknown>): unknown {
  return result.status === "rejected" ? result.reason : undefined;
}

function diagnosticMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return undefined;
}

function mapRouterQuoteError(error: unknown): ShapeStateError {
  if (error instanceof ShapeStateError) {
    return error;
  }
  const message =
    error instanceof SwapQuoteError
      ? error.message
      : "Tinyman Swap Router could not quote this pair.";
  return new ShapeStateError(message, { cause: error });
}

function mapDirectQuoteError(error: unknown): ShapeStateError {
  if (error instanceof ShapeStateError) {
    return error;
  }
  const message =
    error instanceof SwapQuoteError
      ? error.message
      : "Tinyman single-pool swap could not quote this pair.";
  return new ShapeStateError(message, { cause: error });
}