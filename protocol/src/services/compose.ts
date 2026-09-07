import algosdk from "algosdk";

import type { AccountHoldings } from "./account-assets.js";
import { fetchAccountHoldings } from "./account-assets.js";
import {
  fetchOpportunitiesResult,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "./aggregate-opportunities.js";
import { evaluateOpportunityEligibility } from "./eligibility.js";
import { attachExecutionShapesToOpportunity } from "./opportunity-execution-shapes.js";
import {
  createHaystackService,
  HaystackRouterError,
  type HaystackService
} from "./haystack-router.js";
import {
  compileExecutableQuote,
  createExecutionAlgodClient,
  DEFAULT_QUOTE_TTL_MS,
  executionRegistry,
  serializeTransaction,
  type ExecutableQuote,
  type ExecutableQuoteGroupTransaction,
  type ExecutionProtocol,
  type SerializedTransaction
} from "../execution/index.js";
import type { OpportunityExecutionShape, OpportunityRecordV1 } from "../types/opportunity.js";
import type { OpportunityEligibility } from "../types/eligibility.js";
import type { ComposeRequest, ComposeResponse } from "../types/compose-schema.js";
import { DEFAULT_COMPOSE_PRICE_USDC, DEFAULT_COMPOSE_SLIPPAGE_PERCENT } from "../types/compose-schema.js";
import type { PlanQuoteRequest, PlanStep } from "../types/plan.js";
import type {
  HaystackQuote,
  SwapOptInResponse,
  SwapTransactionsResponse
} from "../types/swap-schema.js";

const AMOUNT_INPUT_FIELDS = [
  "amount",
  "assetAmount",
  "assetAAmount",
  "amountA",
  "depositAmount",
  "commitAmount"
] as const;

export const HAYSTACK_OPTIN_SHAPE_KEY = "mainnet:haystack:router:optin:required";
export const HAYSTACK_SWAP_SHAPE_KEY = "mainnet:haystack:router:swap:fixed-input";

export const COMPOSE_STALE_QUOTE_CAVEAT =
  "Stale quote: Haystack swap groups expire at quote.expiresAt (typically ~30s). Submit the swap group before expiry. After a missing opt-in confirms, the swap quote is likely stale — re-call POST /execution/compose or POST /swaps/quote then POST /swaps/transactions, then POST /execution/quotes for enter.";

export const COMPOSE_MISSING_OPTIN_CAVEAT =
  "Missing opt-in: submit the opt-in group and wait for confirmation before submitting the Haystack swap group. Swap members fail on-chain if the wallet is not opted into the output asset or required apps. Groups are never merged.";

export const COMPOSE_SLIPPAGE_CAVEAT =
  "Slippage: Haystack min-out uses the requested slippage percent; actual swap output may be below quotedAmount. Enter is compiled with a slippage haircut of the quoted output. If the confirmed swap delivers less, the enter group may fail — re-quote enter via POST /execution/quotes with the received amount. Groups are never merged.";

export const COMPOSE_SIGNER_CAVEAT =
  "Preserve Haystack signer indexes and pre-signed members. Sign only userSignIndexes / signer:user legs. Do not rebuild or merge groups. Canix does not sign or submit.";

export interface ComposeEnterResult {
  steps: PlanStep[];
  quotes: PlanQuoteRequest[];
  warnings: string[];
  compiledQuotes: ExecutableQuote[];
  enterAmount: string;
  enterAssetId: number;
  swapCompiled: boolean;
}

export interface ComposeEnterArgs {
  address: string;
  fromAssetId: number;
  amount: string;
  opportunity: OpportunityRecordV1;
  eligibility: OpportunityEligibility;
  chain: readonly OpportunityExecutionShape[];
  slippage?: number;
  compileQuote?: (shapeKey: string, input: unknown) => Promise<ExecutableQuote>;
  haystack?: HaystackService;
  now?: Date;
}

export interface ComposeServiceDependencies {
  fetchHoldings?: (address: string) => Promise<AccountHoldings>;
  fetchOpportunities?: (refresh: boolean) => Promise<import("../types/opportunity.js").OpportunityMarketRecord[]>;
  compileQuote?: (shapeKey: string, input: unknown) => Promise<ExecutableQuote>;
  haystack?: HaystackService;
  now?: () => Date;
  priceUsdc?: string;
}

let composeOverrides: ComposeServiceDependencies | undefined;

export function setComposeDependenciesForTests(
  overrides?: ComposeServiceDependencies
): void {
  composeOverrides = overrides;
}

export function resolveComposePriceUsdc(): string {
  return (
    composeOverrides?.priceUsdc ??
    process.env.X402_PRICE_EXECUTION_COMPOSE_USDC ??
    DEFAULT_COMPOSE_PRICE_USDC
  );
}

export class ComposeValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ComposeValidationError";
  }
}

/**
 * Pick the single required enter asset to swap into, or undefined when the
 * held/budget asset already matches or the target is ambiguous (two-sided).
 */
export function selectComposeTargetAsset(
  chain: readonly OpportunityExecutionShape[],
  fromAssetId: number
): number | undefined {
  const required = uniqueNumbers(
    chain.flatMap((shape) => shape.requiredAssetIds)
  );
  if (required.length === 0) {
    return undefined;
  }
  if (required.includes(fromAssetId)) {
    return undefined;
  }
  if (required.length === 1) {
    return required[0];
  }
  return undefined;
}

/**
 * True when eligibility is enterable after a swap into `swapTarget`, or already
 * enterable (budget asset still needs converting). Capacity / unresolved gates
 * still block compose.
 */
export function composeCanUnblockEligibility(
  eligibility: OpportunityEligibility,
  swapTarget: number
): boolean {
  if (!eligibility.found || !eligibility.eligibilityFullyCheckable) {
    return false;
  }
  if (eligibility.canEnter) {
    return true;
  }
  const remaining = eligibility.reasons.filter(
    (reason) =>
      reason !== "missing-required-asset" &&
      reason !== "below-min-amount" &&
      reason !== "missing-asa-gate"
  );
  if (remaining.length > 0) {
    return false;
  }
  return eligibility.missingAssets.every((row) => row.assetId === swapTarget);
}

export async function composeEnterSteps(
  args: ComposeEnterArgs
): Promise<ComposeEnterResult> {
  const slippage = resolveSlippage(args.slippage);
  const now = args.now ?? composeOverrides?.now?.() ?? new Date();
  const compileQuote = args.compileQuote ?? compileOneQuote;
  const warnings: string[] = [];
  const steps: PlanStep[] = [];
  const quotes: PlanQuoteRequest[] = [];
  const compiledQuotes: ExecutableQuote[] = [];
  const compiledKeys = new Set<string>();
  let order = 0;

  const swapTarget = selectComposeTargetAsset(args.chain, args.fromAssetId);
  const composable =
    swapTarget !== undefined &&
    composeCanUnblockEligibility(args.eligibility, swapTarget);
  steps.push({
    kind: "eligibility",
    order,
    compileStatus:
      args.eligibility.canEnter || composable ? "compiled" : "blocked",
    warnings:
      !args.eligibility.canEnter && composable
        ? [
            "Eligibility is gated on missing required assets; swap-aware compose unblocks enter after the Haystack group confirms."
          ]
        : [],
    ...(args.eligibility.suggestedSwap
      ? { suggestedSwap: args.eligibility.suggestedSwap }
      : {})
  });
  order += 1;

  let enterAmount = args.amount;
  let enterAssetId = args.fromAssetId;
  let swapCompiled = false;
  const swapPrereqs: string[] = [];

  if (swapTarget !== undefined) {
    const haystack = args.haystack ?? composeOverrides?.haystack;
    const composed = await composeHaystackLegs({
      address: args.address,
      fromAssetId: args.fromAssetId,
      toAssetId: swapTarget,
      amount: args.amount,
      slippage,
      eligibility: args.eligibility,
      ...(haystack ? { haystack } : {}),
      now,
      order
    });
    steps.push(...composed.steps);
    warnings.push(...composed.warnings);
    compiledQuotes.push(...composed.compiledQuotes);
    order = composed.nextOrder;
    swapCompiled = composed.swapCompiled;
    swapPrereqs.push(...composed.prerequisiteKeys);
    if (composed.enterAmount !== undefined) {
      enterAmount = composed.enterAmount;
      enterAssetId = swapTarget;
    }
    if (composed.swapCompiled) {
      for (const key of composed.prerequisiteKeys) {
        compiledKeys.add(key);
      }
    }
  }

  for (const shape of args.chain) {
    const input = buildQuoteInput(args.address, enterAmount, enterAssetId, shape);
    const quoteRequest: PlanQuoteRequest = {
      shapeKey: shape.shapeKey,
      input: input as PlanQuoteRequest["input"]
    };
    quotes.push(quoteRequest);

    const missing = missingRequiredInputs(shape, input);
    const prerequisites = [
      ...(shape.prerequisiteShapeKeys ?? []),
      ...swapPrereqs
    ];
    const unmetPrereq = prerequisites.filter((key) => !compiledKeys.has(key));
    const kind = isSetupShape(shape) ? "setup" : "enter";
    const swapUncompiled = swapTarget !== undefined && !swapCompiled;

    if (missing.length > 0 || unmetPrereq.length > 0 || swapUncompiled) {
      const deferredWarnings = [
        ...(swapUncompiled
          ? [
              "Deferred until the Haystack swap group is compiled and submitted. Re-quote enter after the swap confirms."
            ]
          : []),
        ...(missing.length > 0
          ? [`Deferred until inputs are known: ${missing.join(", ")}.`]
          : []),
        ...(unmetPrereq.length > 0 && !swapUncompiled
          ? [
              `Deferred until prerequisite groups confirm: ${unmetPrereq.join(", ")}. Submit prior quotes first, then POST /execution/quotes.`
            ]
          : [])
      ];
      steps.push({
        kind,
        order,
        compileStatus: "deferred",
        shapeKey: shape.shapeKey,
        ...(prerequisites.length > 0 ? { prerequisiteShapeKeys: [...prerequisites] } : {}),
        quoteRequest,
        warnings: deferredWarnings
      });
      order += 1;
      warnings.push(...deferredWarnings);
      continue;
    }

    try {
      const quote = await compileQuote(shape.shapeKey, input);
      compiledKeys.add(shape.shapeKey);
      compiledQuotes.push(quote);
      const stepWarnings = [
        ...quote.warnings,
        ...(swapTarget !== undefined ? [COMPOSE_SLIPPAGE_CAVEAT, COMPOSE_STALE_QUOTE_CAVEAT] : [])
      ];
      steps.push({
        kind,
        order,
        compileStatus: "compiled",
        shapeKey: shape.shapeKey,
        ...(prerequisites.length > 0 ? { prerequisiteShapeKeys: [...prerequisites] } : {}),
        quoteRequest,
        quote,
        warnings: unique(stepWarnings)
      });
      order += 1;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Failed to compile ${shape.shapeKey}.`;
      steps.push({
        kind,
        order,
        compileStatus: "blocked",
        shapeKey: shape.shapeKey,
        ...(prerequisites.length > 0 ? { prerequisiteShapeKeys: [...prerequisites] } : {}),
        quoteRequest,
        warnings: [message]
      });
      order += 1;
      warnings.push(message);
    }
  }

  return {
    steps,
    quotes,
    warnings: unique(warnings),
    compiledQuotes,
    enterAmount,
    enterAssetId,
    swapCompiled
  };
}

export async function compileCompose(
  request: ComposeRequest
): Promise<ComposeResponse> {
  const now = composeOverrides?.now?.() ?? new Date();
  const amount = parsePositiveAmount(request.amount);
  const slippage = resolveSlippage(request.slippage);

  const holdings = composeOverrides?.fetchHoldings
    ? await composeOverrides.fetchHoldings(request.address)
    : await fetchAccountHoldings(request.address);

  const markets = composeOverrides?.fetchOpportunities
    ? await composeOverrides.fetchOpportunities(request.refresh === true)
    : (
        await fetchOpportunitiesResult(SUPPORTED_AGGREGATE_PROTOCOLS, {
          refresh: request.refresh === true
        })
      ).data;

  const market = markets.find((row) => row.opportunityId === request.opportunityId);
  if (market === undefined) {
    throw new ComposeValidationError(
      `Opportunity '${request.opportunityId}' was not found.`
    );
  }

  const opportunity = attachExecutionShapesToOpportunity(market);
  const eligibility = evaluateOpportunityEligibility(
    market,
    opportunity.opportunityId,
    holdings
  );
  const chain = [...opportunity.executionShapes]
    .filter((shape) => !isBorrowShape(shape))
    .sort((left, right) => left.order - right.order);

  if (chain.length === 0) {
    throw new ComposeValidationError(
      "Opportunity has no non-borrow enter shapes to compose."
    );
  }
  if (!opportunity.executionReady) {
    throw new ComposeValidationError(
      "Opportunity is not execution-ready (research-only)."
    );
  }

  const swapTarget = selectComposeTargetAsset(chain, request.fromAssetId);
  const toAssetId = swapTarget ?? request.fromAssetId;
  if (
    swapTarget !== undefined &&
    !composeCanUnblockEligibility(eligibility, swapTarget)
  ) {
    throw new ComposeValidationError(
      "Opportunity is not composable: eligibility is blocked by capacity, unresolved gates, or assets a single Haystack swap cannot acquire."
    );
  }
  if (swapTarget === undefined && !eligibility.canEnter) {
    throw new ComposeValidationError(
      "Opportunity is not enterable with this asset and cannot be composed via a single Haystack swap."
    );
  }

  const composed = await composeEnterSteps({
    address: request.address,
    fromAssetId: request.fromAssetId,
    amount: amount.toString(),
    opportunity,
    eligibility,
    chain,
    slippage,
    ...(composeOverrides?.compileQuote
      ? { compileQuote: composeOverrides.compileQuote }
      : {}),
    ...(composeOverrides?.haystack ? { haystack: composeOverrides.haystack } : {}),
    now
  });

  const hasCompiledGroup = composed.steps.some(
    (step) =>
      step.compileStatus === "compiled" &&
      (step.kind === "enter" ||
        step.kind === "setup" ||
        step.kind === "swap" ||
        step.kind === "opt-in")
  );
  if (!hasCompiledGroup) {
    throw new ComposeValidationError(
      composed.warnings[0] ?? "Compose produced no executable unsigned groups."
    );
  }

  const expiresAt = resolveExpiry(composed.compiledQuotes, now);
  const networkFee = sumNetworkFees(composed.compiledQuotes);

  return {
    data: {
      opportunityId: opportunity.opportunityId,
      protocol: opportunity.protocol,
      opportunityType: opportunity.opportunityType,
      assetPair: opportunity.assetPair,
      fromAssetId: request.fromAssetId,
      toAssetId,
      inputAmount: amount.toString(),
      enterAmount: composed.enterAmount,
      slippage,
      eligibility,
      executionShapes: [...chain],
      steps: composed.steps,
      quotes: composed.quotes,
      expectedPositionDelta: {
        summary: `Swap ${amount.toString()} of asset ${request.fromAssetId} into asset ${toAssetId} (if needed), then enter ${opportunity.opportunityId} with ${composed.enterAmount}.`,
        entries: [
          {
            opportunityId: opportunity.opportunityId,
            protocol: opportunity.protocol,
            assetId: composed.enterAssetId,
            amount: composed.enterAmount,
            action: "enter"
          }
        ]
      },
      fees: {
        x402Usdc: resolveComposePriceUsdc(),
        estimatedNetworkFeeMicroAlgos: networkFee.toString(),
        estimatedNetworkFeeUsd: null
      },
      expiresAt,
      warnings: unique([
        ...composed.warnings,
        COMPOSE_SIGNER_CAVEAT,
        "Groups stay unsigned and unmerged. Sign and submit locally in order."
      ])
    },
    meta: {
      address: request.address,
      opportunityId: request.opportunityId,
      fetchedAt: now.toISOString(),
      paymentRequired: true,
      executionSubmitted: false,
      quoteTimeAuthoritative: true,
      groupsMerged: false
    }
  };
}

interface HaystackLegsResult {
  steps: PlanStep[];
  warnings: string[];
  compiledQuotes: ExecutableQuote[];
  nextOrder: number;
  swapCompiled: boolean;
  prerequisiteKeys: string[];
  enterAmount?: string;
}

async function composeHaystackLegs(args: {
  address: string;
  fromAssetId: number;
  toAssetId: number;
  amount: string;
  slippage: number;
  eligibility: OpportunityEligibility;
  haystack?: HaystackService;
  now: Date;
  order: number;
}): Promise<HaystackLegsResult> {
  const warnings: string[] = [];
  const steps: PlanStep[] = [];
  const compiledQuotes: ExecutableQuote[] = [];
  const prerequisiteKeys: string[] = [];
  let order = args.order;
  const suggestedSwap = args.eligibility.suggestedSwap ?? {
    fromAssetId: args.fromAssetId,
    toAssetId: args.toAssetId,
    amount: args.amount,
    reason: "missing-required-asset" as const,
    note: "Live Haystack compose — not a hint. Submit opt-in then swap then enter as separate groups."
  };

  let haystack: HaystackService;
  try {
    haystack = args.haystack ?? createHaystackService();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Haystack service is not configured.";
    steps.push(blockedSwapStep(order, suggestedSwap, [message]));
    return {
      steps,
      warnings: [message],
      compiledQuotes,
      nextOrder: order + 1,
      swapCompiled: false,
      prerequisiteKeys
    };
  }

  let quote: HaystackQuote;
  try {
    quote = await haystack.getQuote({
      address: args.address,
      fromAssetId: args.fromAssetId,
      toAssetId: args.toAssetId,
      amount: args.amount,
      type: "fixed-input"
    });
  } catch (error) {
    const message = formatHaystackError(error, "Failed to fetch a Haystack swap quote.");
    steps.push(blockedSwapStep(order, suggestedSwap, [message]));
    return {
      steps,
      warnings: [message],
      compiledQuotes,
      nextOrder: order + 1,
      swapCompiled: false,
      prerequisiteKeys
    };
  }

  let optIns: SwapOptInResponse["data"];
  try {
    optIns = await haystack.buildOptIns(args.address, quote);
  } catch (error) {
    const message = formatHaystackError(error, "Failed to build Haystack opt-in group.");
    steps.push(blockedSwapStep(order, suggestedSwap, [message, COMPOSE_MISSING_OPTIN_CAVEAT]));
    return {
      steps,
      warnings: [message],
      compiledQuotes,
      nextOrder: order + 1,
      swapCompiled: false,
      prerequisiteKeys
    };
  }

  if (optIns.required && optIns.transactions.length > 0) {
    const optInQuote = optInToExecutableQuote(optIns, args.now);
    compiledQuotes.push(optInQuote);
    steps.push({
      kind: "opt-in",
      order,
      compileStatus: "compiled",
      shapeKey: HAYSTACK_OPTIN_SHAPE_KEY,
      quote: optInQuote,
      suggestedSwap,
      warnings: [COMPOSE_MISSING_OPTIN_CAVEAT, COMPOSE_SIGNER_CAVEAT]
    });
    order += 1;
    prerequisiteKeys.push(HAYSTACK_OPTIN_SHAPE_KEY);
    warnings.push(COMPOSE_MISSING_OPTIN_CAVEAT);
  }

  let swapGroup: SwapTransactionsResponse["data"];
  try {
    swapGroup = await haystack.buildSwapTransactions(
      args.address,
      quote,
      args.slippage
    );
  } catch (error) {
    const message = formatHaystackError(
      error,
      "Failed to build Haystack swap transactions."
    );
    steps.push({
      kind: "swap",
      order,
      compileStatus: "blocked",
      shapeKey: HAYSTACK_SWAP_SHAPE_KEY,
      ...(prerequisiteKeys.length > 0
        ? { prerequisiteShapeKeys: [...prerequisiteKeys] }
        : {}),
      suggestedSwap,
      warnings: [message, COMPOSE_STALE_QUOTE_CAVEAT, COMPOSE_SLIPPAGE_CAVEAT]
    });
    return {
      steps,
      warnings: [...warnings, message],
      compiledQuotes,
      nextOrder: order + 1,
      swapCompiled: false,
      prerequisiteKeys
    };
  }

  const swapQuote = swapToExecutableQuote(swapGroup, quote, args.slippage, args.now);
  compiledQuotes.push(swapQuote);
  const swapWarnings = [
    COMPOSE_STALE_QUOTE_CAVEAT,
    COMPOSE_SLIPPAGE_CAVEAT,
    COMPOSE_SIGNER_CAVEAT,
    ...swapQuote.warnings
  ];
  steps.push({
    kind: "swap",
    order,
    compileStatus: "compiled",
    shapeKey: HAYSTACK_SWAP_SHAPE_KEY,
    ...(prerequisiteKeys.length > 0
      ? { prerequisiteShapeKeys: [...prerequisiteKeys] }
      : {}),
    quote: swapQuote,
    suggestedSwap,
    warnings: unique(swapWarnings)
  });
  order += 1;
  prerequisiteKeys.push(HAYSTACK_SWAP_SHAPE_KEY);
  warnings.push(COMPOSE_STALE_QUOTE_CAVEAT, COMPOSE_SLIPPAGE_CAVEAT, COMPOSE_SIGNER_CAVEAT);

  const enterAmount = applySlippageHaircut(quote.quotedAmount, args.slippage);

  return {
    steps,
    warnings: unique(warnings),
    compiledQuotes,
    nextOrder: order,
    swapCompiled: true,
    prerequisiteKeys,
    enterAmount
  };
}

function blockedSwapStep(
  order: number,
  suggestedSwap: PlanStep["suggestedSwap"],
  warnings: string[]
): PlanStep {
  return {
    kind: "swap",
    order,
    compileStatus: "blocked",
    shapeKey: HAYSTACK_SWAP_SHAPE_KEY,
    ...(suggestedSwap ? { suggestedSwap } : {}),
    warnings
  };
}

function optInToExecutableQuote(
  optIns: SwapOptInResponse["data"],
  now: Date
): ExecutableQuote {
  const groupTransactions: ExecutableQuoteGroupTransaction[] = optIns.transactions.map(
    (member) => ({
      index: member.index,
      signer: "user" as const,
      encodedTransaction: member.encodedTransaction
    })
  );
  return {
    shapeKey: HAYSTACK_OPTIN_SHAPE_KEY,
    shapeVersion: "1.0.0",
    identity: {
      network: "mainnet",
      protocol: "haystack" as ExecutionProtocol,
      protocolVersion: "router",
      action: "optin",
      variant: "required"
    },
    createdAt: optIns.createdAt,
    expiresAt: optIns.expiresAt,
    transactions: groupTransactions.map((member) =>
      decodeSerialized(member.encodedTransaction)
    ),
    encodedTransactions: groupTransactions.map((member) => member.encodedTransaction),
    groupTransactions,
    userSignIndexes: [...optIns.userSignIndexes],
    warnings: [COMPOSE_MISSING_OPTIN_CAVEAT, COMPOSE_SIGNER_CAVEAT],
    metadata: {
      kind: "haystack-opt-in",
      required: optIns.required,
      createdAt: now.toISOString()
    }
  };
}

function swapToExecutableQuote(
  swap: SwapTransactionsResponse["data"],
  quote: HaystackQuote,
  slippage: number,
  now: Date
): ExecutableQuote {
  const groupTransactions: ExecutableQuoteGroupTransaction[] = swap.transactions.map(
    (member) => ({
      index: member.index,
      signer: member.signer === "user" ? ("user" as const) : ("logicsig" as const),
      encodedTransaction: member.encodedTransaction,
      ...(member.signedTransaction
        ? { signedTransaction: member.signedTransaction }
        : {})
    })
  );
  const userSignIndexes =
    swap.userSignIndexes.length > 0
      ? [...swap.userSignIndexes]
      : groupTransactions.filter((member) => member.signer === "user").map((m) => m.index);

  return {
    shapeKey: HAYSTACK_SWAP_SHAPE_KEY,
    shapeVersion: "1.0.0",
    identity: {
      network: "mainnet",
      protocol: "haystack" as ExecutionProtocol,
      protocolVersion: "router",
      action: "swap",
      variant: "fixed-input"
    },
    createdAt: swap.createdAt,
    expiresAt: swap.quoteExpiresAt,
    transactions: groupTransactions.map((member) =>
      decodeSerialized(member.encodedTransaction)
    ),
    encodedTransactions: groupTransactions
      .filter((member) => member.signer === "user")
      .map((member) => member.encodedTransaction),
    groupTransactions,
    userSignIndexes,
    warnings: [COMPOSE_STALE_QUOTE_CAVEAT, COMPOSE_SLIPPAGE_CAVEAT, COMPOSE_SIGNER_CAVEAT],
    metadata: {
      kind: "haystack-swap",
      slippage,
      fromAssetId: quote.fromAssetId,
      toAssetId: quote.toAssetId,
      amount: quote.amount,
      quotedAmount: quote.quotedAmount,
      quoteExpiresAt: quote.expiresAt,
      haystackQuote: quote,
      createdAt: now.toISOString()
    }
  };
}

function decodeSerialized(encoded: string): SerializedTransaction {
  try {
    const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"));
    return serializeTransaction(txn);
  } catch {
    return {
      type: "unknown",
      sender: "",
      fee: "0",
      groupPresent: true
    };
  }
}

function buildQuoteInput(
  address: string,
  allocatedAmount: string,
  budgetAssetId: number,
  shape: OpportunityExecutionShape
): Record<string, unknown> {
  const hints = shape.inputHints ?? {};
  const input: Record<string, unknown> = {
    userAddress: address
  };

  for (const [key, value] of Object.entries(hints)) {
    if (value !== undefined) {
      input[key] = value;
    }
  }

  for (const field of AMOUNT_INPUT_FIELDS) {
    if (shape.requiredInputs.includes(field) && input[field] === undefined) {
      input[field] = allocatedAmount;
    }
  }

  if (shape.requiredInputs.includes("assetId") && input.assetId === undefined) {
    input.assetId = hints.assetId ?? hints.depositAssetId ?? budgetAssetId;
  }
  if (
    shape.requiredInputs.includes("depositAssetId") &&
    input.depositAssetId === undefined
  ) {
    input.depositAssetId = hints.depositAssetId ?? budgetAssetId;
  }

  return input;
}

function missingRequiredInputs(
  shape: OpportunityExecutionShape,
  input: Record<string, unknown>
): string[] {
  return shape.requiredInputs.filter((field) => {
    if (field === "amountA" && stammMintDepositSatisfied(input)) {
      return false;
    }
    const value = input[field];
    return value === undefined || value === null || value === "";
  });
}

function stammMintDepositSatisfied(input: Record<string, unknown>): boolean {
  const amountA = input.amountA;
  const amountB = input.amountB;
  const hasPoolDeposit =
    (amountA !== undefined && amountA !== null && amountA !== "" && amountA !== 0 && amountA !== "0") ||
    (amountB !== undefined && amountB !== null && amountB !== "" && amountB !== 0 && amountB !== "0");
  const external = input.externalInputs;
  const hasExternal = Array.isArray(external) && external.length > 0;
  return hasPoolDeposit || hasExternal;
}

function isSetupShape(shape: OpportunityExecutionShape): boolean {
  return shape.action.startsWith("setup") || shape.shapeKey.includes(":setup:");
}

function isBorrowShape(shape: OpportunityExecutionShape): boolean {
  return shape.action === "borrow" || shape.shapeKey.includes(":borrow:");
}

async function compileOneQuote(
  shapeKey: string,
  input: unknown
): Promise<ExecutableQuote> {
  if (composeOverrides?.compileQuote) {
    return composeOverrides.compileQuote(shapeKey, input);
  }
  return compileExecutableQuote(executionRegistry, shapeKey, input, {
    network: "mainnet",
    algod: createExecutionAlgodClient()
  });
}

function resolveSlippage(raw: number | undefined): number {
  if (raw === undefined) {
    return DEFAULT_COMPOSE_SLIPPAGE_PERCENT;
  }
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) {
    throw new ComposeValidationError("Slippage must be a percentage between 0 and 100.");
  }
  return raw;
}

function parsePositiveAmount(raw: string): bigint {
  const amount = BigInt(raw);
  if (amount <= 0n) {
    throw new ComposeValidationError("Amount must be greater than zero.");
  }
  return amount;
}

export function applySlippageHaircut(quotedAmount: string, slippagePercent: number): string {
  const quoted = BigInt(quotedAmount);
  if (quoted <= 0n) {
    throw new ComposeValidationError("Haystack quotedAmount must be greater than zero.");
  }
  const bps = BigInt(Math.round(slippagePercent * 100));
  const haircut = (quoted * bps) / 10_000n;
  const result = quoted - haircut;
  return (result > 0n ? result : quoted).toString();
}

function resolveExpiry(quotes: readonly ExecutableQuote[], now: Date): string {
  let earliest = new Date(now.getTime() + DEFAULT_QUOTE_TTL_MS);
  for (const quote of quotes) {
    const expires = Date.parse(quote.expiresAt);
    if (Number.isFinite(expires) && expires < earliest.getTime()) {
      earliest = new Date(expires);
    }
  }
  return earliest.toISOString();
}

function sumNetworkFees(quotes: readonly ExecutableQuote[]): bigint {
  let total = 0n;
  for (const quote of quotes) {
    for (const txn of quote.transactions) {
      try {
        total += BigInt(txn.fee);
      } catch {
        // ignore non-integer fee strings
      }
    }
  }
  return total;
}

function formatHaystackError(error: unknown, fallback: string): string {
  if (error instanceof HaystackRouterError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
