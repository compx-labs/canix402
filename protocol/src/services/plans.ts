import type { AccountHoldings } from "./account-assets.js";
import { fetchAccountHoldings } from "./account-assets.js";
import {
  fetchOpportunitiesResult,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "./aggregate-opportunities.js";
import { evaluateOpportunityEligibility } from "./eligibility.js";
import { attachExecutionShapesToOpportunity } from "./opportunity-execution-shapes.js";
import {
  compareOpportunitiesByRiskThenYield,
  finalizeOpportunityRisk,
  indexHealthFactorsFromPositions,
  loadWalletHealthFactors,
  resolveWalletHealthFactor
} from "./opportunity-risk.js";
import {
  DEFAULT_QUOTE_TTL_MS,
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
  PlanRequest,
  PlanResponse
} from "../types/plan.js";
import type { PositionRecordV1 } from "../types/position.js";
import { DEFAULT_PLAN_PRICE_USDC } from "../types/plan-schema.js";
import {
  composeCanUnblockEligibility,
  composeEnterSteps,
  selectComposeTargetAsset,
  setComposeDependenciesForTests
} from "./compose.js";
import type { HaystackService } from "./haystack-router.js";
import {
  executableQuoteToSimulateGroup,
  simulateQuotesForPlan
} from "./simulate.js";
import type { SimulationGroupInput } from "../types/simulate-schema.js";

const DEFAULT_CONSTRAINTS = {
  maxProtocolWeightBps: 10_000,
  noNewBorrows: true,
  executionReadyOnly: true,
  maxAllocations: 1
} as const;

const SWAP_COMPOSE_NOTE =
  "No live Haystack compose was possible for blocked rows (ambiguous requiredAssetIds, capacity, or unresolved gates). Use POST /execution/compose or POST /swaps/quote when a single swap target is known. Quote-time on-chain checks remain authoritative.";

export interface PlanCompilerDependencies {
  fetchHoldings?: (address: string) => Promise<AccountHoldings>;
  fetchOpportunities?: (refresh: boolean) => Promise<OpportunityMarketRecord[]>;
  fetchPositions?: (address: string) => Promise<readonly PositionRecordV1[]>;
  compileQuote?: (shapeKey: string, input: unknown) => Promise<ExecutableQuote>;
  haystack?: HaystackService;
  now?: () => Date;
  priceUsdc?: string;
}

let dependencyOverrides: PlanCompilerDependencies | undefined;

export function setPlanCompilerDependenciesForTests(
  overrides?: PlanCompilerDependencies
): void {
  dependencyOverrides = overrides;
  setComposeDependenciesForTests(
    overrides
      ? {
          ...(overrides.fetchHoldings
            ? { fetchHoldings: overrides.fetchHoldings }
            : {}),
          ...(overrides.fetchOpportunities
            ? { fetchOpportunities: overrides.fetchOpportunities }
            : {}),
          ...(overrides.compileQuote ? { compileQuote: overrides.compileQuote } : {}),
          ...(overrides.haystack ? { haystack: overrides.haystack } : {}),
          ...(overrides.now ? { now: overrides.now } : {})
        }
      : undefined
  );
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

  const healthFactors = dependencyOverrides?.fetchPositions
    ? indexHealthFactorsFromPositions(
        await dependencyOverrides.fetchPositions(request.address)
      )
    : await loadWalletHealthFactors(request.address);

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
    const healthFactor = resolveWalletHealthFactor(opportunity, healthFactors);
    const withRisk: OpportunityRecordV1 = {
      ...opportunity,
      risk: finalizeOpportunityRisk(opportunity, {
        now,
        ...(healthFactor !== undefined ? { healthFactor } : {})
      })
    };
    const eligibility = evaluateOpportunityEligibility(
      market,
      withRisk.opportunityId,
      holdings
    );
    const chain = selectEnterChain(withRisk, constraints.noNewBorrows);
    const swapTarget = selectComposeTargetAsset(chain, request.budget.assetId);
    const canCompose =
      swapTarget !== undefined &&
      composeCanUnblockEligibility(eligibility, swapTarget);
    const rejectReasons = constraintRejectReasons(
      withRisk,
      chain,
      request.budget.assetId,
      constraints,
      now,
      { skipBudgetMismatch: swapTarget !== undefined }
    );

    if (rejectReasons.length > 0 || (!eligibility.canEnter && !canCompose)) {
      const reasons = [
        ...rejectReasons,
        ...eligibility.reasons,
        ...(eligibility.canEnter || canCompose ? [] : (["eligibility-gate"] as const))
      ];
      blocked.push({
        opportunityId: withRisk.opportunityId,
        protocol: withRisk.protocol,
        eligibility,
        reasons: unique(reasons)
      });
      continue;
    }

    enterable.push({ opportunity: withRisk, eligibility, chain });
  }

  enterable.sort((left, right) =>
    compareOpportunitiesByRiskThenYield(left.opportunity, right.opportunity, now)
  );

  const slices = allocateBudget(
    enterable,
    budgetAmount,
    constraints.maxProtocolWeightBps,
    constraints.maxAllocations
  );

  const allocations: PlanAllocation[] = [];
  const positionEntries: PlanResponse["data"]["expectedPositionDelta"]["entries"] = [];
  for (const slice of slices) {
    const compiled = await compileAllocation({
      address: request.address,
      budgetAssetId: request.budget.assetId,
      allocatedAmount: slice.amount,
      weightBps: slice.weightBps,
      candidate: slice.candidate,
      ...(request.swapSlippage !== undefined ? { swapSlippage: request.swapSlippage } : {})
    });
    const hasCompiledGroup = compiled.allocation.steps.some(
      (step) =>
        step.compileStatus === "compiled" &&
        (step.kind === "enter" ||
          step.kind === "setup" ||
          step.kind === "swap" ||
          step.kind === "opt-in")
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
    positionEntries.push({
      opportunityId: compiled.allocation.opportunityId,
      protocol: compiled.allocation.protocol,
      assetId: compiled.enterAssetId,
      amount: compiled.enterAmount,
      action: "enter"
    });
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

  const simulationGroups = collectSimulationGroups(allocations);
  const simulation =
    simulationGroups.length > 0
      ? simulateQuotesForPlan({
          address: request.address,
          groups: simulationGroups,
          holdings,
          now
        })
      : undefined;

  return {
    data: {
      allocations,
      blocked,
      expectedPositionDelta: buildPositionDelta(positionEntries),
      fees: {
        x402Usdc: resolvePlanPriceUsdc(),
        estimatedNetworkFeeMicroAlgos: networkFee.toString(),
        estimatedNetworkFeeUsd: null
      },
      expiresAt,
      warnings: unique(warnings),
      ...(simulation ? { simulation } : {})
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
  now: Date,
  options: { skipBudgetMismatch?: boolean } = {}
): string[] {
  const reasons: string[] = [];
  if (constraints.executionReadyOnly && !opportunity.executionReady) {
    reasons.push("execution-not-ready");
  }
  if (chain.length === 0) {
    reasons.push(constraints.noNewBorrows ? "no-non-borrow-enter-shapes" : "no-enter-shapes");
  }
  if (
    !options.skipBudgetMismatch &&
    !acceptsBudgetAsset(opportunity, chain, budgetAssetId)
  ) {
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
  swapSlippage?: number;
}): Promise<{
  allocation: PlanAllocation;
  warnings: string[];
  enterAssetId: number;
  enterAmount: string;
}> {
  const { opportunity, eligibility, chain } = args.candidate;
  const amount = args.allocatedAmount.toString();
  const composed = await composeEnterSteps({
    address: args.address,
    fromAssetId: args.budgetAssetId,
    amount,
    opportunity,
    eligibility,
    chain,
    ...(args.swapSlippage !== undefined ? { slippage: args.swapSlippage } : {}),
    ...(dependencyOverrides?.compileQuote
      ? { compileQuote: dependencyOverrides.compileQuote }
      : {}),
    ...(dependencyOverrides?.haystack
      ? { haystack: dependencyOverrides.haystack }
      : {}),
    ...(dependencyOverrides?.now ? { now: dependencyOverrides.now() } : {})
  });

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
      tvlUsd: opportunity.tvlUsd,
      sourceTimestamp: opportunity.sourceTimestamp,
      executionReady: opportunity.executionReady,
      risk: opportunity.risk,
      eligibility,
      executionShapes: chain,
      steps: composed.steps,
      quotes: composed.quotes
    },
    warnings: composed.warnings,
    enterAssetId: composed.enterAssetId,
    enterAmount: composed.enterAmount
  };
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
  entries: PlanResponse["data"]["expectedPositionDelta"]["entries"]
): PlanResponse["data"]["expectedPositionDelta"] {
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

function collectSimulationGroups(
  allocations: readonly PlanAllocation[]
): SimulationGroupInput[] {
  const groups: SimulationGroupInput[] = [];
  for (const allocation of allocations) {
    for (const step of allocation.steps) {
      if (step.quote === undefined || step.compileStatus !== "compiled") {
        continue;
      }
      groups.push(
        executableQuoteToSimulateGroup(step.quote, {
          opportunityId: allocation.opportunityId,
          ...(allocation.eligibility.capacity
            ? { capacity: allocation.eligibility.capacity }
            : {})
        })
      );
    }
  }
  return groups;
}
