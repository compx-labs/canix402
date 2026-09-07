import {
  quoteHogswapLpRedeem,
  HOGSWAP_LP_DEFAULT_SLIPPAGE_BPS,
  HOGSWAP_QUOTE_TTL_MS,
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
  executeQuotedGroup,
  mapHogswapQuoteError,
  stammLpBuildWarnings,
  validateStammHogswapGroup,
  type StammHogswapLpState
} from "./hogswap-group.js";
import {
  parseAddress,
  parseAssetId,
  parseBaseUnitAmount,
  parseOptionalMaxLegs,
  parsePoolAppId,
  parseSlippageBps,
  parseTierIndex
} from "./parse-input.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "stamm",
  protocolVersion: "v1",
  action: "redeem",
  variant: "lp"
};

export interface StammRedeemLpInput {
  userAddress: string;
  poolAppId: number;
  tierIndex: number;
  lpAmount: bigint;
  targetAsset: number;
  maxSlippageBps: number;
  maxLegs?: number;
}

export interface StammRedeemLpDependencies {
  quoteRedeem: (request: {
    poolAppId: number;
    tierIndex: number;
    lpAmount: bigint;
    targetAsset: number;
    slippageBps: number;
    maxLegs?: number;
    sender: string;
  }) => Promise<HogswapQuote>;
}

let dependencyOverrides: Partial<StammRedeemLpDependencies> | undefined;

export function setStammRedeemLpDependenciesForTests(
  overrides?: Partial<StammRedeemLpDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): StammRedeemLpDependencies {
  return {
    quoteRedeem: (request) =>
      quoteHogswapLpRedeem({
        poolAppId: request.poolAppId,
        tierIndex: request.tierIndex,
        lpAmount: request.lpAmount,
        targetAsset: request.targetAsset,
        slippageBps: request.slippageBps,
        sender: request.sender,
        ...(request.maxLegs === undefined ? {} : { maxLegs: request.maxLegs })
      }),
    ...dependencyOverrides
  };
}

export const stammRedeemLpShape: TransactionShapeSpec<
  StammRedeemLpInput,
  StammHogswapLpState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "STAMM v1 LP redeem",
  description:
    "Burns STAMM LP via HOGSWAP POST /quote (mode LP_REDEEM) then POST /execute. " +
    "targetAsset may be a pool underlying or any routable asset. " +
    "Returns an unsigned group targeting the current router — never signed or broadcast. " +
    "Wallet must already be opted into the LP ASA and the target asset. Prefer maxLegs when composing with other groups.",
  supportedOpportunityTypes: ["lp"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "poolAppId", "tierIndex", "lpAmount", "targetAsset"],
  sources: [
    {
      kind: "api",
      description: "HOGSWAP POST /quote mode=LP_REDEEM and POST /execute",
      url: "https://hogswap-v1.liquihog.dev/reference"
    },
    {
      kind: "docs",
      description: "hogswap-js-sdk lpRedeemQuote + execute (unsigned groups)",
      url: "https://github.com/LiquiHog/hogswap-js-sdk"
    }
  ],

  parseInput(raw: unknown): StammRedeemLpInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const maxLegs = parseOptionalMaxLegs(value.maxLegs);
    return {
      userAddress: parseAddress(value.userAddress),
      poolAppId: parsePoolAppId(value.poolAppId),
      tierIndex: parseTierIndex(value.tierIndex),
      lpAmount: parseBaseUnitAmount(value.lpAmount, "lpAmount"),
      targetAsset: parseAssetId(value.targetAsset, "targetAsset"),
      maxSlippageBps: parseSlippageBps(
        value.maxSlippageBps ?? value.slippageBps,
        HOGSWAP_LP_DEFAULT_SLIPPAGE_BPS
      ),
      ...(maxLegs === undefined ? {} : { maxLegs })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: StammRedeemLpInput
  ): Promise<StammHogswapLpState> {
    const dependencies = resolveDependencies();
    let quote: HogswapQuote;
    try {
      quote = await dependencies.quoteRedeem({
        poolAppId: input.poolAppId,
        tierIndex: input.tierIndex,
        lpAmount: input.lpAmount,
        targetAsset: input.targetAsset,
        slippageBps: input.maxSlippageBps,
        sender: input.userAddress,
        ...(input.maxLegs === undefined ? {} : { maxLegs: input.maxLegs })
      });
    } catch (error) {
      throw mapHogswapQuoteError(error);
    }
    const executed = await executeQuotedGroup(context, quote, input.userAddress);
    return { quote, ...executed };
  },

  async build(
    context: ShapeBuildContext,
    input: StammRedeemLpInput,
    state: StammHogswapLpState
  ): Promise<ShapeBuildResult> {
    const now = context.now?.() ?? Date.now();
    const ttl = context.quoteTtlMs ?? HOGSWAP_QUOTE_TTL_MS;
    const warnings = stammLpBuildWarnings({
      maxSlippageBps: input.maxSlippageBps,
      quoteAgeMs: now - state.quote.quotedAtMs,
      quoteTtlMs: ttl
    });
    if (state.execute.notes.length > 0) {
      warnings.push(...state.execute.notes);
    }

    return {
      transactions: state.transactions,
      warnings,
      metadata: {
        quoteId: state.quote.quoteId,
        mode: "LP_REDEEM",
        poolAppId: input.poolAppId,
        tierIndex: input.tierIndex,
        lpAmount: input.lpAmount.toString(),
        targetAsset: input.targetAsset,
        lpAssetId: state.quote.lp?.lpAssetId,
        expectedOut: state.quote.expectedOut,
        expectedAOut: state.quote.lp?.expectedAOut,
        expectedBOut: state.quote.lp?.expectedBOut,
        minOutAtSlippage: state.quote.minOutAtSlippage,
        slippageBps: input.maxSlippageBps,
        routerAppId: state.execute.routerAppId,
        groupIdB64: state.execute.groupIdB64,
        networkFeeMicroalgo: state.execute.networkFeeMicroalgo,
        ...(input.maxLegs === undefined ? {} : { maxLegs: input.maxLegs }),
        signed: false,
        submitted: false
      }
    };
  },

  validate(group, input, state) {
    return validateStammHogswapGroup(group, input, state);
  }
};
