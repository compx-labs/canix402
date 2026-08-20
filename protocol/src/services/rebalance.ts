import type { AccountHoldings } from "./account-assets.js";
import { fetchAccountHoldings } from "./account-assets.js";
import {
  fetchOpportunitiesResult,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "./aggregate-opportunities.js";
import { fetchWalletPositions } from "./aggregate-positions.js";
import { projectClaimableRecords } from "./claimable-rewards.js";
import {
  composeCanUnblockEligibility,
  composeEnterSteps,
  selectComposeTargetAsset,
  setComposeDependenciesForTests
} from "./compose.js";
import { evaluateOpportunityEligibility } from "./eligibility.js";
import { attachExecutionShapesToOpportunity } from "./opportunity-execution-shapes.js";
import {
  compileExecutableQuote,
  createExecutionAlgodClient,
  DEFAULT_QUOTE_TTL_MS,
  executionRegistry,
  type ExecutableQuote
} from "../execution/index.js";
import type { ClaimableRewardRecord } from "../types/claimable.js";
import type { OpportunityEligibility } from "../types/eligibility.js";
import type {
  OpportunityExecutionShape,
  OpportunityMarketRecord,
  OpportunityRecordV1
} from "../types/opportunity.js";
import type { PlanQuoteRequest, PlanStep } from "../types/plan.js";
import type { PositionRecordV1 } from "../types/position.js";
import type {
  RebalanceMode,
  RebalanceRequest,
  RebalanceResponse
} from "../types/rebalance.js";
import {
  DEFAULT_ALGO_RESERVE_MICRO,
  DEFAULT_MIN_DELTA_BPS,
  DEFAULT_REBALANCE_PRICE_USDC
} from "../types/rebalance-schema.js";
import type { PlanConstraints } from "../types/plan.js";
import type { HaystackService } from "./haystack-router.js";
import {
  computeRebalanceDeltas,
  resolveIdleAlgoMicro,
  type RebalanceIntent
} from "./rebalance-graph.js";

const DEFAULT_CONSTRAINTS = {
  maxProtocolWeightBps: 10_000,
  noNewBorrows: true,
  executionReadyOnly: true,
  maxAllocations: 1
} as const;

const AMOUNT_INPUT_FIELDS = [
  "amount",
  "assetAmount",
  "assetAAmount",
  "depositAmount",
  "commitAmount",
  "poolTokenAmount",
  "collateralAmount"
] as const;

const EXIT_PROCEEDS_NOTE =
  "Enter is deferred until exit groups confirm. Re-quote via POST /execution/quotes or POST /plans after those submits settle. Groups are never merged.";

export interface RebalanceCompilerDependencies {
  fetchHoldings?: (address: string) => Promise<AccountHoldings>;
  fetchOpportunities?: (refresh: boolean) => Promise<OpportunityMarketRecord[]>;
  fetchPositions?: (address: string) => Promise<PositionRecordV1[]>;
  fetchClaimable?: (
    positions: readonly PositionRecordV1[],
    address: string
  ) => ClaimableRewardRecord[];
  compileQuote?: (shapeKey: string, input: unknown) => Promise<ExecutableQuote>;
  haystack?: HaystackService;
  now?: () => Date;
  priceUsdc?: string;
}

let dependencyOverrides: RebalanceCompilerDependencies | undefined;

export function setRebalanceCompilerDependenciesForTests(
  overrides?: RebalanceCompilerDependencies
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

export function resolveRebalancePriceUsdc(): string {
  return (
    dependencyOverrides?.priceUsdc ??
    process.env.X402_PRICE_PLANS_REBALANCE_USDC ??
    DEFAULT_REBALANCE_PRICE_USDC
  );
}

export class RebalanceValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RebalanceValidationError";
  }
}

export async function compileRebalance(
  request: RebalanceRequest
): Promise<RebalanceResponse> {
  const now = dependencyOverrides?.now?.() ?? new Date();
  const harvestIdle = request.harvestIdle === true;
  const includeClaims = request.includeClaims ?? harvestIdle;
  validateRequest(request, harvestIdle);

  const holdings = dependencyOverrides?.fetchHoldings
    ? await dependencyOverrides.fetchHoldings(request.address)
    : await fetchAccountHoldings(request.address);

  const positions = dependencyOverrides?.fetchPositions
    ? await dependencyOverrides.fetchPositions(request.address)
    : (await fetchWalletPositions(request.address)).data;

  const claimable = dependencyOverrides?.fetchClaimable
    ? dependencyOverrides.fetchClaimable(positions, request.address)
    : projectClaimableRecords(positions, request.address, null);

  const reserve = parseReserve(request.algoReserveMicroAlgos);
  const idleAlgoMicro = resolveIdleAlgoMicro(holdings.balances.get(0) ?? 0n, reserve);
  const minDeltaBps = request.minDeltaBps ?? DEFAULT_MIN_DELTA_BPS;

  const graph = computeRebalanceDeltas({
    positions,
    claimable,
    idleAlgoMicro,
    harvestIdle,
    includeClaims,
    minDeltaBps,
    ...(request.targetWeights ? { targetWeights: request.targetWeights } : {})
  });

  const markets = dependencyOverrides?.fetchOpportunities
    ? await dependencyOverrides.fetchOpportunities(request.refresh === true)
    : (
        await fetchOpportunitiesResult(SUPPORTED_AGGREGATE_PROTOCOLS, {
          refresh: request.refresh === true
        })
      ).data;

  const constraints = resolveConstraints(request.constraints);
  const steps: PlanStep[] = [];
  const quotes: PlanQuoteRequest[] = [];
  const compiledQuotes: ExecutableQuote[] = [];
  const blocked: RebalanceResponse["data"]["blocked"] = [];
  const warnings = [...graph.warnings];
  const positionEntries: RebalanceResponse["data"]["expectedPositionDelta"]["entries"] =
    [];
  let order = 0;

  const compileQuote = dependencyOverrides?.compileQuote ?? compileOneQuote;

  for (const intent of graph.intents) {
    if (intent.kind === "claim") {
      const compiled = await compileClaimStep({
        intent,
        order,
        compileQuote
      });
      steps.push(compiled.step);
      if (compiled.quoteRequest) {
        quotes.push(compiled.quoteRequest);
      }
      if (compiled.quote) {
        compiledQuotes.push(compiled.quote);
      }
      if (compiled.step.compileStatus === "compiled") {
        positionEntries.push({
          opportunityId: intent.opportunityId ?? intent.positionId ?? "claim",
          protocol: intent.protocol ?? "tinyman",
          assetId: intent.assetId ?? 0,
          amount: intent.amountRaw,
          action: "claim"
        });
      }
      warnings.push(...compiled.warnings);
      order += 1;
      continue;
    }

    if (intent.kind === "exit") {
      const compiled = await compileExitStep({
        intent,
        positions,
        address: request.address,
        order,
        compileQuote
      });
      steps.push(compiled.step);
      if (compiled.quoteRequest) {
        quotes.push(compiled.quoteRequest);
      }
      if (compiled.quote) {
        compiledQuotes.push(compiled.quote);
      }
      if (compiled.step.compileStatus === "compiled" && intent.protocol) {
        positionEntries.push({
          opportunityId: intent.opportunityId ?? intent.positionId ?? "exit",
          protocol: intent.protocol,
          assetId: intent.assetId ?? 0,
          amount: intent.amountRaw,
          action: "exit"
        });
      }
      warnings.push(...compiled.warnings);
      order += 1;
      continue;
    }

    const enterResult = await compileEnterIntent({
      intent,
      request,
      holdings,
      markets,
      constraints,
      order,
      now
    });
    steps.push(...enterResult.steps);
    quotes.push(...enterResult.quotes);
    compiledQuotes.push(...enterResult.compiledQuotes);
    blocked.push(...enterResult.blocked);
    warnings.push(...enterResult.warnings);
    positionEntries.push(...enterResult.entries);
    order = enterResult.nextOrder;
  }

  const expiresAt = resolveExpiry(compiledQuotes, now);
  const networkFee = sumNetworkFees(compiledQuotes);

  return {
    data: {
      mode: resolveMode(Boolean(request.targetWeights), harvestIdle),
      book: graph.book,
      steps,
      quotes,
      blocked,
      expectedPositionDelta: buildPositionDelta(positionEntries),
      fees: {
        x402Usdc: resolveRebalancePriceUsdc(),
        estimatedNetworkFeeMicroAlgos: networkFee.toString(),
        estimatedNetworkFeeUsd: null
      },
      expiresAt,
      warnings: unique(warnings)
    },
    meta: {
      address: request.address,
      harvestIdle,
      fetchedAt: now.toISOString(),
      paymentRequired: true,
      executionSubmitted: false,
      quoteTimeAuthoritative: true,
      groupsMerged: false,
      eligibilityEndpoint: "/eligibility"
    }
  };
}

function validateRequest(request: RebalanceRequest, harvestIdle: boolean): void {
  if (!harvestIdle && (request.targetWeights === undefined || request.targetWeights.length === 0)) {
    throw new RebalanceValidationError(
      "Provide targetWeights and/or harvestIdle: true."
    );
  }
  if (request.targetWeights === undefined) {
    return;
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const row of request.targetWeights) {
    if (seen.has(row.opportunityId)) {
      throw new RebalanceValidationError(
        `Duplicate targetWeights opportunityId '${row.opportunityId}'.`
      );
    }
    seen.add(row.opportunityId);
    sum += row.weightBps;
  }
  if (sum !== 10_000) {
    throw new RebalanceValidationError(
      `targetWeights weightBps must sum to 10000 (got ${sum}).`
    );
  }
}

function parseReserve(raw: string | undefined): bigint {
  if (raw === undefined) {
    return BigInt(DEFAULT_ALGO_RESERVE_MICRO);
  }
  try {
    return BigInt(raw);
  } catch {
    throw new RebalanceValidationError(
      "algoReserveMicroAlgos must be a base-unit integer string."
    );
  }
}

function resolveMode(hasTargets: boolean, harvestIdle: boolean): RebalanceMode {
  if (hasTargets && harvestIdle) {
    return "combined";
  }
  return harvestIdle ? "harvest-idle" : "target-weights";
}

async function compileClaimStep(args: {
  intent: RebalanceIntent;
  order: number;
  compileQuote: (shapeKey: string, input: unknown) => Promise<ExecutableQuote>;
}): Promise<{
  step: PlanStep;
  quoteRequest?: PlanQuoteRequest;
  quote?: ExecutableQuote;
  warnings: string[];
}> {
  const { intent, order, compileQuote } = args;
  if (intent.quote === undefined || intent.shapeKey === undefined) {
    return {
      step: {
        kind: "claim",
        order,
        compileStatus: "blocked",
        warnings: ["Claim row is missing a quote input."]
      },
      warnings: ["Claim row is missing a quote input."]
    };
  }
  const quoteRequest: PlanQuoteRequest = {
    shapeKey: intent.shapeKey,
    input: intent.quote.input as PlanQuoteRequest["input"]
  };
  try {
    const quote = await compileQuote(intent.shapeKey, intent.quote.input);
    return {
      step: {
        kind: "claim",
        order,
        compileStatus: "compiled",
        shapeKey: intent.shapeKey,
        quoteRequest,
        quote,
        warnings: [...quote.warnings]
      },
      quoteRequest,
      quote,
      warnings: []
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Failed to compile ${intent.shapeKey}.`;
    return {
      step: {
        kind: "claim",
        order,
        compileStatus: "blocked",
        shapeKey: intent.shapeKey,
        quoteRequest,
        warnings: [message]
      },
      quoteRequest,
      warnings: [message]
    };
  }
}

async function compileExitStep(args: {
  intent: RebalanceIntent;
  positions: readonly PositionRecordV1[];
  address: string;
  order: number;
  compileQuote: (shapeKey: string, input: unknown) => Promise<ExecutableQuote>;
}): Promise<{
  step: PlanStep;
  quoteRequest?: PlanQuoteRequest;
  quote?: ExecutableQuote;
  warnings: string[];
}> {
  const { intent, positions, address, order, compileQuote } = args;
  const shapeKey = intent.shapeKey;
  if (shapeKey === undefined) {
    return {
      step: {
        kind: "exit",
        order,
        compileStatus: "blocked",
        warnings: ["Exit is missing a shapeKey."]
      },
      warnings: ["Exit is missing a shapeKey."]
    };
  }
  const spec = executionRegistry.get(shapeKey);
  const position = positions.find((row) => row.positionId === intent.positionId);
  const input = buildShapeQuoteInput({
    address,
    amount: intent.amountRaw,
    assetId: intent.assetId,
    requiredInputs: spec?.requiredInputs ?? ["userAddress", "amount"],
    hints: position?.inputHints ?? {}
  });
  const quoteRequest: PlanQuoteRequest = {
    shapeKey,
    input: input as PlanQuoteRequest["input"]
  };
  const missing = (spec?.requiredInputs ?? []).filter((field) => {
    const value = input[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    const message = `Deferred until inputs are known: ${missing.join(", ")}.`;
    return {
      step: {
        kind: "exit",
        order,
        compileStatus: "deferred",
        shapeKey,
        quoteRequest,
        warnings: [message]
      },
      quoteRequest,
      warnings: [message]
    };
  }
  try {
    const quote = await compileQuote(shapeKey, input);
    return {
      step: {
        kind: "exit",
        order,
        compileStatus: "compiled",
        shapeKey,
        quoteRequest,
        quote,
        warnings: [...quote.warnings]
      },
      quoteRequest,
      quote,
      warnings: []
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Failed to compile ${shapeKey}.`;
    return {
      step: {
        kind: "exit",
        order,
        compileStatus: "blocked",
        shapeKey,
        quoteRequest,
        warnings: [message]
      },
      quoteRequest,
      warnings: [message]
    };
  }
}

async function compileEnterIntent(args: {
  intent: RebalanceIntent;
  request: RebalanceRequest;
  holdings: AccountHoldings;
  markets: readonly OpportunityMarketRecord[];
  constraints: ResolvedConstraints;
  order: number;
  now: Date;
}): Promise<{
  steps: PlanStep[];
  quotes: PlanQuoteRequest[];
  compiledQuotes: ExecutableQuote[];
  blocked: RebalanceResponse["data"]["blocked"];
  warnings: string[];
  entries: RebalanceResponse["data"]["expectedPositionDelta"]["entries"];
  nextOrder: number;
}> {
  const { intent, request, holdings, markets, constraints, now } = args;
  if (!intent.compileNow) {
    const step: PlanStep = {
      kind: "enter",
      order: args.order,
      compileStatus: "deferred",
      warnings: [EXIT_PROCEEDS_NOTE]
    };
    return {
      steps: [step],
      quotes: [],
      compiledQuotes: [],
      blocked: [],
      warnings: [EXIT_PROCEEDS_NOTE],
      entries: [],
      nextOrder: args.order + 1
    };
  }

  const amount = BigInt(intent.amountRaw);
  if (amount <= 0n) {
    return {
      steps: [],
      quotes: [],
      compiledQuotes: [],
      blocked: [],
      warnings: [],
      entries: [],
      nextOrder: args.order
    };
  }

  const candidates = rankEnterCandidates({
    markets,
    holdings,
    constraints,
    now,
    budgetAssetId: 0,
    ...(intent.opportunityId !== null ? { pinnedIds: [intent.opportunityId] } : {})
  });

  const slices = allocateBudget(
    candidates.enterable,
    amount,
    constraints.maxProtocolWeightBps,
    intent.opportunityId !== null ? 1 : constraints.maxAllocations
  );

  const steps: PlanStep[] = [];
  const quotes: PlanQuoteRequest[] = [];
  const compiledQuotes: ExecutableQuote[] = [];
  const blocked = [...candidates.blocked];
  const warnings: string[] = [];
  const entries: RebalanceResponse["data"]["expectedPositionDelta"]["entries"] = [];
  let order = args.order;

  for (const slice of slices) {
    const composed = await composeEnterSteps({
      address: request.address,
      fromAssetId: 0,
      amount: slice.amount.toString(),
      opportunity: slice.candidate.opportunity,
      eligibility: slice.candidate.eligibility,
      chain: slice.candidate.chain,
      ...(request.swapSlippage !== undefined ? { slippage: request.swapSlippage } : {}),
      ...(dependencyOverrides?.compileQuote
        ? { compileQuote: dependencyOverrides.compileQuote }
        : {}),
      ...(dependencyOverrides?.haystack
        ? { haystack: dependencyOverrides.haystack }
        : {}),
      ...(dependencyOverrides?.now ? { now: dependencyOverrides.now() } : {})
    });
    const remapped = composed.steps.map((step) => ({
      ...step,
      order: order + step.order
    }));
    const lastOrder = remapped.reduce((max, step) => Math.max(max, step.order), order - 1);
    order = lastOrder + 1;
    steps.push(...remapped);
    quotes.push(...composed.quotes);
    compiledQuotes.push(...composed.compiledQuotes);
    warnings.push(...composed.warnings);
    const hasCompiled = remapped.some(
      (step) =>
        step.compileStatus === "compiled" &&
        (step.kind === "enter" ||
          step.kind === "setup" ||
          step.kind === "swap" ||
          step.kind === "opt-in")
    );
    if (hasCompiled) {
      entries.push({
        opportunityId: slice.candidate.opportunity.opportunityId,
        protocol: slice.candidate.opportunity.protocol,
        assetId: composed.enterAssetId,
        amount: composed.enterAmount,
        action: "enter"
      });
    } else {
      blocked.push({
        opportunityId: slice.candidate.opportunity.opportunityId,
        protocol: slice.candidate.opportunity.protocol,
        eligibility: slice.candidate.eligibility,
        reasons: unique([
          "compile-failed",
          ...composed.steps.flatMap((step) => step.warnings)
        ])
      });
    }
  }

  if (intent.opportunityId !== null && slices.length === 0) {
    const blockedRow = candidates.blocked.find(
      (row) => row.opportunityId === intent.opportunityId
    );
    if (blockedRow === undefined) {
      warnings.push(
        `No eligible enter compiled for ${intent.opportunityId}.`
      );
    }
  }

  return {
    steps,
    quotes,
    compiledQuotes,
    blocked,
    warnings,
    entries,
    nextOrder: order
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

function rankEnterCandidates(args: {
  markets: readonly OpportunityMarketRecord[];
  holdings: AccountHoldings;
  constraints: ResolvedConstraints;
  now: Date;
  budgetAssetId: number;
  pinnedIds?: readonly string[];
}): {
  enterable: RankedCandidate[];
  blocked: RebalanceResponse["data"]["blocked"];
} {
  const blocked: RebalanceResponse["data"]["blocked"] = [];
  const enterable: RankedCandidate[] = [];
  const byId = new Map(args.markets.map((row) => [row.opportunityId, row] as const));
  const considered = args.pinnedIds ?? args.markets.map((row) => row.opportunityId);

  for (const opportunityId of considered) {
    const market = byId.get(opportunityId);
    if (market === undefined) {
      blocked.push({
        opportunityId,
        protocol: null,
        eligibility: evaluateOpportunityEligibility(undefined, opportunityId, args.holdings),
        reasons: ["opportunity-not-found"]
      });
      continue;
    }
    const opportunity = attachExecutionShapesToOpportunity(market);
    const eligibility = evaluateOpportunityEligibility(
      market,
      opportunity.opportunityId,
      args.holdings
    );
    const chain = selectEnterChain(opportunity, args.constraints.noNewBorrows);
    const swapTarget = selectComposeTargetAsset(chain, args.budgetAssetId);
    const canCompose =
      swapTarget !== undefined &&
      composeCanUnblockEligibility(eligibility, swapTarget);
    const rejectReasons = constraintRejectReasons(
      opportunity,
      chain,
      args.budgetAssetId,
      args.constraints,
      args.now,
      { skipBudgetMismatch: swapTarget !== undefined }
    );
    if (rejectReasons.length > 0 || (!eligibility.canEnter && !canCompose)) {
      blocked.push({
        opportunityId: opportunity.opportunityId,
        protocol: opportunity.protocol,
        eligibility,
        reasons: unique([
          ...rejectReasons,
          ...eligibility.reasons,
          ...(eligibility.canEnter || canCompose ? [] : (["eligibility-gate"] as const))
        ])
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

  return { enterable, blocked };
}

function selectEnterChain(
  opportunity: OpportunityRecordV1,
  noNewBorrows: boolean
): OpportunityExecutionShape[] {
  const shapes = [...opportunity.executionShapes].sort((left, right) => left.order - right.order);
  return noNewBorrows ? shapes.filter((shape) => !isBorrowShape(shape)) : shapes;
}

function isBorrowShape(shape: OpportunityExecutionShape): boolean {
  return shape.action === "borrow" || shape.shapeKey.includes(":borrow:");
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
  if (!options.skipBudgetMismatch && !acceptsBudgetAsset(opportunity, chain, budgetAssetId)) {
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

function buildShapeQuoteInput(args: {
  address: string;
  amount: string;
  assetId: number | null;
  requiredInputs: readonly string[];
  hints: Record<string, unknown>;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    userAddress: args.address
  };
  for (const [key, value] of Object.entries(args.hints)) {
    if (value !== undefined) {
      input[key] = value;
    }
  }
  for (const field of AMOUNT_INPUT_FIELDS) {
    if (args.requiredInputs.includes(field) && input[field] === undefined) {
      input[field] = args.amount;
    }
  }
  if (args.requiredInputs.includes("assetId") && input.assetId === undefined) {
    input.assetId = args.hints.assetId ?? args.hints.depositAssetId ?? args.assetId ?? 0;
  }
  if (
    args.requiredInputs.includes("depositAssetId") &&
    input.depositAssetId === undefined
  ) {
    input.depositAssetId = args.hints.depositAssetId ?? args.assetId ?? 0;
  }
  return input;
}

async function compileOneQuote(
  shapeKey: string,
  input: unknown
): Promise<ExecutableQuote> {
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
  entries: RebalanceResponse["data"]["expectedPositionDelta"]["entries"]
): RebalanceResponse["data"]["expectedPositionDelta"] {
  const summary =
    entries.length === 0
      ? "No executable delta legs. Review warnings[] and blocked[] gates."
      : entries
          .map(
            (entry) =>
              `${capitalize(entry.action)} ${entry.amount} of asset ${entry.assetId} on ${entry.opportunityId} (${entry.protocol}).`
          )
          .join(" ");
  return { summary, entries };
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
