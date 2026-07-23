import algosdk from "algosdk";

import { InvalidShapeInputError } from "../../errors.js";

export function parseRetiAddress(value: unknown, field = "userAddress"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidShapeInputError(`${field} must be a non-empty string.`);
  }
  const address = value.trim();
  if (!algosdk.isValidAddress(address)) {
    throw new InvalidShapeInputError(`${field} is not a valid Algorand address.`);
  }
  return address;
}

export function parseRetiPositiveAmount(value: unknown, field = "amount"): bigint {
  if (typeof value === "bigint") {
    if (value <= 0n) {
      throw new InvalidShapeInputError(`${field} must be a positive integer.`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      throw new InvalidShapeInputError(`${field} must be a positive integer.`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[0-9]+$/.test(trimmed) || trimmed === "0") {
      throw new InvalidShapeInputError(`${field} must be a positive base-unit integer string.`);
    }
    return BigInt(trimmed);
  }
  throw new InvalidShapeInputError(`${field} must be a positive integer.`);
}

export function parseRetiValidatorId(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string"
          ? Number(value.trim())
          : NaN;
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new InvalidShapeInputError("validatorId must be a positive integer.");
  }
  return numeric;
}

export function parseRetiPoolAppId(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string"
          ? Number(value.trim())
          : NaN;
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new InvalidShapeInputError("poolAppId must be a positive integer.");
  }
  return numeric;
}

export function parseOptionalValueToVerify(value: unknown): bigint {
  if (value === undefined || value === null || value === "") {
    return 0n;
  }
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new InvalidShapeInputError("valueToVerify must be >= 0.");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new InvalidShapeInputError("valueToVerify must be a non-negative integer.");
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      throw new InvalidShapeInputError("valueToVerify must be a non-negative integer string.");
    }
    return BigInt(trimmed);
  }
  throw new InvalidShapeInputError("valueToVerify must be a non-negative integer.");
}
