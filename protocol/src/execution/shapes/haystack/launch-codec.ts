import { HAYSTACK_LAUNCH_SCALE } from "./launch-constants.js";
import { TOKEN_INFO_TYPE, readUint64 } from "./launch-spec.js";

export interface HaystackLaunchTokenInfo {
  version: number;
  tokenNum: number;
  tokenCreator: string;
  bondingTokenId: number;
  virtualTokenReserves: bigint;
  virtualBondingReserves: bigint;
  realTokenReserves: bigint;
  realBondingReserves: bigint;
  initialRealTokenReserves: bigint;
  launchQ: bigint;
  feeBpsPlatform: number;
  feeBpsCreator: number;
  bondingTargetUsd: bigint;
  tokenPriceMultiplier: bigint;
  bondingOn: number;
  assetId: number;
  symbol: string;
  name: string;
  assetUrl: string;
  description: string;
  socialWebsite: string;
  socialX: string;
  socialTelegram: string;
  socialDiscord: string;
  poolAppId: number;
  lpTokenId: number;
}

export function decodeTokenInfoBox(value: Uint8Array): HaystackLaunchTokenInfo {
  const decoded = TOKEN_INFO_TYPE.decode(value) as unknown[];
  return {
    version: firstByte(decoded[0]),
    tokenNum: numberFrom(decoded[1]),
    tokenCreator: String(decoded[2]),
    bondingTokenId: numberFrom(decoded[3]),
    virtualTokenReserves: BigInt(decoded[4] as bigint),
    virtualBondingReserves: BigInt(decoded[5] as bigint),
    realTokenReserves: BigInt(decoded[6] as bigint),
    realBondingReserves: BigInt(decoded[7] as bigint),
    initialRealTokenReserves: BigInt(decoded[8] as bigint),
    launchQ: BigInt(decoded[9] as bigint),
    feeBpsPlatform: numberFrom(decoded[10]),
    feeBpsCreator: numberFrom(decoded[11]),
    bondingTargetUsd: BigInt(decoded[12] as bigint),
    tokenPriceMultiplier: BigInt(decoded[13] as bigint),
    bondingOn: numberFrom(decoded[14]),
    assetId: numberFrom(decoded[15]),
    symbol: bytesToText(decoded[16]),
    name: bytesToText(decoded[17]),
    assetUrl: bytesToText(decoded[18]),
    description: bytesToText(decoded[19]),
    socialWebsite: bytesToText(decoded[20]),
    socialX: bytesToText(decoded[21]),
    socialTelegram: bytesToText(decoded[22]),
    socialDiscord: bytesToText(decoded[23]),
    poolAppId: numberFrom(decoded[24]),
    lpTokenId: numberFrom(decoded[25])
  };
}

export function decodeAssetMapTokenNum(value: Uint8Array): number {
  if (value.length < 8) {
    throw new Error("HayLaunch asset map box is shorter than a uint64.");
  }
  return Number(readUint64(value, value.length - 8));
}

/**
 * Bonding percent from 0 to 100. Sold share of the initial real token reserves.
 */
export function bondingProgressPercent(info: Pick<
  HaystackLaunchTokenInfo,
  "initialRealTokenReserves" | "realTokenReserves"
>): number {
  const initial = info.initialRealTokenReserves;
  if (initial <= 0n) {
    return 0;
  }
  const remaining = info.realTokenReserves < 0n ? 0n : info.realTokenReserves;
  const sold = remaining >= initial ? 0n : initial - remaining;
  const scaled = (sold * 1_000_000n) / initial;
  return Number(scaled) / 10_000;
}

/**
 * Whole bonding-token price of one whole launched token.
 * Both sides use 6 decimals on HayLaunch tokens; `bondingDecimals` adjusts other quote assets.
 */
export function priceInBondingToken(
  info: Pick<HaystackLaunchTokenInfo, "virtualTokenReserves" | "virtualBondingReserves">,
  bondingDecimals = 6
): string {
  if (info.virtualTokenReserves <= 0n) {
    return "0";
  }
  const shift = 6 - bondingDecimals;
  const numerator =
    shift >= 0
      ? info.virtualBondingReserves * 10n ** BigInt(shift)
      : info.virtualBondingReserves / 10n ** BigInt(-shift);
  return ratioDecimal(numerator, info.virtualTokenReserves, 12);
}

/**
 * USD price of one whole launched token.
 * `oraclePrice` is `bondingTokenPrice`: micro-USD per base unit, scaled by 1e9.
 */
export function priceUsd(
  info: Pick<HaystackLaunchTokenInfo, "virtualTokenReserves" | "virtualBondingReserves">,
  oraclePrice: bigint
): string | null {
  if (oraclePrice <= 0n || info.virtualTokenReserves <= 0n) {
    return null;
  }
  return ratioDecimal(
    info.virtualBondingReserves * oraclePrice,
    info.virtualTokenReserves * HAYSTACK_LAUNCH_SCALE,
    12
  );
}

export function multiplierLabel(scaled: bigint): string {
  if (scaled <= 0n) {
    return "0";
  }
  return ratioDecimal(scaled, HAYSTACK_LAUNCH_SCALE, 4);
}

function ratioDecimal(numerator: bigint, denominator: bigint, places: number): string {
  if (denominator === 0n) {
    return "0";
  }
  const scale = 10n ** BigInt(places);
  const scaled = (numerator * scale) / denominator;
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(places, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

function bytesToText(value: unknown): string {
  const bytes = toBytes(value);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end -= 1;
  }
  return Buffer.from(bytes.subarray(0, end)).toString("utf8");
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return Uint8Array.from(value);
  }
  return new Uint8Array();
}

function firstByte(value: unknown): number {
  const bytes = toBytes(value);
  return bytes[0] ?? 0;
}

function numberFrom(value: unknown): number {
  return Number(BigInt(value as bigint | number | string));
}
