import type { AccountHoldings } from "./account-assets.js";
import { fetchAccountHoldings } from "./account-assets.js";
import {
  fetchOpportunitiesResult,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "./aggregate-opportunities.js";
import { evaluateOpportunityEligibility } from "./eligibility.js";
import { attachExecutionShapesToOpportunity } from "./opportunity-execution-shapes.js";
import {
  compileExecutableQuote,
  createExecutionAlgodClient,
  DEFAULT_QUOTE_TTL_MS,
  executionRegistry,
  type ExecutableQuote
} from "../execution/index.js";
import type {
  OpportunityExecutionShape,
  OpportunityMarketRecord,
  OpportunityRecordV1
} from "../types/opportunity.js";
import type { OpportunityEligibility } from "../types/eligibility.js";
import type {
  PlanAllocation,
  PlanBlockedAllocation,
  PlanConstraints,
  PlanQuoteRequest,
  PlanRequest,
  PlanResponse,
  PlanStep
} from "../types/plan.js";
import { DEFAULT_PLAN_PRICE_USDC } from "../types/plan-schema.js";

const AMOUNT_INPUT_FIELDS = [
  "amount",
  "assetAmount",
  "assetAAmount",
  "depositAmount",
  "commitAmount"
] as const;

const DEFAULT_CONSTRAINTS = {
  maxProtocolWeightBps: 10_000,
  noNewBorrows: true,
  executionReadyOnly: true,
  maxAllocations: 1
} as const;

const SWAP_COMPOSE_NOTE =
  "Swap legs are hints only in this SKU (not live Haystack groups). Use POST /swaps/quote then re-check eligibility, or wait for compose (13.4). Quote-time on-chain checks remain authoritative.";

export interface PlanCompilerDependencies {
  fetchHoldings?: (address: string) => Promise<AccountHoldings>;
  fetchOpportunities?: (refresh: boolean) => Promise<OpportunityMarketRecord[]>;
  compileQuote?: (shapeKey: string, input: unknown) => Promise<ExecutableQuote>;
  now?: () => Date;
  priceUsdc?: string;
}

let dependencyOverrides: PlanCompilerDependencies | undefined;

export function setPlanCompilerDependenciesForTests(
  overrides?: PlanCompilerDependencies
): void {
  dependencyOverrides = overrides;
}

export function resolvePlanPriceUsdc(): string {
  return (
    dependencyOverrides?.priceUsdc ??
    process.env.X402_PRICE_PLANS_USDC ??
    DEFAULT_PLAN_PRICE_USDC
  );
}

export async function compilePlan(request: PlanRequest): Promise<PlanResponse> {
  const now = dependencyOverrides?.now?.() ?? new Date();
  const constraints = resolveConstraints(request.constraints);
  const budgetAmount = parsePositiveAmount(request.budget.amount);

  const holdings = dependencyOverrides?.fetchHoldings
    ? await dependencyOverrides.fetchHoldings(request.address)
    : await fetchAccountHoldings(request.address);

  const markets = dependencyOverrides?.fetchOpportunities
    ? await dependencyOverrides.fetchOpportunities(request.refresh === true)
    : (await fetchOpportunitiesResult(SUPPORTED_AGGREGATE_PROTOCOLS, {
        refresh: request.refresh === true
      })).data;

  const pinned = request.opportunityIds
    ? new Set(request.opportunityIds)
    : undefined;
  const byId = new Map(markets.map((row) => [row.opportunityId, row] as const));

  const consideredIds = pinned
    ? request.opportunityIds ?? []
    : markets.map((row) => row.opportunityId);

  const blocked: PlanBlockedAllocation[] = [];
  const enterable: RankedCandidate[] = [];
  const warnings: string[] = [];

  for (const opportunityId of consideredIds) {
    const market = byId.get(opportunityId);
    if (market === undefined) {
      blocked.push({
        opportunityId,
        protocol: null,
        eligibility: evaluateOpportunityEligibility(undefined, opportunityId, holdings),
        reasons: ["opportunity-not-found"]
      });
      continue;
    }

    const opportunity = attachExecutionShapesToOpportunity(market);
    const eligibility = evaluateOpportunityEligibility(
      market,
      opportunity.opportunityId,
      holdings
    );
    const chain = selectEnterChain(opportunity, constraints.noNewBorrows);
    const rejectReasons = constraintRejectReasons(
      opportunity,
      chain,
      request.budget.assetId,
      constraints,
      now
    );

    if (rejectReasons.length > 0 || !eligibility.canEnter) {
      const reasons = [
        ...rejectReasons,
        ...eligibility.reasons,
        ...(eligibility.canEnter ? [] : (["eligibility-gate"] as const))
      ];
      blocked.push({
        opportunityId: opportunity.opportunityId,
        protocol: opportunity.protocol,
        eligibility,
        reasons: unique(reasons)
      });
      continue;
    }

    enterable.push({ opportunity, eligibility, chain });
  }

  enterable.sort((left, right) => {
    if (left.opportunity.apy !== right.opportunity.apy) {
      return right.opportunity.apy - left.opportunity.apy;
    }
    return left.opportunity.opportunityId.localeCompare(right.opportunity.opportunityId);
  });

  const slices = allocateBudget(
    enterable,
    budgetAmount,
    constraints.maxProtocolWeightBps,
    constraints.maxAllocations
  );

  const allocations: PlanAllocation[] = [];
  for (const slice of slices) {
    const compiled = await compileAllocation({
      address: request.address,
      budgetAssetId: request.budget.assetId,
      allocatedAmount: slice.amount,
      weightBps: slice.weightBps,
      candidate: slice.candidate
    });
    const hasCompiledGroup = compiled.allocation.steps.some(
      (step) =>
        step.compileStatus === "compiled" &&
        (step.kind === "enter" || step.kind === "setup")
    );
    if (!hasCompiledGroup) {
      blocked.push({
        opportunityId: compiled.allocation.opportunityId,
        protocol: compiled.allocation.protocol,
        eligibility: compiled.allocation.eligibility,
        reasons: unique([
          "compile-failed",
          ...compiled.allocation.steps.flatMap((step) => step.warnings)
        ])
      });
      warnings.push(
        `Skipped ${compiled.allocation.opportunityId}: no compilable enter group.`
      );
      continue;
    }
    allocations.push(compiled.allocation);
    warnings.push(...compiled.warnings);
  }

  const compiledQuotes = allocations.flatMap((allocation) =>
    allocation.steps
      .map((step) => step.quote)
      .filter((quote): quote is ExecutableQuote => quote !== undefined)
  );
  const expiresAt = resolveExpiry(compiledQuotes, now);
  const networkFee = sumNetworkFees(compiledQuotes);

  if (allocations.length === 0 && blocked.some((row) => row.eligibility.suggestedSwap)) {
    warnings.push(SWAP_COMPOSE_NOTE);
  }

  return {
    data: {
      allocations,
      blocked,
      expectedPositionDelta: buildPositionDelta(allocations, request.budget.assetId),
      fees: {
        x402Usdc: resolvePlanPriceUsdc(),
        estimatedNetworkFeeMicroAlgos: networkFee.toString(),
        estimatedNetworkFeeUsd: null
      },
      expiresAt,
      warnings: unique(warnings)
    },
    meta: {
      address: request.address,
      budget: request.budget,
      fetchedAt: now.toISOString(),
      paymentRequired: true,
      executionSubmitted: false,
      quoteTimeAuthoritative: true,
      eligibilityEndpoint: "/eligibility"
    }
  };
}

interface RankedCandidate {
  opportunity: OpportunityRecordV1;
  eligibility: OpportunityEligibility;
  chain: OpportunityExecutionShape[];
}

interface ResolvedConstraints {
  maxProtocolWeightBps: number;
  noNewBorrows: boolean;
  executionReadyOnly: boolean;
  minTvlUsd?: number;
  maxSourceAgeSeconds?: number;
  maxAllocations: number;
}

function resolveConstraints(input: PlanConstraints | undefined): ResolvedConstraints {
  return {
    maxProtocolWeightBps:
      input?.maxProtocolWeightBps ?? DEFAULT_CONSTRAINTS.maxProtocolWeightBps,
    noNewBorrows: input?.noNewBorrows ?? DEFAULT_CONSTRAINTS.noNewBorrows,
    executionReadyOnly:
      input?.executionReadyOnly ?? DEFAULT_CONSTRAINTS.executionReadyOnly,
    ...(input?.minTvlUsd !== undefined ? { minTvlUsd: input.minTvlUsd } : {}),
    ...(input?.maxSourceAgeSeconds !== undefined
      ? { maxSourceAgeSeconds: input.maxSourceAgeSeconds }
      : {}),
    maxAllocations: input?.maxAllocations ?? DEFAULT_CONSTRAINTS.maxAllocations
  };
}

function parsePositiveAmount(raw: string): bigint {
  const amount = BigInt(raw);
  if (amount <= 0n) {
    throw new PlanValidationError("Budget amount must be greater than zero.");
  }
  return amount;
}

export class PlanValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

function isBorrowShape(shape: OpportunityExecutionShape): boolean {
  return shape.action === "borrow" || shape.shapeKey.includes(":borrow:");
}

function isSetupShape(shape: OpportunityExecutionShape): boolean {
  return shape.action.startsWith("setup") || shape.shapeKey.includes(":setup:");
}

function selectEnterChain(
  opportunity: OpportunityRecordV1,
  noNewBorrows: boolean
): OpportunityExecutionShape[] {
  const shapes = [...opportunity.executionShapes].sort((left, right) => left.order - right.order);
  return noNewBorrows ? shapes.filter((shape) => !isBorrowShape(shape)) : shapes;
}

function acceptsBudgetAsset(
  opportunity: OpportunityRecordV1,
  chain: readonly OpportunityExecutionShape[],
  assetId: number
): boolean {
  const required = chain.flatMap((shape) => shape.requiredAssetIds);
  const ids = required.length > 0 ? required : (opportunity.assetIds ?? []);
  return ids.includes(assetId);
}

function constraintRejectReasons(
  opportunity: OpportunityRecordV1,
  chain: readonly OpportunityExecutionShape[],
  budgetAssetId: number,
  constraints: ResolvedConstraints,
  now: Date
): string[] {
  const reasons: string[] = [];
  if (constraints.executionReadyOnly && !opportunity.executionReady) {
    reasons.push("execution-not-ready");
  }
  if (chain.length === 0) {
    reasons.push(constraints.noNewBorrows ? "no-non-borrow-enter-shapes" : "no-enter-shapes");
  }
  if (!acceptsBudgetAsset(opportunity, chain, budgetAssetId)) {
    reasons.push("budget-asset-mismatch");
  }
  if (constraints.minTvlUsd !== undefined && opportunity.tvlUsd < constraints.minTvlUsd) {
    reasons.push("below-tvl-floor");
  }
  if (constraints.maxSourceAgeSeconds !== undefined) {
    const sourceMs = Date.parse(opportunity.sourceTimestamp);
    if (!Number.isFinite(sourceMs)) {
      reasons.push("source-not-fresh");
    } else {
      const ageSeconds = Math.max(0, (now.getTime() - sourceMs) / 1000);
      if (ageSeconds > constraints.maxSourceAgeSeconds) {
        reasons.push("source-not-fresh");
      }
    }
  }
  return reasons;
}

function allocateBudget(
  candidates: readonly RankedCandidate[],
  budgetAmount: bigint,
  maxProtocolWeightBps: number,
  maxAllocations: number
): Array<{ candidate: RankedCandidate; amount: bigint; weightBps: number }> {
  const slices: Array<{ candidate: RankedCandidate; amount: bigint; weightBps: number }> = [];
  const usedBpsByProtocol = new Map<string, number>();
  let remaining = budgetAmount;

  for (const candidate of candidates) {
    if (slices.length >= maxAllocations || remaining <= 0n) {
      break;
    }
    const used = usedBpsByProtocol.get(candidate.opportunity.protocol) ?? 0;
    const roomBps = maxProtocolWeightBps - used;
    if (roomBps <= 0) {
      continue;
    }
    const cap = (budgetAmount * BigInt(roomBps)) / 10_000n;
    const amount = remaining < cap ? remaining : cap;
    if (amount <= 0n) {
      continue;
    }
    const weightBps =
      budgetAmount === 0n ? 0 : Number((amount * 10_000n) / budgetAmount);
    slices.push({ candidate, amount, weightBps });
    usedBpsByProtocol.set(candidate.opportunity.protocol, used + weightBps);
    remaining -= amount;
  }

  return slices;
}

async function compileAllocation(args: {
  address: string;
  budgetAssetId: number;
  allocatedAmount: bigint;
  weightBps: number;
  candidate: RankedCandidate;
}): Promise<{ allocation: PlanAllocation; warnings: string[] }> {
  const { opportunity, eligibility, chain } = args.candidate;
  const amount = args.allocatedAmount.toString();
  const warnings: string[] = [];
  const steps: PlanStep[] = [];
  const quotes: PlanQuoteRequest[] = [];
  const compiledKeys = new Set<string>();
  let order = 0;

  steps.push({
    kind: "eligibility",
    order,
    compileStatus: eligibility.canEnter ? "compiled" : "blocked",
    warnings: [],
    ...(eligibility.suggestedSwap
      ? { suggestedSwap: eligibility.suggestedSwap }
      : {})
  });
  order += 1;

  if (eligibility.suggestedSwap) {
    steps.push({
      kind: "swap",
      order,
      compileStatus: "hint",
      suggestedSwap: eligibility.suggestedSwap,
      warnings: [SWAP_COMPOSE_NOTE]
    });
    order += 1;
    warnings.push(SWAP_COMPOSE_NOTE);
  }

  for (const shape of chain) {
    const input = buildQuoteInput(
      args.address,
      amount,
      args.budgetAssetId,
      shape
    );
    const quoteRequest: PlanQuoteRequest = {
      shapeKey: shape.shapeKey,
      input: input as PlanQuoteRequest["input"]
    };
    quotes.push(quoteRequest);

    const missing = missingRequiredInputs(shape, input);
    const prerequisites = shape.prerequisiteShapeKeys ?? [];
    const unmetPrereq = prerequisites.filter((key) => !compiledKeys.has(key));
    const kind = isSetupShape(shape) ? "setup" : "enter";

    if (missing.length > 0 || unmetPrereq.length > 0) {
      const deferredWarnings = [
        ...(missing.length > 0
          ? [`Deferred until inputs are known: ${missing.join(", ")}.`]
          : []),
        ...(unmetPrereq.length > 0
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
      const quote = await compileOneQuote(shape.shapeKey, input);
      compiledKeys.add(shape.shapeKey);
      steps.push({
        kind,
        order,
        compileStatus: "compiled",
        shapeKey: shape.shapeKey,
        ...(prerequisites.length > 0 ? { prerequisiteShapeKeys: [...prerequisites] } : {}),
        quoteRequest,
        quote,
        warnings: [...quote.warnings]
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
    allocation: {
      opportunityId: opportunity.opportunityId,
      protocol: opportunity.protocol,
      opportunityType: opportunity.opportunityType,
      assetPair: opportunity.assetPair,
      apy: opportunity.apy,
      allocatedAmount: amount,
      allocatedAssetId: args.budgetAssetId,
      weightBps: args.weightBps,
      eligibility,
      executionShapes: chain,
      steps,
      quotes
    },
    warnings
  };
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
    const value = input[field];
    return value === undefined || value === null || value === "";
  });
}

async function compileOneQuote(
  shapeKey: string,
  input: unknown
): Promise<ExecutableQuote> {
  if (dependencyOverrides?.compileQuote) {
    return dependencyOverrides.compileQuote(shapeKey, input);
  }
  return compileExecutableQuote(executionRegistry, shapeKey, input, {
    network: "mainnet",
    algod: createExecutionAlgodClient()
  });
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

function buildPositionDelta(
  allocations: readonly PlanAllocation[],
  assetId: number
): PlanResponse["data"]["expectedPositionDelta"] {
  const entries = allocations.map((allocation) => ({
    opportunityId: allocation.opportunityId,
    protocol: allocation.protocol,
    assetId,
    amount: allocation.allocatedAmount,
    action: "enter" as const
  }));
  const summary =
    entries.length === 0
      ? "No executable enter allocations. Review blocked[] eligibility gates."
      : entries
          .map(
            (entry) =>
              `Enter ${entry.amount} of asset ${entry.assetId} into ${entry.opportunityId} (${entry.protocol}).`
          )
          .join(" ");
  return { summary, entries };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
