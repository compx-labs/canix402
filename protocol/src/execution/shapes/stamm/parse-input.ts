import { InvalidShapeInputError } from "../../errors.js";

export const ALGO_ASSET_ID = 0;
export const MAX_STAMM_TIER_INDEX = 5;
export const MAX_SLIPPAGE_BPS = 10_000;
export const MAX_LEGS = 16;
export const HIGH_SLIPPAGE_BPS = 500;

export function parseAddress(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("userAddress must be a non-empty string.");
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError("userAddress must be a valid Algorand address."); // pragma: allowlist secret
  }
  return value;
}

export function parsePoolAppId(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError("poolAppId must be a positive integer application id.", {
      poolAppId: value
    });
  }
  return numeric;
}

export function parseTierIndex(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isInteger(numeric) ||
    numeric < 0 ||
    numeric > MAX_STAMM_TIER_INDEX
  ) {
    throw new InvalidShapeInputError(
      `tierIndex must be an integer between 0 and ${MAX_STAMM_TIER_INDEX}.`,
      { tierIndex: value }
    );
  }
  return numeric;
}

export function parseAssetId(value: unknown, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0) {
    throw new InvalidShapeInputError(`${field} must be a non-negative integer asset id.`, {
      [field]: value
    });
  }
  return numeric;
}

export function parseOptionalBaseUnitAmount(
  value: unknown,
  field: string
): bigint | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return parseBaseUnitAmount(value, field, { allowZero: true });
}

export function parseBaseUnitAmount(
  value: unknown,
  field: string,
  options: { allowZero?: boolean } = {}
): bigint {
  let result: bigint;
  if (typeof value === "bigint") {
    result = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new InvalidShapeInputError(`${field} must be an integer amount in base units.`, {
        [field]: value
      });
    }
    result = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    result = BigInt(value);
  } else {
    throw new InvalidShapeInputError(
      `${field} must be an integer amount in base units.`,
      { [field]: value }
    );
  }
  if (result < 0n || (!options.allowZero && result <= 0n)) {
    throw new InvalidShapeInputError(
      options.allowZero
        ? `${field} must be greater than or equal to zero.`
        : `${field} must be greater than zero.`,
      { [field]: result.toString() }
    );
  }
  return result;
}

export function parseSlippageBps(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isInteger(numeric) ||
    numeric < 1 ||
    numeric > MAX_SLIPPAGE_BPS
  ) {
    throw new InvalidShapeInputError(
      `maxSlippageBps must be an integer between 1 and ${MAX_SLIPPAGE_BPS}.`,
      { maxSlippageBps: value }
    );
  }
  return numeric;
}

export function parseOptionalMaxLegs(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isInteger(numeric) ||
    numeric < 1 ||
    numeric > MAX_LEGS
  ) {
    throw new InvalidShapeInputError(
      `maxLegs must be an integer between 1 and ${MAX_LEGS}.`,
      { maxLegs: value }
    );
  }
  return numeric;
}

export interface StammExternalInput {
  assetId: number;
  amount: bigint;
}

export function parseExternalInputs(value: unknown): StammExternalInput[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidShapeInputError("externalInputs must be a non-empty array when provided.");
  }
  if (value.length > 2) {
    throw new InvalidShapeInputError("externalInputs supports at most 2 deposits.");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new InvalidShapeInputError(`externalInputs[${index}] must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    return {
      assetId: parseAssetId(row.assetId ?? row.asset_id, `externalInputs[${index}].assetId`),
      amount: parseBaseUnitAmount(
        row.amount,
        `externalInputs[${index}].amount`
      )
    };
  });
}
