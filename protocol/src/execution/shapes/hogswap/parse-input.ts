import { InvalidShapeInputError } from "../../errors.js";

export const ALGO_ASSET_ID = 0;
export const MAX_SLIPPAGE_BPS = 10_000;
export const MAX_HOPS = 4;
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

export function parseAssetId(value: unknown, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0) {
    throw new InvalidShapeInputError(`${field} must be a non-negative integer asset id.`, {
      [field]: value
    });
  }
  return numeric;
}

export function parsePositiveBaseUnitAmount(value: unknown, field: string): bigint {
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
    throw new InvalidShapeInputError(`${field} must be a positive integer amount in base units.`, {
      [field]: value
    });
  }
  if (result <= 0n) {
    throw new InvalidShapeInputError(`${field} must be greater than zero.`, {
      [field]: value
    });
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

export function parseOptionalMaxHops(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isInteger(numeric) ||
    numeric < 1 ||
    numeric > MAX_HOPS
  ) {
    throw new InvalidShapeInputError(
      `maxHops must be an integer between 1 and ${MAX_HOPS}.`,
      { maxHops: value }
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
