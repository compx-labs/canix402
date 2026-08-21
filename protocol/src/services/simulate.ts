import algosdk from "algosdk";

import type { AccountHoldings } from "./account-assets.js";
import { fetchAccountHoldings } from "./account-assets.js";
import { fetchWalletPositions } from "./aggregate-positions.js";
import {
  serializeTransaction,
  type SerializedTransaction
} from "../execution/index.js";
import type { OpportunityCapacity } from "../types/opportunity.js";
import type { PositionRecordV1 } from "../types/position.js";
import type { Protocol } from "../routes/schemas.js";
import { SupportedProtocolValues } from "../routes/schemas.js";
import type {
  SimulationBalanceDelta,
  SimulationGroupInput,
  SimulationGroupResult,
  SimulationReason,
  SimulationReasonCode,
  SimulationRequest,
  SimulationResponse,
  SimulationSummary
} from "../types/simulate-schema.js";
import { DEFAULT_SIMULATE_PRICE_USDC } from "../types/simulate-schema.js";
import type { PlanExpectedPositionDelta } from "../types/plan-schema.js";

export const BASE_ACCOUNT_MIN_BALANCE_MICRO = 100_000n;
export const ASSET_OPT_IN_MBR_MICRO = 100_000n;
export const APP_OPT_IN_MBR_MICRO = 100_000n;
/** Fail-closed threshold: borrow is rejected at or below this health factor. */
export const HEALTH_FACTOR_FAIL_CLOSED = 1;
const APP_ON_COMPLETE_OPT_IN = 1;

const PROTOCOL_SET = new Set<string>(SupportedProtocolValues);

export class SimulateValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SimulateValidationError";
  }
}

export interface SimulateServiceDependencies {
  fetchHoldings?: (address: string) => Promise<AccountHoldings>;
  fetchPositions?: (address: string) => Promise<readonly PositionRecordV1[]>;
  now?: () => Date;
  priceUsdc?: string;
}

let dependencyOverrides: SimulateServiceDependencies | undefined;

export function setSimulateDependenciesForTests(
  overrides?: SimulateServiceDependencies
): void {
  dependencyOverrides = overrides;
}

export function resolveSimulatePriceUsdc(): string {
  return (
    dependencyOverrides?.priceUsdc ??
    process.env.X402_PRICE_EXECUTION_SIMULATE_USDC ??
    DEFAULT_SIMULATE_PRICE_USDC
  );
}

export function executableQuoteToSimulateGroup(
  quote: {
    shapeKey: string;
    expiresAt: string;
    identity: NonNullable<SimulationGroupInput["identity"]>;
    transactions: SerializedTransaction[];
    encodedTransactions: string[];
    warnings: string[];
    metadata?: Record<string, unknown>;
  },
  extras: {
    opportunityId?: string;
    capacity?: OpportunityCapacity | null;
  } = {}
): SimulationGroupInput {
  const group: SimulationGroupInput = {
    shapeKey: quote.shapeKey,
    expiresAt: quote.expiresAt,
    identity: quote.identity,
    transactions: quote.transactions,
    encodedTransactions: quote.encodedTransactions,
    warnings: quote.warnings
  };
  if (quote.metadata !== undefined) {
    group.metadata = quote.metadata;
  }
  if (extras.opportunityId !== undefined) {
    group.opportunityId = extras.opportunityId;
  }
  if (extras.capacity) {
    group.capacity = extras.capacity;
  }
  return group;
}

export async function simulateCompiledGroups(
  request: SimulationRequest
): Promise<SimulationResponse> {
  const now = dependencyOverrides?.now?.() ?? new Date();
  if (request.groups.length === 0) {
    throw new SimulateValidationError("Body field 'groups' must contain at least one group.");
  }

  let holdings: AccountHoldings | undefined;
  let holdingsError: string | undefined;
  try {
    holdings = dependencyOverrides?.fetchHoldings
      ? await dependencyOverrides.fetchHoldings(request.address)
      : await fetchAccountHoldings(request.address);
  } catch (error) {
    holdingsError =
      error instanceof Error ? error.message : "Failed to read wallet holdings.";
  }

  const needsHealthFactor = request.groups.some((group) => isBorrowGroup(group));
  const positions = needsHealthFactor
    ? await loadPositions(request.address)
    : [];

  const groupResults: SimulationGroupResult[] = [];
  for (let index = 0; index < request.groups.length; index += 1) {
    const group = request.groups[index]!;
    groupResults.push(
      simulateOneGroup({
        address: request.address,
        group,
        index,
        now,
        positions,
        ...(holdings !== undefined ? { holdings } : {}),
        ...(holdingsError !== undefined ? { holdingsError } : {})
      })
    );
  }

  const summary = assembleSummary(groupResults);
  return {
    data: summary,
    meta: {
      address: request.address,
      fetchedAt: now.toISOString(),
      paymentRequired: true,
      executionSubmitted: false,
      signed: false
    }
  };
}

export function simulateQuotesForPlan(args: {
  address: string;
  groups: readonly SimulationGroupInput[];
  holdings: AccountHoldings;
  positions?: readonly PositionRecordV1[];
  now?: Date;
}): SimulationSummary {
  const now = args.now ?? dependencyOverrides?.now?.() ?? new Date();
  const groupResults = args.groups.map((group, index) =>
    simulateOneGroup({
      address: args.address,
      group,
      index,
      now,
      holdings: args.holdings,
      positions: args.positions ?? []
    })
  );
  return assembleSummary(groupResults);
}

function assembleSummary(groupResults: SimulationGroupResult[]): SimulationSummary {
  const reasons = groupResults.flatMap((group) => group.reasons);
  const balanceDeltas = mergeBalanceDeltas(
    groupResults.flatMap((group) => group.balanceDeltas)
  );
  const positionEntries = groupResults.flatMap(
    (group) => group.expectedPositionDelta.entries
  );
  return {
    wouldSucceed: reasons.length === 0,
    reasons,
    balanceDeltas,
    expectedPositionDelta: buildPositionDelta(positionEntries),
    groups: groupResults,
    signed: false,
    submitted: false
  };
}

function simulateOneGroup(args: {
  address: string;
  group: SimulationGroupInput;
  index: number;
  now: Date;
  holdings?: AccountHoldings;
  holdingsError?: string;
  positions: readonly PositionRecordV1[];
}): SimulationGroupResult {
  const reasons: SimulationReason[] = [];
  const push = (
    code: SimulationReasonCode,
    message: string,
    extras: { assetId?: number; details?: SimulationReason["details"] } = {}
  ): void => {
    const reason: SimulationReason = {
      code,
      message,
      groupIndex: args.index
    };
    if (extras.assetId !== undefined) {
      reason.assetId = extras.assetId;
    }
    if (extras.details !== undefined) {
      reason.details = extras.details;
    }
    reasons.push(reason);
  };

  if (args.holdings === undefined) {
    push(
      "holdings-unavailable",
      args.holdingsError ??
        "Wallet holdings could not be read; simulation fails closed.",
      { details: { wouldSucceed: false } }
    );
  }

  if (isQuoteStale(args.group.expiresAt, args.now)) {
    push("stale-quote", "Quote expiresAt has passed; request a fresh compile.", {
      details: { expiresAt: args.group.expiresAt ?? null }
    });
  }

  const decoded = decodeGroupTransactions(args.group);
  if (decoded.error) {
    push("malformed-group", decoded.error);
  }

  const transactions = decoded.transactions;
  const identity = resolveIdentity(args.group);
  const balances = cloneBalances(args.holdings);
  const optedAssets = new Set(balances.keys());
  let estimatedMinBalance = estimateMinBalance(optedAssets.size);
  const wallet = args.address;

  for (const txn of transactions) {
    applyTransaction({
      txn,
      wallet,
      balances,
      optedAssets,
      onNewAssetOptIn: () => {
        estimatedMinBalance += ASSET_OPT_IN_MBR_MICRO;
      },
      onNewAppOptIn: () => {
        estimatedMinBalance += APP_OPT_IN_MBR_MICRO;
      },
      onNotOptedIn: (assetId) => {
        push(
          "not-opted-in",
          `Wallet is not opted into asset ${assetId}.`,
          { assetId }
        );
      },
      onInsufficient: (assetId, needed, held) => {
        if (assetId === 0) {
          push(
            "min-balance",
            "Predicted ALGO balance is below the spend plus fee for this group.",
            {
              assetId: 0,
              details: { needed, held }
            }
          );
        } else {
          push(
            "insufficient-balance",
            `Predicted balance of asset ${assetId} is below the spend.`,
            { assetId, details: { needed, held } }
          );
        }
      }
    });
  }

  const algoAfter = balances.get(0) ?? 0n;
  if (args.holdings !== undefined && algoAfter < estimatedMinBalance) {
    push(
      "min-balance",
      "Predicted ALGO balance is below the estimated minimum balance after this group.",
      {
        assetId: 0,
        details: {
          after: algoAfter.toString(),
          estimatedMinBalance: estimatedMinBalance.toString()
        }
      }
    );
  }

  if (isBorrowGroup(args.group) && args.holdings !== undefined) {
    const healthFactor = resolveHealthFactor(args.positions, identity.protocol);
    if (healthFactor === undefined || healthFactor <= HEALTH_FACTOR_FAIL_CLOSED) {
      push(
        "health-factor-too-low",
        healthFactor === undefined
          ? "Borrow group cannot be proven safe: wallet health factor is unavailable."
          : `Wallet health factor ${healthFactor} is at or below ${HEALTH_FACTOR_FAIL_CLOSED}.`,
        {
          details: {
            healthFactor: healthFactor ?? null,
            threshold: HEALTH_FACTOR_FAIL_CLOSED
          }
        }
      );
    }
  }

  if (isRetiStakeGroup(args.group, identity)) {
    const capacityReason = capacityFailure(
      args.group.capacity,
      stakeAmountMicro(transactions, wallet)
    );
    if (capacityReason) {
      push("capacity", capacityReason);
    }
  }

  const before = cloneBalances(args.holdings);
  const balanceDeltas = toBalanceDeltas(wallet, before, balances);
  const expectedPositionDelta = buildPositionDelta(
    positionEntriesForGroup(args.group, identity, transactions, wallet)
  );

  const result: SimulationGroupResult = {
    index: args.index,
    wouldSucceed: reasons.length === 0,
    reasons,
    balanceDeltas,
    expectedPositionDelta
  };
  if (args.group.shapeKey !== undefined) {
    result.shapeKey = args.group.shapeKey;
  }
  if (args.group.opportunityId !== undefined) {
    result.opportunityId = args.group.opportunityId;
  }
  return result;
}

function decodeGroupTransactions(group: SimulationGroupInput): {
  transactions: SerializedTransaction[];
  error?: string;
} {
  if (group.transactions && group.transactions.length > 0) {
    return { transactions: group.transactions };
  }
  const encoded = group.encodedTransactions ?? [];
  if (encoded.length === 0) {
    return {
      transactions: [],
      error: "Group has neither transactions nor encodedTransactions."
    };
  }
  const transactions: SerializedTransaction[] = [];
  for (const blob of encoded) {
    try {
      const txn = algosdk.decodeUnsignedTransaction(Buffer.from(blob, "base64"));
      transactions.push(serializeTransaction(txn));
    } catch {
      return {
        transactions: [],
        error: "encodedTransactions could not be decoded as unsigned transaction bytes."
      };
    }
  }
  return { transactions };
}

function isQuoteStale(expiresAt: string | undefined, now: Date): boolean {
  if (expiresAt === undefined) {
    return false;
  }
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires <= now.getTime();
}

function isBorrowGroup(group: SimulationGroupInput): boolean {
  const identity = resolveIdentity(group);
  return identity.action === "borrow" || (group.shapeKey ?? "").includes(":borrow:");
}

function isRetiStakeGroup(
  group: SimulationGroupInput,
  identity: { protocol: string; action: string }
): boolean {
  return (
    identity.protocol === "reti" &&
    (identity.action === "stake" || (group.shapeKey ?? "").includes(":stake:"))
  );
}

function resolveIdentity(group: SimulationGroupInput): {
  protocol: string;
  action: string;
  variant: string;
} {
  if (group.identity) {
    return {
      protocol: group.identity.protocol,
      action: group.identity.action,
      variant: group.identity.variant
    };
  }
  const parts = (group.shapeKey ?? "").split(":");
  return {
    protocol: parts[1] ?? "",
    action: parts[3] ?? "",
    variant: parts[4] ?? ""
  };
}

function cloneBalances(holdings: AccountHoldings | undefined): Map<number, bigint> {
  const balances = new Map<number, bigint>();
  if (holdings === undefined) {
    balances.set(0, 0n);
    return balances;
  }
  for (const [assetId, amount] of holdings.balances) {
    balances.set(assetId, amount);
  }
  if (!balances.has(0)) {
    balances.set(0, 0n);
  }
  return balances;
}

function estimateMinBalance(optedAssetCount: number): bigint {
  const asaCount = BigInt(Math.max(0, optedAssetCount - (optedAssetCount > 0 ? 1 : 0)));
  // Account min-balance plus MBR for opted-in ASAs. ALGO itself is not an ASA.
  return BASE_ACCOUNT_MIN_BALANCE_MICRO + ASSET_OPT_IN_MBR_MICRO * asaCount;
}

function applyTransaction(args: {
  txn: SerializedTransaction;
  wallet: string;
  balances: Map<number, bigint>;
  optedAssets: Set<number>;
  onNewAssetOptIn: () => void;
  onNewAppOptIn: () => void;
  onNotOptedIn: (assetId: number) => void;
  onInsufficient: (assetId: number, needed: string, held: string) => void;
}): void {
  const { txn, wallet, balances, optedAssets } = args;
  const senderIsWallet = txn.sender === wallet;

  if (senderIsWallet) {
    debit(balances, 0, BigInt(txn.fee || "0"), args.onInsufficient);
  }

  if (txn.payment && senderIsWallet) {
    const amount = BigInt(txn.payment.amount || "0");
    debit(balances, 0, amount, args.onInsufficient);
    if (txn.payment.receiver === wallet) {
      credit(balances, 0, amount);
    }
  } else if (txn.payment && txn.payment.receiver === wallet) {
    credit(balances, 0, BigInt(txn.payment.amount || "0"));
  }

  if (txn.assetTransfer) {
    const assetId = Number(txn.assetTransfer.assetIndex);
    const amount = BigInt(txn.assetTransfer.amount || "0");
    const isSelfOptIn =
      amount === 0n &&
      txn.sender === wallet &&
      txn.assetTransfer.receiver === wallet;

    if (isSelfOptIn) {
      if (!optedAssets.has(assetId)) {
        optedAssets.add(assetId);
        if (!balances.has(assetId)) {
          balances.set(assetId, 0n);
        }
        args.onNewAssetOptIn();
      }
      return;
    }

    if (senderIsWallet && amount > 0n) {
      if (!optedAssets.has(assetId)) {
        args.onNotOptedIn(assetId);
      }
      debit(balances, assetId, amount, args.onInsufficient);
    }

    if (txn.assetTransfer.receiver === wallet && amount > 0n) {
      if (!optedAssets.has(assetId) && txn.sender !== wallet) {
        args.onNotOptedIn(assetId);
      }
      credit(balances, assetId, amount);
    }
  }

  if (
    txn.applicationCall &&
    senderIsWallet &&
    txn.applicationCall.onComplete === APP_ON_COMPLETE_OPT_IN
  ) {
    args.onNewAppOptIn();
  }
}

function debit(
  balances: Map<number, bigint>,
  assetId: number,
  amount: bigint,
  onInsufficient: (assetId: number, needed: string, held: string) => void
): void {
  const held = balances.get(assetId) ?? 0n;
  if (held < amount) {
    onInsufficient(assetId, amount.toString(), held.toString());
    balances.set(assetId, 0n);
    return;
  }
  balances.set(assetId, held - amount);
}

function credit(balances: Map<number, bigint>, assetId: number, amount: bigint): void {
  balances.set(assetId, (balances.get(assetId) ?? 0n) + amount);
}

function toBalanceDeltas(
  address: string,
  before: Map<number, bigint>,
  after: Map<number, bigint>
): SimulationBalanceDelta[] {
  const assetIds = new Set([...before.keys(), ...after.keys()]);
  const deltas: SimulationBalanceDelta[] = [];
  for (const assetId of [...assetIds].sort((left, right) => left - right)) {
    const previous = before.get(assetId) ?? 0n;
    const next = after.get(assetId) ?? 0n;
    if (previous === next) {
      continue;
    }
    deltas.push({
      address,
      assetId,
      before: previous.toString(),
      after: next.toString(),
      delta: (next - previous).toString()
    });
  }
  return deltas;
}

function mergeBalanceDeltas(
  deltas: readonly SimulationBalanceDelta[]
): SimulationBalanceDelta[] {
  const byKey = new Map<string, SimulationBalanceDelta>();
  for (const delta of deltas) {
    const key = `${delta.address}:${delta.assetId}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { ...delta });
      continue;
    }
    const after = BigInt(existing.after) + BigInt(delta.delta);
    existing.after = after.toString();
    existing.delta = (after - BigInt(existing.before)).toString();
  }
  return [...byKey.values()];
}

function positionEntriesForGroup(
  group: SimulationGroupInput,
  identity: { protocol: string; action: string },
  transactions: readonly SerializedTransaction[],
  wallet: string
): PlanExpectedPositionDelta["entries"] {
  const protocol = asProtocol(identity.protocol);
  if (protocol === undefined) {
    return [];
  }
  const action = positionAction(identity.action, group.shapeKey);
  if (action === undefined) {
    return [];
  }
  const amount = primaryUserAmount(transactions, wallet);
  if (amount === 0n) {
    return [];
  }
  const assetId = primaryUserAssetId(transactions, wallet);
  const opportunityId =
    group.opportunityId ?? group.shapeKey ?? `${protocol}:${identity.action}`;
  return [
    {
      opportunityId,
      protocol,
      assetId,
      amount: amount.toString(),
      action
    }
  ];
}

function positionAction(
  action: string,
  shapeKey: string | undefined
): "enter" | "exit" | "claim" | undefined {
  const key = `${action}:${shapeKey ?? ""}`.toLowerCase();
  if (
    /(claim|claimrewards)/.test(key)
  ) {
    return "claim";
  }
  if (
    /(unstake|withdraw|remove|redeem|burn|exit|repay|uncommit)/.test(key)
  ) {
    return "exit";
  }
  if (
    /(stake|deposit|addliquidity|mint|enter|commit|borrow)/.test(key)
  ) {
    return "enter";
  }
  return undefined;
}

function primaryUserAmount(
  transactions: readonly SerializedTransaction[],
  wallet: string
): bigint {
  let amount = 0n;
  for (const txn of transactions) {
    if (txn.sender !== wallet) {
      continue;
    }
    if (txn.payment) {
      const value = BigInt(txn.payment.amount || "0");
      if (value > amount) {
        amount = value;
      }
    }
    if (txn.assetTransfer) {
      const value = BigInt(txn.assetTransfer.amount || "0");
      if (value > amount) {
        amount = value;
      }
    }
  }
  return amount;
}

function primaryUserAssetId(
  transactions: readonly SerializedTransaction[],
  wallet: string
): number {
  for (const txn of transactions) {
    if (txn.sender !== wallet) {
      continue;
    }
    if (txn.assetTransfer && BigInt(txn.assetTransfer.amount || "0") > 0n) {
      return Number(txn.assetTransfer.assetIndex);
    }
  }
  return 0;
}

function stakeAmountMicro(
  transactions: readonly SerializedTransaction[],
  wallet: string
): bigint {
  return primaryUserAmount(transactions, wallet);
}

function capacityFailure(
  capacity: OpportunityCapacity | undefined,
  stakeAmount: bigint
): string | undefined {
  if (capacity === undefined) {
    return "Réti stake capacity is unavailable; simulation fails closed.";
  }
  if (capacity.acceptingStake === false) {
    return "Validator is not accepting stake.";
  }
  if (capacity.stakerSlotsRemaining === 0) {
    return "Validator has no remaining staker slots.";
  }
  if (capacity.algoRoomMicroAlgos !== null) {
    try {
      if (BigInt(capacity.algoRoomMicroAlgos) < stakeAmount) {
        return "Stake amount exceeds remaining ALGO room.";
      }
    } catch {
      return "Validator ALGO room could not be parsed; simulation fails closed.";
    }
  }
  return undefined;
}

function resolveHealthFactor(
  positions: readonly PositionRecordV1[],
  protocol: string
): number | undefined {
  const matching = positions.filter((position) => {
    if (protocol && position.protocol !== protocol) {
      return false;
    }
    return position.healthFactor !== undefined && position.healthFactor !== null;
  });
  if (matching.length === 0) {
    return undefined;
  }
  return matching.reduce((lowest, position) => {
    const value = position.healthFactor;
    if (value === undefined || value === null) {
      return lowest;
    }
    return value < lowest ? value : lowest;
  }, Number.POSITIVE_INFINITY);
}

function asProtocol(value: string): Protocol | undefined {
  return PROTOCOL_SET.has(value) ? (value as Protocol) : undefined;
}

function buildPositionDelta(
  entries: PlanExpectedPositionDelta["entries"]
): PlanExpectedPositionDelta {
  const summary =
    entries.length === 0
      ? "No predicted position delta from the compiled groups."
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

async function loadPositions(address: string): Promise<readonly PositionRecordV1[]> {
  if (dependencyOverrides?.fetchPositions) {
    return dependencyOverrides.fetchPositions(address);
  }
  try {
    const response = await fetchWalletPositions(address);
    return response.data;
  } catch {
    return [];
  }
}
