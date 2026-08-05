import { InvalidShapeInputError } from "../../errors.js";

export const ALGO_ASSET_ID = 0;

export function parseAddress(value: unknown, field = "userAddress"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError(`${field} must be a non-empty string.`);
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError(`${field} must be a valid Algorand address.`);
  }
  return value;
}

export function parseMarketAppId(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError("marketAppId must be a positive integer application id.", {
      marketAppId: value
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

export function parseOptionalPoolId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("poolId must be a non-empty string when provided.");
  }
  return value;
}

export function parseMarketSelector(value: Record<string, unknown>): { marketAppId: number } {
  if (value.marketAppId === undefined) {
    throw new InvalidShapeInputError("marketAppId is required for CompX lending shapes.");
  }
  return { marketAppId: parseMarketAppId(value.marketAppId) };
}

export function parsePoolSelector(value: Record<string, unknown>): { poolAppId: number } {
  if (value.poolAppId === undefined) {
    throw new InvalidShapeInputError("poolAppId is required for CompX staking shapes.");
  }
  return { poolAppId: parsePoolAppId(value.poolAppId) };
}

export function parseOptionalCollateralTokenId(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError(
      "collateralTokenId must be a positive integer asset id when provided.",
      { collateralTokenId: value }
    );
  }
  return numeric;
}
