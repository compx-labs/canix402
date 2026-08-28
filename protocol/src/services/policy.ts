import type {
  PolicyDocument,
  PolicyQuoteSubject,
  PolicyReason,
  PolicyReasonCode,
  PolicyValidateRequest,
  PolicyValidateResponse
} from "../types/policy-schema.js";
import { DEFAULT_POLICY_VALIDATE_PRICE_USDC } from "../types/policy-schema.js";

export class PolicyValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

export interface PolicyServiceDependencies {
  now?: () => Date;
  priceUsdc?: string;
}

let dependencyOverrides: PolicyServiceDependencies | undefined;

export function setPolicyDependenciesForTests(
  overrides?: PolicyServiceDependencies
): void {
  dependencyOverrides = overrides;
}

export function resolvePolicyValidatePriceUsdc(): string {
  return (
    dependencyOverrides?.priceUsdc ??
    process.env.X402_PRICE_POLICY_VALIDATE_USDC ??
    DEFAULT_POLICY_VALIDATE_PRICE_USDC
  );
}

interface PolicySubject {
  opportunityId?: string;
  protocol?: string;
  opportunityType?: string;
  weightBps?: number;
  allocatedAmount?: string;
  allocatedAssetId?: number;
  tvlUsd?: number;
  sourceTimestamp?: string;
  executionReady?: boolean;
  canEnter?: boolean;
  eligibilityFullyCheckable?: boolean;
  hasEligibility: boolean;
  shapeKeys: string[];
  actions: string[];
}

export function validatePolicy(request: PolicyValidateRequest): PolicyValidateResponse {
  const now = resolveNow(request.evaluatedAt);
  const subjects = extractSubjects(request);
  const reasons: PolicyReason[] = [];

  if (subjects.length === 0) {
    reasons.push(
      reason("empty-subject", "No plan allocations, quotes, or enter steps to evaluate.")
    );
  } else {
    evaluateProtocolWeight(request.policy, subjects, reasons);
    evaluateReserve(request, subjects, reasons);
    evaluateTvl(request.policy, subjects, reasons);
    evaluateFreshness(request.policy, subjects, now, reasons);
    evaluateBorrows(request.policy, subjects, reasons);
    evaluateExecutionReady(request.policy, subjects, reasons);
    evaluateEligibility(subjects, reasons);
  }

  const evaluatedAt = now.toISOString();
  return {
    data: {
      pass: reasons.length === 0,
      reasons,
      policySchemaVersion: "1.0.0",
      evaluatedAt,
      signed: false,
      submitted: false
    },
    meta: {
      fetchedAt: evaluatedAt,
      paymentRequired: true,
      executionSubmitted: false,
      signed: false,
      quoteTimeAuthoritative: true
    }
  };
}

function resolveNow(evaluatedAt: string | undefined): Date {
  if (evaluatedAt !== undefined) {
    const parsed = Date.parse(evaluatedAt);
    if (!Number.isFinite(parsed)) {
      throw new PolicyValidationError(
        "Body field 'evaluatedAt' must be a valid ISO-8601 timestamp."
      );
    }
    return new Date(parsed);
  }
  return dependencyOverrides?.now?.() ?? new Date();
}

function extractSubjects(request: PolicyValidateRequest): PolicySubject[] {
  const subjects: PolicySubject[] = [];
  if (request.plan !== undefined) {
    subjects.push(...subjectsFromPlan(request.plan));
  }
  if (request.quotes !== undefined) {
    for (const quote of request.quotes) {
      subjects.push(subjectFromQuote(quote));
    }
  }
  return subjects;
}

function subjectsFromPlan(plan: Record<string, unknown>): PolicySubject[] {
  const data = unwrapPlanData(plan);
  const allocations = asObjectArray(data.allocations);
  if (allocations.length > 0) {
    return allocations.map((row) => subjectFromAllocation(row));
  }

  const steps = asObjectArray(data.steps);
  if (steps.length > 0) {
    return steps
      .filter((step) => {
        const kind = asString(step.kind);
        return kind === "enter" || kind === "setup" || kind === "claim" || kind === "exit";
      })
      .map((step) => subjectFromStep(step, data));
  }

  return [];
}

function unwrapPlanData(plan: Record<string, unknown>): Record<string, unknown> {
  const nested = plan.data;
  if (isRecord(nested)) {
    return nested;
  }
  return plan;
}

function subjectFromAllocation(row: Record<string, unknown>): PolicySubject {
  const eligibility = isRecord(row.eligibility) ? row.eligibility : undefined;
  const shapes = asObjectArray(row.executionShapes);
  const steps = asObjectArray(row.steps);
  const quotes = asObjectArray(row.quotes);
  const shapeKeys = unique([
    ...shapes.map((shape) => asString(shape.shapeKey)).filter((value): value is string => Boolean(value)),
    ...steps.map((step) => asString(step.shapeKey)).filter((value): value is string => Boolean(value)),
    ...quotes.map((quote) => asString(quote.shapeKey)).filter((value): value is string => Boolean(value))
  ]);
  const actions = unique([
    ...shapes.map((shape) => asString(shape.action)).filter((value): value is string => Boolean(value)),
    ...steps.flatMap((step) => actionsFromUnknown(step))
  ]);
  const opportunityId = asString(row.opportunityId);
  const protocol = asString(row.protocol);
  const opportunityType = asString(row.opportunityType);
  const weightBps = asInteger(row.weightBps);
  const allocatedAmount = asNumericString(row.allocatedAmount);
  const allocatedAssetId = asInteger(row.allocatedAssetId);
  const tvlUsd = asFiniteNumber(row.tvlUsd);
  const sourceTimestamp = asString(row.sourceTimestamp);

  return {
    ...(opportunityId ? { opportunityId } : {}),
    ...(protocol ? { protocol } : {}),
    ...(opportunityType ? { opportunityType } : {}),
    ...(weightBps !== undefined ? { weightBps } : {}),
    ...(allocatedAmount ? { allocatedAmount } : {}),
    ...(allocatedAssetId !== undefined ? { allocatedAssetId } : {}),
    ...(tvlUsd !== undefined ? { tvlUsd } : {}),
    ...(sourceTimestamp ? { sourceTimestamp } : {}),
    ...(typeof row.executionReady === "boolean" ? { executionReady: row.executionReady } : {}),
    ...(typeof eligibility?.canEnter === "boolean" ? { canEnter: eligibility.canEnter } : {}),
    ...(typeof eligibility?.eligibilityFullyCheckable === "boolean"
      ? { eligibilityFullyCheckable: eligibility.eligibilityFullyCheckable }
      : {}),
    hasEligibility: eligibility !== undefined,
    shapeKeys,
    actions
  };
}

function subjectFromStep(
  step: Record<string, unknown>,
  planData: Record<string, unknown>
): PolicySubject {
  const quoteRequest = isRecord(step.quoteRequest) ? step.quoteRequest : undefined;
  const quote = isRecord(step.quote) ? step.quote : undefined;
  const identity = isRecord(quote?.identity)
    ? quote.identity
    : isRecord(step.identity)
      ? step.identity
      : undefined;
  const input = isRecord(quoteRequest?.input) ? quoteRequest.input : undefined;
  const shapeKey =
    asString(step.shapeKey) ?? asString(quoteRequest?.shapeKey) ?? asString(quote?.shapeKey);
  const protocol =
    asString(step.protocol) ??
    asString(identity?.protocol) ??
    protocolFromShapeKey(shapeKey);
  const allocatedAmount =
    asNumericString(step.allocatedAmount) ??
    asNumericString(input?.amount) ??
    asNumericString(input?.assetAAmount);
  const allocatedAssetId =
    asInteger(step.allocatedAssetId) ??
    asInteger(input?.assetId) ??
    asInteger(input?.depositAssetId) ??
    asInteger(input?.assetAId);
  const opportunityId = asString(step.opportunityId) ?? asString(planData.opportunityId);
  const weightBps = asInteger(step.weightBps);
  const tvlUsd = asFiniteNumber(step.tvlUsd);
  const sourceTimestamp = asString(step.sourceTimestamp);
  const identityAction = asString(identity?.action);

  return {
    ...(opportunityId ? { opportunityId } : {}),
    ...(protocol ? { protocol } : {}),
    ...(weightBps !== undefined ? { weightBps } : {}),
    ...(allocatedAmount ? { allocatedAmount } : {}),
    ...(allocatedAssetId !== undefined ? { allocatedAssetId } : {}),
    ...(tvlUsd !== undefined ? { tvlUsd } : {}),
    ...(sourceTimestamp ? { sourceTimestamp } : {}),
    ...(typeof step.executionReady === "boolean" ? { executionReady: step.executionReady } : {}),
    hasEligibility: false,
    shapeKeys: shapeKey ? [shapeKey] : [],
    actions: unique([
      ...actionsFromUnknown(step),
      ...(identityAction ? [identityAction] : [])
    ])
  };
}

function subjectFromQuote(quote: PolicyQuoteSubject): PolicySubject {
  const eligibility = isRecord(quote.eligibility) ? quote.eligibility : undefined;
  const identity = isRecord(quote.identity) ? quote.identity : undefined;
  const nestedQuote = isRecord(quote.quote) ? quote.quote : undefined;
  const nestedIdentity = isRecord(nestedQuote?.identity) ? nestedQuote.identity : undefined;
  const shapeKey =
    quote.shapeKey ??
    asString(nestedQuote?.shapeKey) ??
    asString(identity?.shapeKey);
  const protocol =
    quote.protocol ??
    asString(identity?.protocol) ??
    asString(nestedIdentity?.protocol) ??
    protocolFromShapeKey(shapeKey);
  const action =
    asString(identity?.action) ??
    asString(nestedIdentity?.action) ??
    actionFromShapeKey(shapeKey);

  return {
    ...(quote.opportunityId ? { opportunityId: quote.opportunityId } : {}),
    ...(protocol ? { protocol } : {}),
    ...(quote.opportunityType ? { opportunityType: quote.opportunityType } : {}),
    ...(quote.weightBps !== undefined ? { weightBps: quote.weightBps } : {}),
    ...(quote.allocatedAmount ? { allocatedAmount: quote.allocatedAmount } : {}),
    ...(quote.allocatedAssetId !== undefined ? { allocatedAssetId: quote.allocatedAssetId } : {}),
    ...(quote.tvlUsd !== undefined ? { tvlUsd: quote.tvlUsd } : {}),
    ...(quote.sourceTimestamp ? { sourceTimestamp: quote.sourceTimestamp } : {}),
    ...(quote.executionReady !== undefined ? { executionReady: quote.executionReady } : {}),
    ...(typeof eligibility?.canEnter === "boolean" ? { canEnter: eligibility.canEnter } : {}),
    ...(typeof eligibility?.eligibilityFullyCheckable === "boolean"
      ? { eligibilityFullyCheckable: eligibility.eligibilityFullyCheckable }
      : {}),
    hasEligibility: eligibility !== undefined,
    shapeKeys: shapeKey ? [shapeKey] : [],
    actions: action ? [action] : []
  };
}

function evaluateProtocolWeight(
  policy: PolicyDocument,
  subjects: readonly PolicySubject[],
  reasons: PolicyReason[]
): void {
  const cap = policy.maxProtocolWeightBps;
  if (cap === undefined) {
    return;
  }

  const missingProtocol = subjects.filter((subject) => !subject.protocol);
  for (const subject of missingProtocol) {
    reasons.push(
      reason(
        "missing-protocol",
        "maxProtocolWeightBps is set but this row has no protocol.",
        subject
      )
    );
  }

  const withProtocol = subjects.filter((subject) => Boolean(subject.protocol));
  if (withProtocol.length === 0) {
    return;
  }

  const weights = deriveProtocolWeights(withProtocol);
  if (weights === undefined) {
    reasons.push(
      reason(
        "missing-weight",
        "maxProtocolWeightBps is set but protocol shares cannot be derived from weightBps or allocatedAmount."
      )
    );
    return;
  }

  for (const [protocol, weightBps] of weights) {
    if (weightBps > cap) {
      reasons.push(
        reason(
          "protocol-weight",
          `Protocol ${protocol} weight ${weightBps} bps exceeds maxProtocolWeightBps ${cap}.`,
          { protocol },
          { weightBps, maxProtocolWeightBps: cap }
        )
      );
    }
  }
}

function deriveProtocolWeights(
  subjects: readonly PolicySubject[]
): Map<string, number> | undefined {
  const allWeighted = subjects.every((subject) => subject.weightBps !== undefined);
  if (allWeighted) {
    const totals = new Map<string, number>();
    for (const subject of subjects) {
      const protocol = subject.protocol!;
      totals.set(protocol, (totals.get(protocol) ?? 0) + (subject.weightBps ?? 0));
    }
    return totals;
  }

  const allAmounts = subjects.every((subject) => subject.allocatedAmount !== undefined);
  if (allAmounts) {
    let total = 0n;
    const byProtocol = new Map<string, bigint>();
    for (const subject of subjects) {
      const amount = BigInt(subject.allocatedAmount!);
      const protocol = subject.protocol!;
      byProtocol.set(protocol, (byProtocol.get(protocol) ?? 0n) + amount);
      total += amount;
    }
    if (total <= 0n) {
      return undefined;
    }
    const totals = new Map<string, number>();
    for (const [protocol, amount] of byProtocol) {
      totals.set(protocol, Number((amount * 10_000n) / total));
    }
    return totals;
  }

  return undefined;
}

function evaluateReserve(
  request: PolicyValidateRequest,
  subjects: readonly PolicySubject[],
  reasons: PolicyReason[]
): void {
  const floorRaw = request.policy.minAlgoReserveMicroAlgos;
  if (floorRaw === undefined) {
    return;
  }

  if (request.walletAlgoMicroAlgos === undefined) {
    reasons.push(
      reason(
        "missing-reserve",
        "minAlgoReserveMicroAlgos is set but walletAlgoMicroAlgos was not supplied. Canix does not look up holdings."
      )
    );
    return;
  }

  let algoOut = 0n;
  for (const subject of subjects) {
    if (subject.allocatedAmount === undefined) {
      continue;
    }
    if (subject.allocatedAssetId === undefined) {
      reasons.push(
        reason(
          "missing-reserve",
          "minAlgoReserveMicroAlgos is set but allocatedAssetId is missing, so ALGO outflow cannot be proven.",
          subject
        )
      );
      return;
    }
    if (subject.allocatedAssetId === 0) {
      algoOut += BigInt(subject.allocatedAmount);
    }
  }

  const networkFee = extractNetworkFee(request.plan);
  const remaining = BigInt(request.walletAlgoMicroAlgos) - algoOut - networkFee;
  const floor = BigInt(floorRaw);
  if (remaining < floor) {
    reasons.push(
      reason(
        "below-reserve",
        `Remaining ALGO ${remaining.toString()} is below minAlgoReserveMicroAlgos ${floorRaw}.`,
        undefined,
        {
          remainingAlgoMicroAlgos: remaining.toString(),
          minAlgoReserveMicroAlgos: floorRaw,
          algoOutflowMicroAlgos: algoOut.toString(),
          estimatedNetworkFeeMicroAlgos: networkFee.toString()
        }
      )
    );
  }
}

function extractNetworkFee(plan: Record<string, unknown> | undefined): bigint {
  if (plan === undefined) {
    return 0n;
  }
  const data = unwrapPlanData(plan);
  const fees = isRecord(data.fees) ? data.fees : isRecord(plan.fees) ? plan.fees : undefined;
  const raw = fees?.estimatedNetworkFeeMicroAlgos;
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) {
    return 0n;
  }
  return BigInt(raw);
}

function evaluateTvl(
  policy: PolicyDocument,
  subjects: readonly PolicySubject[],
  reasons: PolicyReason[]
): void {
  const floor = policy.minTvlUsd;
  if (floor === undefined) {
    return;
  }

  for (const subject of subjects) {
    if (subject.tvlUsd === undefined) {
      reasons.push(
        reason(
          "missing-tvl",
          "minTvlUsd is set but tvlUsd is missing on this row. Canix does not re-quote on-chain.",
          subject
        )
      );
      continue;
    }
    if (subject.tvlUsd < floor) {
      reasons.push(
        reason(
          "below-tvl-floor",
          `tvlUsd ${subject.tvlUsd} is below minTvlUsd ${floor}.`,
          subject,
          { tvlUsd: subject.tvlUsd, minTvlUsd: floor }
        )
      );
    }
  }
}

function evaluateFreshness(
  policy: PolicyDocument,
  subjects: readonly PolicySubject[],
  now: Date,
  reasons: PolicyReason[]
): void {
  const maxAge = policy.maxSourceAgeSeconds;
  if (maxAge === undefined) {
    return;
  }

  for (const subject of subjects) {
    if (subject.sourceTimestamp === undefined) {
      reasons.push(
        reason(
          "missing-freshness",
          "maxSourceAgeSeconds is set but sourceTimestamp is missing on this row. Canix does not re-quote on-chain.",
          subject
        )
      );
      continue;
    }
    const sourceMs = Date.parse(subject.sourceTimestamp);
    if (!Number.isFinite(sourceMs)) {
      reasons.push(
        reason(
          "source-not-fresh",
          "sourceTimestamp is not a parseable timestamp.",
          subject,
          { sourceTimestamp: subject.sourceTimestamp }
        )
      );
      continue;
    }
    const ageSeconds = Math.max(0, (now.getTime() - sourceMs) / 1000);
    if (ageSeconds > maxAge) {
      reasons.push(
        reason(
          "source-not-fresh",
          `sourceTimestamp age ${Math.floor(ageSeconds)}s exceeds maxSourceAgeSeconds ${maxAge}.`,
          subject,
          { ageSeconds: Math.floor(ageSeconds), maxSourceAgeSeconds: maxAge }
        )
      );
    }
  }
}

function evaluateBorrows(
  policy: PolicyDocument,
  subjects: readonly PolicySubject[],
  reasons: PolicyReason[]
): void {
  if (policy.noNewBorrows !== true) {
    return;
  }

  for (const subject of subjects) {
    if (isBorrowSubject(subject)) {
      reasons.push(
        reason(
          "new-borrow",
          "noNewBorrows is set and this row includes a borrow shape.",
          subject,
          {
            shapeKey: subject.shapeKeys.find((key) => key.includes(":borrow:")) ?? null,
            action: subject.actions.find((action) => action === "borrow") ?? null
          }
        )
      );
    }
  }
}

function evaluateExecutionReady(
  policy: PolicyDocument,
  subjects: readonly PolicySubject[],
  reasons: PolicyReason[]
): void {
  if (policy.executionReadyOnly !== true) {
    return;
  }

  for (const subject of subjects) {
    if (subject.executionReady === undefined) {
      reasons.push(
        reason(
          "missing-execution-ready",
          "executionReadyOnly is set but executionReady is missing on this row.",
          subject
        )
      );
      continue;
    }
    if (subject.executionReady === false) {
      reasons.push(
        reason(
          "execution-not-ready",
          "executionReadyOnly is set and this row is not execution-ready.",
          subject
        )
      );
    }
  }
}

function evaluateEligibility(subjects: readonly PolicySubject[], reasons: PolicyReason[]): void {
  for (const subject of subjects) {
    if (!subject.hasEligibility) {
      continue;
    }
    if (subject.eligibilityFullyCheckable === false) {
      reasons.push(
        reason(
          "eligibility-not-fully-checkable",
          "eligibility.eligibilityFullyCheckable is false; do not treat canEnter as proven.",
          subject
        )
      );
    }
    if (subject.canEnter === false) {
      reasons.push(
        reason("blocked-eligibility", "eligibility.canEnter is false.", subject)
      );
    }
  }
}

function isBorrowSubject(subject: PolicySubject): boolean {
  if (subject.actions.some((action) => action === "borrow")) {
    return true;
  }
  return subject.shapeKeys.some((key) => key.includes(":borrow:"));
}

function reason(
  code: PolicyReasonCode,
  message: string,
  subject?: Pick<PolicySubject, "opportunityId" | "protocol">,
  details?: PolicyReason["details"]
): PolicyReason {
  return {
    code,
    message,
    ...(subject?.opportunityId ? { opportunityId: subject.opportunityId } : {}),
    ...(subject?.protocol ? { protocol: subject.protocol } : {}),
    ...(details ? { details } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function asNumericString(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9]+$/.test(value) ? value : undefined;
}

function actionsFromUnknown(value: Record<string, unknown>): string[] {
  const identity = isRecord(value.identity) ? value.identity : undefined;
  const quote = isRecord(value.quote) ? value.quote : undefined;
  const quoteIdentity = isRecord(quote?.identity) ? quote.identity : undefined;
  const action =
    asString(value.action) ?? asString(identity?.action) ?? asString(quoteIdentity?.action);
  return action ? [action] : [];
}

function protocolFromShapeKey(shapeKey: string | undefined): string | undefined {
  if (!shapeKey) {
    return undefined;
  }
  const parts = shapeKey.split(":");
  const protocol = parts[1];
  if (!protocol) {
    return undefined;
  }
  if (protocol === "folks-finance" || protocol === "alpha-arcade" || protocol === "myth-finance") {
    return protocol;
  }
  return protocol;
}

function actionFromShapeKey(shapeKey: string | undefined): string | undefined {
  if (!shapeKey) {
    return undefined;
  }
  const parts = shapeKey.split(":");
  return parts[3];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
