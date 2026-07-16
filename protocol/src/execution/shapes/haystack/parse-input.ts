import { InvalidShapeInputError } from "../../errors.js";

export function parseAddress(value: unknown, field = "userAddress"): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError(`${field} must be a non-empty string.`);
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError(`${field} must be a valid Algorand address.`);
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
