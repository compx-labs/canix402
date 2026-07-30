import {
  InvalidShapeInputError,
  ShapeBuildError,
  ShapeNotFoundError,
  ShapeStateError,
  ShapeValidationError
} from "./errors.js";
import {
  DEFAULT_QUOTE_TTL_MS,
  ExecutableQuote,
  OpportunityRole,
  ShapeBuildContext,
  TransactionShapeKey,
  TransactionShapeSpec,
  encodeUnsignedTransactionBase64,
  serializeTransaction
} from "./types.js";

/**
 * Map wallet position types onto opportunity types used by shape specs.
 * `staked` matches both staking and farm shapes; callers filter by role.
 */
const POSITION_TYPE_TO_OPPORTUNITY_TYPES: Record<string, readonly string[]> = {
  lp: ["lp"],
  staked: ["staking", "farm"],
  supplied: ["lending"],
  reward: ["staking", "farm", "lending"],
  debt: []
};

/**
 * In-memory registry of verified transaction-shape specs. This is the single
 * source of truth for what Canix is allowed to compile and execute. Only
 * shapes registered here can be turned into executable quotes.
 */
export class TransactionShapeRegistry {
  private readonly shapes = new Map<TransactionShapeKey, TransactionShapeSpec>();

  public register(shape: TransactionShapeSpec): void {
    if (this.shapes.has(shape.key)) {
      throw new Error(`Transaction shape already registered for key "${shape.key}".`);
    }
    this.shapes.set(shape.key, shape);
  }

  public has(key: TransactionShapeKey): boolean {
    return this.shapes.has(key);
  }

  public get(key: TransactionShapeKey): TransactionShapeSpec | undefined {
    return this.shapes.get(key);
  }

  public require(key: TransactionShapeKey): TransactionShapeSpec {
    const shape = this.shapes.get(key);
    if (!shape) {
      throw new ShapeNotFoundError(key);
    }
    return shape;
  }

  public list(): TransactionShapeSpec[] {
    return [...this.shapes.values()];
  }

  public keys(): TransactionShapeKey[] {
    return [...this.shapes.keys()];
  }

  /**
   * Enter shapes for a protocol + opportunity type. Ordering/prerequisites are
   * applied by the opportunity enricher (e.g. Folks multi-step opens).
   */
  public listForOpportunity(
    protocol: string,
    opportunityType: string
  ): TransactionShapeSpec[] {
    return this.list().filter(
      (shape) =>
        shape.identity.protocol === protocol &&
        shape.opportunityRole === "enter" &&
        shape.supportedOpportunityTypes.includes(opportunityType)
    );
  }

  /**
   * Exit and manage shapes compatible with a wallet position type.
   */
  public listForPosition(
    protocol: string,
    positionType: string,
    roles: readonly OpportunityRole[] = ["exit", "manage"]
  ): TransactionShapeSpec[] {
    const opportunityTypes = POSITION_TYPE_TO_OPPORTUNITY_TYPES[positionType] ?? [];
    if (opportunityTypes.length === 0) {
      return [];
    }
    const roleSet = new Set(roles);
    return this.list().filter(
      (shape) =>
        shape.identity.protocol === protocol &&
        roleSet.has(shape.opportunityRole) &&
        shape.supportedOpportunityTypes.some((type) => opportunityTypes.includes(type))
    );
  }
}

/**
 * Compile a raw caller request into a verified, unsigned executable quote.
 *
 * Flow: lookup shape -> parse input -> resolve on-chain state -> build group ->
 * validate against shape invariants -> assemble quote. The group is never
 * signed or submitted here.
 */
export async function compileExecutableQuote(
  registry: TransactionShapeRegistry,
  key: TransactionShapeKey,
  rawInput: unknown,
  context: ShapeBuildContext
): Promise<ExecutableQuote> {
  const shape = registry.require(key);
  const input = shape.parseInput(rawInput);

  let state: unknown;
  try {
    state = await shape.resolveState(context, input);
  } catch (error) {
    if (error instanceof ShapeStateError) {
      throw error;
    }
    throw new ShapeStateError(
      `Failed to resolve on-chain state for shape "${key}".`,
      { cause: error }
    );
  }

  let buildResult;
  try {
    buildResult = await shape.build(context, input, state);
  } catch (error) {
    if (
      error instanceof ShapeBuildError ||
      error instanceof ShapeStateError ||
      error instanceof InvalidShapeInputError
    ) {
      throw error;
    }
    throw new ShapeBuildError(`Failed to build transaction group for shape "${key}".`, {
      cause: error
    });
  }

  const serialized = buildResult.transactions.map((txn) => serializeTransaction(txn));
  const validation = shape.validate(serialized, input, state);

  if (!validation.valid) {
    throw new ShapeValidationError(
      `Generated transaction group failed shape validation for "${key}".`,
      { errors: validation.errors, warnings: validation.warnings }
    );
  }

  const now = context.now?.() ?? Date.now();
  const ttl = context.quoteTtlMs ?? DEFAULT_QUOTE_TTL_MS;
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttl).toISOString();

  const groupTransactions = buildResult.groupTransactions;
  const userSignIndexes =
    groupTransactions === undefined
      ? undefined
      : groupTransactions
          .filter((member) => member.signer === "user")
          .map((member) => member.index);

  const encodedTransactions =
    groupTransactions === undefined
      ? buildResult.transactions.map((txn) => encodeUnsignedTransactionBase64(txn))
      : groupTransactions
          .filter((member) => member.signer === "user")
          .map((member) => member.encodedTransaction);

  return {
    shapeKey: shape.key,
    shapeVersion: shape.shapeVersion,
    identity: shape.identity,
    createdAt,
    expiresAt,
    transactions: serialized,
    encodedTransactions,
    ...(groupTransactions === undefined ? {} : { groupTransactions }),
    ...(userSignIndexes === undefined ? {} : { userSignIndexes }),
    warnings: [...(buildResult.warnings ?? []), ...validation.warnings],
    metadata: buildResult.metadata
  };
}
