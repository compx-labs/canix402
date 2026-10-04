import {
  decodeUint256,
  encodeAddressArg,
  encodeFunctionData,
  encodeUint256Arg
} from "../execution/evm.js";

/** Deployed LpSugar.all is three arguments. The two-argument form reverts. */
export const SUGAR_ALL_SELECTOR = "48523ff0";
export const SUGAR_COUNT_SELECTOR = "06661abd";
export const SUGAR_WHITELIST_FILTER = 1n;
export const SUGAR_MAX_PAGE = 500;

/** Canonical Multicall3, same address on Base. */
export const BASE_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
/** `tryAggregate(bool,(address,bytes)[])`. */
export const TRY_AGGREGATE_SELECTOR = "bce38bd7";

const WORD = 32;
const LP_HEAD_WORDS = 32;

export class AerodromeSugarDecodeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AerodromeSugarDecodeError";
  }
}

/** Decoded basic-pool fields from one LpSugar `Lp` struct. */
export interface AerodromeLp {
  lp: string;
  symbol: string;
  decimals: number;
  liquidity: bigint;
  /** `0` stable, `-1` volatile, positive tick spacing on Slipstream. */
  type: number;
  token0: string;
  reserve0: bigint;
  staked0: bigint;
  token1: string;
  reserve1: bigint;
  staked1: bigint;
  gauge: string;
  gaugeLiquidity: bigint;
  gaugeAlive: boolean;
  factory: string;
  emissions: bigint;
  emissionsToken: string;
}

export function encodeSugarCountCall(): string {
  return encodeFunctionData(SUGAR_COUNT_SELECTOR);
}

export function encodeSugarAllCall(limit: bigint, offset: bigint): string {
  return encodeFunctionData(SUGAR_ALL_SELECTOR, [
    encodeUint256Arg(limit),
    encodeUint256Arg(offset),
    encodeUint256Arg(SUGAR_WHITELIST_FILTER)
  ]);
}

export function decodeSugarCount(hex: string): bigint {
  return decodeUint256(hex);
}

/**
 * Decode `LpSugar.all` return data. Element offsets are relative to the first
 * byte after the array length word, matching Solidity/Vyper dynamic arrays.
 */
export function decodeLpSugarAll(hex: string): AerodromeLp[] {
  const buf = hexToBuffer(hex);
  if (buf.length < WORD * 2) {
    throw new AerodromeSugarDecodeError("Sugar all() return is too short.");
  }
  const arrayOffset = readOffset(buf, 0, "Sugar all() array offset");
  const length = Number(readWord(buf, arrayOffset));
  if (!Number.isInteger(length) || length < 0 || length > SUGAR_MAX_PAGE) {
    throw new AerodromeSugarDecodeError("Sugar all() length is invalid.");
  }
  const pools: AerodromeLp[] = [];
  for (let index = 0; index < length; index += 1) {
    const relative = readOffset(
      buf,
      arrayOffset + WORD + index * WORD,
      "Sugar pool offset"
    );
    pools.push(decodeLp(buf, arrayOffset + WORD + relative));
  }
  return pools;
}

function decodeLp(buf: Buffer, start: number): AerodromeLp {
  if (start < 0 || start + LP_HEAD_WORDS * WORD > buf.length) {
    throw new AerodromeSugarDecodeError("Sugar pool head is out of range.");
  }
  const symbolOffset = readOffset(buf, start + WORD, "Sugar pool symbol offset");
  return {
    lp: readAddress(buf, start),
    symbol: readString(buf, start + symbolOffset),
    decimals: Number(readWord(buf, start + 2 * WORD)),
    liquidity: readWord(buf, start + 3 * WORD),
    type: signedWord(readWord(buf, start + 4 * WORD)),
    token0: readAddress(buf, start + 7 * WORD),
    reserve0: readWord(buf, start + 8 * WORD),
    staked0: readWord(buf, start + 9 * WORD),
    token1: readAddress(buf, start + 10 * WORD),
    reserve1: readWord(buf, start + 11 * WORD),
    staked1: readWord(buf, start + 12 * WORD),
    gauge: readAddress(buf, start + 13 * WORD),
    gaugeLiquidity: readWord(buf, start + 14 * WORD),
    gaugeAlive: readWord(buf, start + 15 * WORD) !== 0n,
    factory: readAddress(buf, start + 18 * WORD),
    emissions: readWord(buf, start + 19 * WORD),
    emissionsToken: readAddress(buf, start + 20 * WORD)
  };
}

function hexToBuffer(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new AerodromeSugarDecodeError("Sugar return data is not hex.");
  }
  return Buffer.from(clean, "hex");
}

function readWord(buf: Buffer, offset: number): bigint {
  if (offset < 0 || offset + WORD > buf.length) {
    throw new AerodromeSugarDecodeError("Sugar word is out of range.");
  }
  return BigInt(`0x${buf.subarray(offset, offset + WORD).toString("hex")}`);
}

function readOffset(buf: Buffer, offset: number, label: string): number {
  const value = Number(readWord(buf, offset));
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AerodromeSugarDecodeError(`${label} is invalid.`);
  }
  return value;
}

function readAddress(buf: Buffer, offset: number): string {
  return `0x${buf.subarray(offset + 12, offset + WORD).toString("hex")}`;
}

function readString(buf: Buffer, offset: number): string {
  const length = readOffset(buf, offset, "Sugar string length");
  const start = offset + WORD;
  if (start + length > buf.length) {
    throw new AerodromeSugarDecodeError("Sugar string is out of range.");
  }
  return buf.subarray(start, start + length).toString("utf8");
}

function signedWord(value: bigint): number {
  const shifted = value >= 1n << 255n ? value - (1n << 256n) : value;
  return Number(shifted);
}

export interface SugarCall {
  target: string;
  data: string;
}

export interface TryAggregateResult {
  success: boolean;
  returnData: string;
}

/**
 * `tryAggregate(false, calls)`. `requireSuccess` is false so one reverted page
 * does not revert the batch.
 */
export function encodeTryAggregateCall(calls: readonly SugarCall[]): string {
  const tuples = calls.map((call) => {
    const payload = hexToBuffer(call.data);
    const paddedLength = payload.length + ((WORD - (payload.length % WORD)) % WORD);
    const padded = Buffer.alloc(paddedLength);
    payload.copy(padded);
    return Buffer.concat([
      Buffer.from(encodeAddressArg(call.target), "hex"),
      word(64n),
      word(BigInt(payload.length)),
      padded
    ]);
  });

  let cursor = tuples.length * WORD;
  const heads: Buffer[] = [];
  for (const body of tuples) {
    heads.push(word(BigInt(cursor)));
    cursor += body.length;
  }
  const array = Buffer.concat([word(BigInt(tuples.length)), ...heads, ...tuples]);
  const head = Buffer.concat([word(0n), word(64n)]);
  return `0x${TRY_AGGREGATE_SELECTOR}${Buffer.concat([head, array]).toString("hex")}`;
}

/** Decode `tryAggregate` return data. Element offsets follow the ABI dynamic-array rules. */
export function decodeTryAggregate(hex: string): TryAggregateResult[] {
  const buf = hexToBuffer(hex);
  const arrayOffset = readOffset(buf, 0, "Multicall return offset");
  const length = Number(readWord(buf, arrayOffset));
  if (!Number.isInteger(length) || length < 0 || length > 32) {
    throw new AerodromeSugarDecodeError("Multicall return length is invalid.");
  }
  const elementsStart = arrayOffset + WORD;
  const results: TryAggregateResult[] = [];
  for (let index = 0; index < length; index += 1) {
    const relative = readOffset(buf, elementsStart + index * WORD, "Multicall result offset");
    const start = elementsStart + relative;
    const success = readWord(buf, start) !== 0n;
    const dataOffset = readOffset(buf, start + WORD, "Multicall return data offset");
    const dataStart = start + dataOffset;
    const dataLength = readOffset(buf, dataStart, "Multicall return data length");
    const bytes = buf.subarray(dataStart + WORD, dataStart + WORD + dataLength);
    if (bytes.length !== dataLength) {
      throw new AerodromeSugarDecodeError("Multicall return data is out of range.");
    }
    results.push({ success, returnData: `0x${bytes.toString("hex")}` });
  }
  return results;
}

function word(value: bigint): Buffer {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}
