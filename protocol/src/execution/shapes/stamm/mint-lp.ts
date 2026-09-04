import {
  quoteHogswapLpMint,
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
  parseExternalInputs,
  parseOptionalBaseUnitAmount,
  parseOptionalMaxLegs,
  parsePoolAppId,
  parseSlippageBps,
  parseTierIndex,
  type StammExternalInput
} from "./parse-input.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "stamm",
  protocolVersion: "v1",
  action: "mint",
  variant: "lp"
};

export interface StammMintLpInput {
  userAddress: string;
  poolAppId: number;
  tierIndex: number;
  amountA?: bigint;
  amountB?: bigint;
  externalInputs?: StammExternalInput[];
  maxSlippageBps: number;
  maxLegs?: number;
}

export interface StammMintLpDependencies {
  quoteMint: (request: {
    poolAppId: number;
    tierIndex: number;
    amountA?: bigint;
    amountB?: bigint;
    externalInputs?: StammExternalInput[];
    slippageBps: number;
    maxLegs?: number;
    sender: string;
  }) => Promise<HogswapQuote>;
}

let dependencyOverrides: Partial<StammMintLpDependencies> | undefined;

export function setStammMintLpDependenciesForTests(
  overrides?: Partial<StammMintLpDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): StammMintLpDependencies {
  return {
    quoteMint: (request) =>
      quoteHogswapLpMint({
        poolAppId: request.poolAppId,
        tierIndex: request.tierIndex,
        slippageBps: request.slippageBps,
        sender: request.sender,
        ...(request.amountA === undefined ? {} : { amountA: request.amountA }),
        ...(request.amountB === undefined ? {} : { amountB: request.amountB }),
        ...(request.externalInputs === undefined
          ? {}
          : { externalInputs: request.externalInputs }),
        ...(request.maxLegs === undefined ? {} : { maxLegs: request.maxLegs })
      }),
    ...dependencyOverrides
  };
}

export const stammMintLpShape: TransactionShapeSpec<StammMintLpInput, StammHogswapLpState> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "STAMM v1 LP mint",
  description:
    "Mints STAMM LP via HOGSWAP POST /quote (mode LP_MINT) then POST /execute. " +
    "Accepts pool-asset amountA/amountB (single- or two-sided) or externalInputs (any asset, converted into the tier ratio). " +
    "Returns an unsigned group targeting the current router — never signed or broadcast. " +
    "Wallet must already be opted into the LP ASA. Prefer maxLegs when composing with other groups.",
  supportedOpportunityTypes: ["lp"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "poolAppId", "tierIndex"],
  sources: [
    {
      kind: "api",
      description: "HOGSWAP POST /quote mode=LP_MINT and POST /execute",
      url: "https://hogswap-v1.liquihog.dev/reference"
    },
    {
      kind: "docs",
      description: "hogswap-js-sdk lpMintQuote + execute (unsigned groups)",
      url: "https://github.com/LiquiHog/hogswap-js-sdk"
    }
  ],

  parseInput(raw: unknown): StammMintLpInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const userAddress = parseAddress(value.userAddress);
    const poolAppId = parsePoolAppId(value.poolAppId);
    const tierIndex = parseTierIndex(value.tierIndex);
    const amountA = parseOptionalBaseUnitAmount(value.amountA, "amountA");
    const amountB = parseOptionalBaseUnitAmount(value.amountB, "amountB");
    const externalInputs = parseExternalInputs(
      value.externalInputs ??
        (value.externalInputAsset !== undefined
          ? [
              {
                assetId: value.externalInputAsset,
                amount: value.externalInputAmount
              }
            ]
          : undefined)
    );
    const maxSlippageBps = parseSlippageBps(
      value.maxSlippageBps ?? value.slippageBps,
      HOGSWAP_LP_DEFAULT_SLIPPAGE_BPS
    );
    const maxLegs = parseOptionalMaxLegs(value.maxLegs);

    const hasPoolDeposit =
      (amountA !== undefined && amountA > 0n) || (amountB !== undefined && amountB > 0n);
    const hasExternal = externalInputs !== undefined && externalInputs.length > 0;
    if (!hasPoolDeposit && !hasExternal) {
      throw new InvalidShapeInputError(
        "LP mint requires amountA/amountB (pool assets) or externalInputs (any asset).",
        { amountA, amountB, externalInputs }
      );
    }

    return {
      userAddress,
      poolAppId,
      tierIndex,
      ...(amountA === undefined ? {} : { amountA }),
      ...(amountB === undefined ? {} : { amountB }),
      ...(externalInputs === undefined ? {} : { externalInputs }),
      maxSlippageBps,
      ...(maxLegs === undefined ? {} : { maxLegs })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: StammMintLpInput
  ): Promise<StammHogswapLpState> {
    const dependencies = resolveDependencies();
    let quote: HogswapQuote;
    try {
      quote = await dependencies.quoteMint({
        poolAppId: input.poolAppId,
        tierIndex: input.tierIndex,
        slippageBps: input.maxSlippageBps,
        sender: input.userAddress,
        ...(input.amountA === undefined ? {} : { amountA: input.amountA }),
        ...(input.amountB === undefined ? {} : { amountB: input.amountB }),
        ...(input.externalInputs === undefined
          ? {}
          : { externalInputs: input.externalInputs }),
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
    input: StammMintLpInput,
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
        mode: "LP_MINT",
        poolAppId: input.poolAppId,
        tierIndex: input.tierIndex,
        lpAssetId: state.quote.lp?.lpAssetId,
        expectedLpOut: state.quote.lp?.expectedLpOut,
        expectedOut: state.quote.expectedOut,
        minOutAtSlippage: state.quote.minOutAtSlippage,
        slippageBps: input.maxSlippageBps,
        deposits: state.quote.deposits,
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
