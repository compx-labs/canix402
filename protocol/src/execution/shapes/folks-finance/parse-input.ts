import { MainnetLoans } from "@folks-finance/algorand-sdk";

import { InvalidShapeInputError } from "../../errors.js";

/** Folks Finance GENERAL loan app id (mainnet). */
export const FOLKS_GENERAL_LOAN_APP_ID = MainnetLoans.GENERAL ?? 971388781;

export function parseAddress(value: unknown, field = "userAddress"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError(`${field} must be a non-empty string.`);
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError(`${field} must be a valid Algorand address.`);
  }
  return value;
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

export function parsePoolAppId(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError("poolAppId must be a positive integer.", {
      poolAppId: value
    });
  }
  return numeric;
}

export function parseAssetId(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 0) {
    throw new InvalidShapeInputError("assetId must be a non-negative integer asset id.", {
      assetId: value
    });
  }
  return numeric;
}

export function parseIncludeOpUp(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== "boolean") {
    throw new InvalidShapeInputError("includeOpUp must be a boolean when provided.", {
      includeOpUp: value
    });
  }
  return value;
}

export function parseAmountDenomination(value: unknown): "asset" | "fAsset" {
  if (value !== "asset" && value !== "fAsset") {
    throw new InvalidShapeInputError('amountDenomination must be "asset" or "fAsset".', {
      amountDenomination: value
    });
  }
  return value;
}

export function parseOptionalEscrowAddress(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseAddress(value, "escrowAddress");
}

export function parseOptionalReceiverAddress(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseAddress(value, "receiverAddress");
}

/** Non-negative base-unit amount; allows 0 (e.g. Folks minReceivedAmount default). */
export function parseNonNegativeBaseUnitAmount(value: unknown, field: string): bigint {
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
      `${field} must be a non-negative integer amount in base units.`,
      { [field]: value }
    );
  }
  if (result < 0n) {
    throw new InvalidShapeInputError(`${field} must be greater than or equal to zero.`, {
      [field]: value
    });
  }
  return result;
}

export function parseOptionalMinReceivedAmount(value: unknown): bigint {
  if (value === undefined) {
    return 0n;
  }
  return parseNonNegativeBaseUnitAmount(value, "minReceivedAmount");
}

export function parseRequiredEscrowAddress(value: unknown): string {
  if (value === undefined) {
    throw new InvalidShapeInputError("escrowAddress is required.");
  }
  return parseAddress(value, "escrowAddress");
}

/** Required loan escrow address (alias for parseRequiredEscrowAddress). */
export function parseEscrowAddress(value: unknown): string {
  return parseRequiredEscrowAddress(value);
}

/**
 * Optional loan app id; defaults to MainnetLoans.GENERAL when omitted.
 */
export function parseLoanAppId(value: unknown): number {
  if (value === undefined) {
    return FOLKS_GENERAL_LOAN_APP_ID;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError("loanAppId must be a positive integer.", {
      loanAppId: value
    });
  }
  return numeric;
}

export function parseOptionalIsStable(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new InvalidShapeInputError("isStable must be a boolean when provided.", {
      isStable: value
    });
  }
  return value;
}

export interface PoolSelectorInput {
  poolAppId?: number;
  assetId?: number;
}

export function parsePoolSelector(raw: Record<string, unknown>): PoolSelectorInput {
  const hasPoolAppId = raw.poolAppId !== undefined;
  const hasAssetId = raw.assetId !== undefined;

  if (hasPoolAppId === hasAssetId) {
    throw new InvalidShapeInputError("Provide exactly one of poolAppId or assetId.");
  }

  if (hasPoolAppId) {
    return { poolAppId: parsePoolAppId(raw.poolAppId) };
  }

  return { assetId: parseAssetId(raw.assetId) };
}
