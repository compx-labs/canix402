import {
  quoteHogswapSwap,
  HOGSWAP_QUOTE_TTL_MS,
  HOGSWAP_SWAP_DEFAULT_SLIPPAGE_BPS,
  type HogswapQuote
} from "../../../services/hogswap-client.js";
import { InvalidShapeInputError } from "../../errors.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import {
  executeQuotedSwapGroup,
  hogswapSwapBuildWarnings,
  mapHogswapSwapQuoteError,
  validateHogswapSwapGroup,
  type HogswapSwapState
} from "./group.js";
import {
  parseAddress,
  parseAssetId,
  parseOptionalMaxHops,
  parseOptionalMaxLegs,
  parsePositiveBaseUnitAmount,
  parseSlippageBps
} from "./parse-input.js";

export type HogswapSwapVariant = "fixed-input" | "fixed-output";

export interface HogswapSwapInput {
  userAddress: string;
  fromAssetId: number;
  toAssetId: number;
  amount: bigint;
  maxSlippageBps: number;
  maxHops?: number;
  maxLegs?: number;
}

export interface HogswapSwapDependencies {
  quoteSwap: (request: {
    assetIn: number;
    assetOut: number;
    amountIn?: bigint;
    amountOut?: bigint;
    slippageBps: number;
    maxHops?: number;
    maxLegs?: number;
    sender: string;
  }) => Promise<HogswapQuote>;
}

let dependencyOverrides: Partial<HogswapSwapDependencies> | undefined;

export function setHogswapSwapDependenciesForTests(
  overrides?: Partial<HogswapSwapDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HogswapSwapDependencies {
  return {
    quoteSwap: (request) =>
      quoteHogswapSwap({
        assetIn: request.assetIn,
        assetOut: request.assetOut,
        slippageBps: request.slippageBps,
        sender: request.sender,
        ...(request.amountIn === undefined ? {} : { amountIn: request.amountIn }),
        ...(request.amountOut === undefined ? {} : { amountOut: request.amountOut }),
        ...(request.maxHops === undefined ? {} : { maxHops: request.maxHops }),
        ...(request.maxLegs === undefined ? {} : { maxLegs: request.maxLegs })
      }),
    ...dependencyOverrides
  };
}

function parseSwapInput(raw: unknown): HogswapSwapInput {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidShapeInputError("Shape input must be an object.");
  }
  const value = raw as Record<string, unknown>;
  const fromAssetId = parseAssetId(
    value.fromAssetId ?? value.assetIn ?? value.asset_in,
    "fromAssetId"
  );
  const toAssetId = parseAssetId(
    value.toAssetId ?? value.assetOut ?? value.asset_out,
    "toAssetId"
  );
  if (fromAssetId === toAssetId) {
    throw new InvalidShapeInputError("fromAssetId and toAssetId must be different assets.", {
      fromAssetId,
      toAssetId
    });
  }
  const maxHops = parseOptionalMaxHops(value.maxHops);
  const maxLegs = parseOptionalMaxLegs(value.maxLegs);
  return {
    userAddress: parseAddress(value.userAddress),
    fromAssetId,
    toAssetId,
    amount: parsePositiveBaseUnitAmount(value.amount, "amount"),
    maxSlippageBps: parseSlippageBps(
      value.maxSlippageBps ?? value.slippageBps,
      HOGSWAP_SWAP_DEFAULT_SLIPPAGE_BPS
    ),
    ...(maxHops === undefined ? {} : { maxHops }),
    ...(maxLegs === undefined ? {} : { maxLegs })
  };
}

function createHogswapSwapShape(
  variant: HogswapSwapVariant
): TransactionShapeSpec<HogswapSwapInput, HogswapSwapState> {
  const identity: TransactionShapeIdentity = {
    network: "mainnet",
    protocol: "hogswap",
    protocolVersion: "v1",
    action: "swap",
    variant
  };
  const amountField = variant === "fixed-output" ? "amount_out" : "amount_in";
  const typeLabel = variant === "fixed-output" ? "exact-out" : "fixed-in";

  return {
    identity,
    key: buildShapeKey(identity),
    shapeVersion: "1.0.0",
    title: `HOGSWAP v1 swap (${typeLabel})`,
    description:
      `Quotes and builds an unsigned HOGSWAP multi-DEX swap group (${typeLabel}, ${amountField}). ` +
      "POST /quote mode=SWAP then POST /execute. Routing fee is already netted into expectedOut. " +
      "Returns unsigned transactions targeting the live router — never signed or broadcast. " +
      "Wallet must already be opted into the output ASA when it is not ALGO.",
    supportedOpportunityTypes: ["swap"],
    opportunityRole: "enter",
    requiredInputs: ["userAddress", "fromAssetId", "toAssetId", "amount", "maxSlippageBps"],
    sources: [
      {
        kind: "api",
        description: "HOGSWAP POST /quote mode=SWAP and POST /execute",
        url: "https://hogswap-v1.liquihog.dev/reference"
      },
      {
        kind: "docs",
        description: "hogswap-js-sdk quote + execute (unsigned groups)",
        url: "https://github.com/LiquiHog/hogswap-js-sdk"
      }
    ],

    parseInput: parseSwapInput,

    async resolveState(context, input) {
      const dependencies = resolveDependencies();
      try {
        const quote = await dependencies.quoteSwap({
          assetIn: input.fromAssetId,
          assetOut: input.toAssetId,
          slippageBps: input.maxSlippageBps,
          sender: input.userAddress,
          ...(variant === "fixed-output"
            ? { amountOut: input.amount }
            : { amountIn: input.amount }),
          ...(input.maxHops === undefined ? {} : { maxHops: input.maxHops }),
          ...(input.maxLegs === undefined ? {} : { maxLegs: input.maxLegs })
        });
        return { quote };
      } catch (error) {
        throw mapHogswapSwapQuoteError(error);
      }
    },

    async build(
      context: ShapeBuildContext,
      input: HogswapSwapInput,
      state: HogswapSwapState
    ): Promise<ShapeBuildResult> {
      const executed = await executeQuotedSwapGroup(context, state.quote, input.userAddress);
      state.execute = executed.execute;
      state.transactions = executed.transactions;

      const now = context.now?.() ?? Date.now();
      const ttl = context.quoteTtlMs ?? HOGSWAP_QUOTE_TTL_MS;
      const warnings = hogswapSwapBuildWarnings({
        toAssetId: input.toAssetId,
        maxSlippageBps: input.maxSlippageBps,
        quoteAgeMs: now - state.quote.quotedAtMs,
        quoteTtlMs: ttl
      });
      if (executed.execute.notes.length > 0) {
        warnings.push(...executed.execute.notes);
      }

      return {
        transactions: executed.transactions,
        warnings,
        metadata: {
          router: "hogswap",
          quoteId: state.quote.quoteId,
          mode: "SWAP",
          type: variant,
          fromAssetId: input.fromAssetId,
          toAssetId: input.toAssetId,
          amountIn: state.quote.amountIn,
          expectedOut: state.quote.expectedOut,
          expectedOutRobust: state.quote.expectedOutRobust,
          minOutAtSlippage: state.quote.minOutAtSlippage,
          quotedAmount: String(state.quote.expectedOut),
          slippageBps: input.maxSlippageBps,
          legs: state.quote.legs,
          pathBreakdown: state.quote.pathBreakdown,
          networkFeeMicroalgo: executed.execute.networkFeeMicroalgo,
          routerFeeBpsNominal: state.quote.routerFeeBpsNominal,
          routerFeeBpsEffective: state.quote.routerFeeBpsEffective,
          routerFeeAmount: state.quote.routerFeeAmount,
          routerFeeAlreadyNetted: true,
          routerAppId: executed.execute.routerAppId,
          groupIdB64: executed.execute.groupIdB64,
          ...(input.maxHops === undefined ? {} : { maxHops: input.maxHops }),
          ...(input.maxLegs === undefined ? {} : { maxLegs: input.maxLegs }),
          signed: false,
          submitted: false,
          executionSubmitted: false
        }
      };
    },

    validate(group, input, state) {
      return validateHogswapSwapGroup(group, input, state);
    }
  };
}

export const hogswapSwapFixedInputShape = createHogswapSwapShape("fixed-input");
export const hogswapSwapFixedOutputShape = createHogswapSwapShape("fixed-output");
