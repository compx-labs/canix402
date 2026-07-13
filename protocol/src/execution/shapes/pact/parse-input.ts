import { InvalidShapeInputError } from "../../errors.js";

export const MAX_SLIPPAGE_BPS = 10_000;
export const ALGO_ASSET_ID = 0;

export function parseAddress(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("userAddress must be a non-empty string.");
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError("userAddress must be a valid Algorand address.");
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

export function parsePoolAppId(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError("poolAppId must be a positive integer application id.", {
      poolAppId: value
    });
  }
  return numeric;
}

export function parseBaseUnitAmount(value: unknown, field: string): bigint {
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
      `${field} must be a positive integer amount in base units.`,
      { [field]: value }
    );
  }
  if (result <= 0n) {
    throw new InvalidShapeInputError(`${field} must be greater than zero.`, {
      [field]: value
    });
  }
  return result;
}

/**
 * Pact SDK builders accept JavaScript numbers. Reject amounts that cannot be
 * represented exactly as a safe integer.
 */
export function toSdkAmount(amount: bigint, field: string): number {
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidShapeInputError(
      `${field} exceeds the maximum amount supported by the Pact SDK.`,
      { [field]: amount.toString() }
    );
  }
  return Number(amount);
}

export function parseSlippageBps(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (
    typeof numeric !== "number" ||
    !Number.isInteger(numeric) ||
    numeric < 0 ||
    numeric > MAX_SLIPPAGE_BPS
  ) {
    throw new InvalidShapeInputError(
      `maxSlippageBps must be an integer between 0 and ${MAX_SLIPPAGE_BPS}.`,
      { maxSlippageBps: value }
    );
  }
  return numeric;
}

export function parsePoolId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("poolId must be a non-empty string when provided.");
  }
  return value;
}

/**
 * Convert basis points (Canix convention) to Pact SDK percent slippage.
 * 50 bps -> 0.5 percent.
 */
export function slippageBpsToPct(maxSlippageBps: number): number {
  return maxSlippageBps / 100;
}
