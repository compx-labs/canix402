import { InvalidShapeInputError } from "../../errors.js";
import { isEvmAddress, normalizeEvmAddress } from "../../evm.js";

export function parseEvmAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError(`${field} must be a non-empty EVM address.`);
  }
  if (!isEvmAddress(value)) {
    throw new InvalidShapeInputError(`${field} must be a 20-byte 0x-prefixed address.`);
  }
  return normalizeEvmAddress(value);
}

export function parsePositiveBaseUnitAmount(value: unknown, field: string): bigint {
  let result: bigint;
  if (typeof value === "bigint") {
    result = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new InvalidShapeInputError(`${field} must be a positive integer base-unit amount.`);
    }
    result = BigInt(value);
  } else if (typeof value === "string" && value.trim().length > 0) {
    try {
      result = BigInt(value.trim());
    } catch {
      throw new InvalidShapeInputError(`${field} must be a positive integer base-unit amount.`);
    }
  } else {
    throw new InvalidShapeInputError(`${field} must be a positive integer base-unit amount.`);
  }
  if (result <= 0n) {
    throw new InvalidShapeInputError(`${field} must be a positive integer base-unit amount.`);
  }
  return result;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readOptionalEvmAddress(
  raw: Record<string, unknown>,
  field: string
): string | undefined {
  const value = raw[field];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return parseEvmAddress(value, field);
}
