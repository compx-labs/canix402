import algosdk, { Algodv2, Transaction } from "algosdk";

/**
 * Networks Canix is willing to compile executable transaction groups for.
 * Shape keys are network-scoped because app IDs and pool addresses differ
 * between mainnet and testnet.
 */
export type ExecutionNetwork = "mainnet" | "testnet";

/**
 * Protocols that Canix can (eventually) execute against. A protocol appearing
 * here does not imply every action is supported; only actions with a verified
 * transaction-shape spec registered in the registry are executable.
 */
export type ExecutionProtocol =
  | "tinyman"
  | "pact"
  | "folks-finance"
  | "compx"
  | "dorkfi"
  | "haystack";

/**
 * Fully-qualified identity for a transaction shape. The stable string key is
 * derived from these fields via `buildShapeKey`.
 */
export interface TransactionShapeIdentity {
  network: ExecutionNetwork;
  protocol: ExecutionProtocol;
  /** Protocol contract version, e.g. "v2" for Tinyman AMM v2. */
  protocolVersion: string;
  /** Canonical action, e.g. "addLiquidity". */
  action: string;
  /** Action variant, e.g. "flexible" | "initial" | "singleAsset". */
  variant: string;
}

/**
 * Stable, human-readable shape identifier.
 * Format: `${network}:${protocol}:${protocolVersion}:${action}:${variant}`.
 */
export type TransactionShapeKey = string;

/**
 * Where the shape's correctness was verified against. For most protocols this
 * is SDK/API/docs rather than an ARC-56 app spec.
 */
export interface ShapeSourceReference {
  kind: "sdk" | "api" | "docs" | "arc56";
  description: string;
  url?: string;
}

/**
 * Runtime context shared across shape resolution and building.
 */
export interface ShapeBuildContext {
  network: ExecutionNetwork;
  algod: Algodv2;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Quote validity window in milliseconds. Defaults to `DEFAULT_QUOTE_TTL_MS`. */
  quoteTtlMs?: number;
}

/**
 * Output of a shape's build step: the unsigned transaction group plus any
 * build-specific metadata surfaced on the executable quote.
 */
export interface ShapeBuildResult {
  transactions: Transaction[];
  metadata: Record<string, unknown>;
  warnings?: string[];
}

export interface ShapeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * How a shape relates to yield opportunities and wallet positions.
 * - enter: open / deposit / stake into an opportunity
 * - exit: reduce / close / withdraw / unstake
 * - manage: claim rewards and similar non-entry/exit actions
 */
export type OpportunityRole = "enter" | "exit" | "manage";

/**
 * A verified, versioned transaction-shape specification. Implementations must
 * be deterministic given resolved on-chain state: the same inputs and state
 * must always produce the same transaction group.
 */
export interface TransactionShapeSpec<TInput = unknown, TState = unknown> {
  readonly identity: TransactionShapeIdentity;
  readonly key: TransactionShapeKey;
  /** Shape spec version (semver-like), independent of protocol version. */
  readonly shapeVersion: string;
  readonly title: string;
  readonly description: string;
  /** Opportunity types this shape can execute (e.g. "lp"). */
  readonly supportedOpportunityTypes: readonly string[];
  /** Whether this shape opens, exits, or manages a position/opportunity. */
  readonly opportunityRole: OpportunityRole;
  /** Names of required input fields, for discovery and documentation. */
  readonly requiredInputs: readonly string[];
  /** Evidence sources used to verify the shape. */
  readonly sources: readonly ShapeSourceReference[];

  /** Parse and validate raw caller input into a typed input. Throws `InvalidShapeInputError`. */
  parseInput(raw: unknown): TInput;
  /** Resolve current on-chain state required to build the group. */
  resolveState(context: ShapeBuildContext, input: TInput): Promise<TState>;
  /** Build the unsigned transaction group. Must not sign or submit. */
  build(context: ShapeBuildContext, input: TInput, state: TState): Promise<ShapeBuildResult>;
  /** Deterministically validate a serialized group against shape invariants. */
  validate(
    group: readonly SerializedTransaction[],
    input: TInput,
    state: TState
  ): ShapeValidationResult;
}

export interface SerializedPaymentFields {
  receiver: string;
  amount: string;
  closeRemainderTo?: string;
}

export interface SerializedAssetTransferFields {
  assetIndex: string;
  amount: string;
  receiver: string;
  assetSender?: string;
  closeRemainderTo?: string;
}

export interface SerializedBoxReference {
  appIndex: string;
  nameBase64: string;
}

export interface SerializedApplicationCallFields {
  appIndex: string;
  onComplete: number;
  appArgsBase64: string[];
  /** UTF-8 decoding of each app arg where printable, else null. */
  appArgsText: (string | null)[];
  accounts: string[];
  foreignApps: string[];
  foreignAssets: string[];
  boxes: SerializedBoxReference[];
}

/**
 * JSON- and fixture-friendly view of an unsigned transaction. All 64-bit
 * integers are stringified so golden fixtures stay stable and comparable.
 */
export interface SerializedTransaction {
  type: string;
  sender: string;
  fee: string;
  groupPresent: boolean;
  /** Base64-encoded transaction note, when present. */
  noteBase64?: string;
  payment?: SerializedPaymentFields;
  assetTransfer?: SerializedAssetTransferFields;
  applicationCall?: SerializedApplicationCallFields;
}

/**
 * The result of compiling a strategy leg into an executable, verified group.
 * Contains unsigned transactions only; signing is the caller's responsibility.
 */
export interface ExecutableQuote {
  shapeKey: TransactionShapeKey;
  shapeVersion: string;
  identity: TransactionShapeIdentity;
  createdAt: string;
  expiresAt: string;
  /** Structured, fixture-friendly view of the group. */
  transactions: SerializedTransaction[];
  /** Base64-encoded unsigned transactions (msgpack), in group order, for signing. */
  encodedTransactions: string[];
  warnings: string[];
  metadata: Record<string, unknown>;
}

export const DEFAULT_QUOTE_TTL_MS = 30_000;

export function buildShapeKey(identity: TransactionShapeIdentity): TransactionShapeKey {
  return [
    identity.network,
    identity.protocol,
    identity.protocolVersion,
    identity.action,
    identity.variant
  ].join(":");
}

/**
 * Convert an algosdk v3 `Transaction` into a stable, comparable structure.
 * Only the fields relevant to shape validation and fixtures are surfaced.
 */
export function serializeTransaction(txn: Transaction): SerializedTransaction {
  const serialized: SerializedTransaction = {
    type: String(txn.type),
    sender: txn.sender.toString(),
    fee: txn.fee.toString(),
    groupPresent: txn.group !== undefined && txn.group.length > 0
  };

  if (txn.note !== undefined && txn.note.length > 0) {
    serialized.noteBase64 = Buffer.from(txn.note).toString("base64");
  }

  if (txn.payment) {
    serialized.payment = {
      receiver: txn.payment.receiver.toString(),
      amount: txn.payment.amount.toString(),
      ...(txn.payment.closeRemainderTo
        ? { closeRemainderTo: txn.payment.closeRemainderTo.toString() }
        : {})
    };
  }

  if (txn.assetTransfer) {
    serialized.assetTransfer = {
      assetIndex: txn.assetTransfer.assetIndex.toString(),
      amount: txn.assetTransfer.amount.toString(),
      receiver: txn.assetTransfer.receiver.toString(),
      ...(txn.assetTransfer.assetSender
        ? { assetSender: txn.assetTransfer.assetSender.toString() }
        : {}),
      ...(txn.assetTransfer.closeRemainderTo
        ? { closeRemainderTo: txn.assetTransfer.closeRemainderTo.toString() }
        : {})
    };
  }

  if (txn.applicationCall) {
    const appArgs = txn.applicationCall.appArgs ?? [];
    serialized.applicationCall = {
      appIndex: txn.applicationCall.appIndex.toString(),
      onComplete: Number(txn.applicationCall.onComplete),
      appArgsBase64: appArgs.map((arg) => Buffer.from(arg).toString("base64")),
      appArgsText: appArgs.map((arg) => decodePrintableUtf8(arg)),
      accounts: (txn.applicationCall.accounts ?? []).map((account) => account.toString()),
      foreignApps: (txn.applicationCall.foreignApps ?? []).map((app) => app.toString()),
      foreignAssets: (txn.applicationCall.foreignAssets ?? []).map((asset) => asset.toString()),
      boxes: (txn.applicationCall.boxes ?? []).map((box) => ({
        appIndex: box.appIndex.toString(),
        nameBase64: Buffer.from(box.name).toString("base64")
      }))
    };
  }

  return serialized;
}

export function encodeUnsignedTransactionBase64(txn: Transaction): string {
  return Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString("base64");
}

function decodePrintableUtf8(bytes: Uint8Array): string | null {
  try {
    const text = Buffer.from(bytes).toString("utf8");
    // Reject values that contain control characters (other than none), since
    // those are almost certainly packed integers rather than method names.
    if (text.length === 0 || /[\u0000-\u0008\u000e-\u001f]/.test(text)) {
      return null;
    }
    return text;
  } catch {
    return null;
  }
}
