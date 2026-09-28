import { pdexBigInt } from "@pdex/sdk";
import { TIME_IN_FORCE, V2_ORDER_KIND } from "@pdex/sdk/constants";
import { formatPrice12, ORACLE_PRICE_SCALE, parsePrice12 } from "@pdex/sdk/oracle";

import type { MallowSide } from "./constants.js";

export const AMOUNT6_SCALE = 1_000_000n;
export const V2_BPS = 10_000n;
/** 1% band around a limit trigger. Longs may fill higher, shorts lower. */
export const OPEN_SLIPPAGE_BPS = 100n;
/** PEX OrderOps floor, quoted as $0.05 USDC (6 decimals). */
export const MIN_KEEPER_FEE_USD = 50_000n;
/** Resting-order keeper bounty, padded above the $0.05 floor. */
export const OPEN_LIMIT_KEEPER_FEE = 51_000n;
export const FALLBACK_OPEN_FEE_BPS = 10n;
export const PEX_MIN_COLLATERAL_USD = 5n;

export { TIME_IN_FORCE, V2_ORDER_KIND };

export function dollarsToAmount6(dollars: number): bigint {
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error("Amount must be a positive USD value.");
  }
  return BigInt(Math.round(dollars * Number(AMOUNT6_SCALE)));
}

/** Amount6 base units as a USD decimal string, without trailing zeros. */
export function amount6ToDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / AMOUNT6_SCALE;
  const fraction = (absolute % AMOUNT6_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  const text = fraction.length > 0 ? `${whole.toString()}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

/**
 * Human dollars to Price12. Always goes through the SDK decimal parser so a
 * BTC-scale mark is not rounded through a JavaScript number.
 */
export function numberToPrice12(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Price must be a positive USD value.");
  }
  return parsePrice12(value.toFixed(12));
}

export function price12ToDecimal(value: bigint): string {
  return formatPrice12(value);
}

export function price12ToNumber(value: bigint): number | null {
  if (value <= 0n) {
    return null;
  }
  const parsed = Number(formatPrice12(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function maxLeverageFromRaw(raw: Record<string, unknown> | null | undefined): number | null {
  if (!raw) {
    return null;
  }
  const im = initialMarginBpsFromRaw(raw);
  if (im <= 0n) {
    return null;
  }
  const leverage = Number(V2_BPS / im);
  if (!Number.isFinite(leverage) || leverage < 1) {
    return null;
  }
  return Math.floor(leverage);
}

function initialMarginBpsFromRaw(raw: Record<string, unknown>): bigint {
  const direct = pdexBigInt(raw.initial_margin_bps, 0n);
  if (direct > 0n) {
    return direct;
  }
  const nested = raw.risk;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return pdexBigInt((nested as Record<string, unknown>).initial_margin_bps, 0n);
  }
  return 0n;
}

export function openFeeBpsFromRaw(raw: Record<string, unknown>): bigint {
  const bps = pdexBigInt(raw.open_fee_bps, 0n);
  return bps > 0n ? bps : FALLBACK_OPEN_FEE_BPS;
}

export function closeFeeBpsFromRaw(raw: Record<string, unknown>): bigint {
  const bps = pdexBigInt(raw.close_fee_bps, 0n);
  return bps > 0n ? bps : openFeeBpsFromRaw(raw);
}

export interface MarketPriceBand {
  index?: bigint;
  indexMin?: bigint;
  indexMax?: bigint;
  short?: bigint;
  shortMin?: bigint;
}

export function collateralPrice12(input: {
  prices: MarketPriceBand;
  raw: Record<string, unknown>;
}): bigint {
  if (input.prices.shortMin && input.prices.shortMin > 0n) {
    return input.prices.shortMin;
  }
  if (input.prices.short && input.prices.short > 0n) {
    return input.prices.short;
  }
  const min = pdexBigInt(input.raw.short_price_min, 0n);
  if (min > 0n) {
    return min;
  }
  return pdexBigInt(input.raw.short_price, 0n);
}

export function usd6ToCollateralTokens(amountUsd: bigint, collateralPrice: bigint): bigint {
  if (amountUsd <= 0n) {
    return 0n;
  }
  const price = collateralPrice > 0n ? collateralPrice : ORACLE_PRICE_SCALE;
  return (amountUsd * ORACLE_PRICE_SCALE + price - 1n) / price;
}

function maxUsd(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

/**
 * Collateral tokens so remaining USD value after the open fee still meets
 * `equityUsd`, and a $5 floor still clears close fees and the 1% band.
 */
export function collateralForOpenSize(
  sizeUsd: bigint,
  openFeeBps: bigint,
  collateralPrice: bigint = ORACLE_PRICE_SCALE,
  closeFeeBps: bigint = openFeeBps,
  builderFeeBps: bigint = 0n,
  equityUsd: bigint = sizeUsd
): bigint {
  if (sizeUsd <= 0n) {
    return 0n;
  }
  const openFeeUsd = (sizeUsd * openFeeBps) / V2_BPS;
  const openBuilderFeeUsd = (sizeUsd * builderFeeBps) / V2_BPS;
  const closeFeeUsd = (sizeUsd * closeFeeBps) / V2_BPS;
  const closeBuilderFeeUsd = (sizeUsd * builderFeeBps) / V2_BPS;
  const mtmUsd = (sizeUsd * OPEN_SLIPPAGE_BPS) / V2_BPS;
  const minUsd = PEX_MIN_COLLATERAL_USD * AMOUNT6_SCALE;
  const equity = equityUsd > 0n ? equityUsd : sizeUsd;
  const remainingUsd = maxUsd(equity, minUsd + closeFeeUsd + closeBuilderFeeUsd + mtmUsd);
  return (
    usd6ToCollateralTokens(remainingUsd, collateralPrice) +
    usd6ToCollateralTokens(openFeeUsd, collateralPrice) +
    usd6ToCollateralTokens(openBuilderFeeUsd, collateralPrice)
  );
}

export function collateralForOpenTrade(input: {
  raw: Record<string, unknown>;
  prices: MarketPriceBand;
  sizeUsd: bigint;
  equityUsd: bigint;
  builderFeeBps: bigint;
}): bigint {
  const imBps = initialMarginBpsFromRaw(input.raw);
  const imUsd = imBps > 0n ? (input.sizeUsd * imBps) / V2_BPS : 0n;
  const equity = input.equityUsd > imUsd ? input.equityUsd : imUsd;
  return collateralForOpenSize(
    input.sizeUsd,
    openFeeBpsFromRaw(input.raw),
    collateralPrice12(input),
    closeFeeBpsFromRaw(input.raw),
    input.builderFeeBps,
    equity
  );
}

export function acceptablePriceForLimit(side: MallowSide, triggerPrice: bigint): bigint {
  if (triggerPrice <= 0n) {
    return 0n;
  }
  if (side === "long") {
    return (triggerPrice * (V2_BPS + OPEN_SLIPPAGE_BPS)) / V2_BPS;
  }
  return (triggerPrice * (V2_BPS - OPEN_SLIPPAGE_BPS)) / V2_BPS;
}

/** 1% worse than the signed index. A long may fill higher; a short may fill lower. */
export function acceptablePriceForOpen(
  side: MallowSide,
  prices: { index?: bigint; indexMin?: bigint; indexMax?: bigint }
): bigint {
  const positive = (value: bigint | undefined): bigint | undefined =>
    value !== undefined && value > 0n ? value : undefined;
  if (side === "long") {
    const base = positive(prices.indexMax) ?? positive(prices.index) ?? 0n;
    return (base * (V2_BPS + OPEN_SLIPPAGE_BPS)) / V2_BPS;
  }
  const base = positive(prices.indexMin) ?? positive(prices.index) ?? 0n;
  return (base * (V2_BPS - OPEN_SLIPPAGE_BPS)) / V2_BPS;
}

export function acceptablePriceForDecrease(side: MallowSide, triggerPrice: bigint): bigint {
  if (triggerPrice <= 0n) {
    return 0n;
  }
  if (side === "long") {
    return (triggerPrice * (V2_BPS - OPEN_SLIPPAGE_BPS)) / V2_BPS;
  }
  return (triggerPrice * (V2_BPS + OPEN_SLIPPAGE_BPS)) / V2_BPS;
}

export function openLimitCrossed(
  side: MallowSide,
  triggerPrice: bigint,
  indexMin: bigint,
  indexMax: bigint
): boolean {
  if (triggerPrice <= 0n) {
    return false;
  }
  return side === "long" ? indexMax <= triggerPrice : indexMin >= triggerPrice;
}

export function reduceOrderCrossed(
  side: MallowSide,
  kind: "takeProfit" | "stopLoss",
  triggerPrice: bigint,
  indexMin: bigint,
  indexMax: bigint
): boolean {
  if (triggerPrice <= 0n || indexMin <= 0n || indexMax <= 0n) {
    return false;
  }
  if (kind === "takeProfit") {
    return side === "long" ? indexMin >= triggerPrice : indexMax <= triggerPrice;
  }
  return side === "long" ? indexMin <= triggerPrice : indexMax >= triggerPrice;
}

export function protectPriceFromRoi(input: {
  side: MallowSide;
  entry: number;
  leverage: number;
  leg: "takeProfit" | "stopLoss";
  pct: number;
}): number {
  const leverage = Number.isFinite(input.leverage) && input.leverage >= 1 ? input.leverage : 1;
  const profit = input.leg === "takeProfit";
  const direction = profit
    ? input.side === "long"
      ? 1
      : -1
    : input.side === "long"
      ? -1
      : 1;
  return input.entry * (1 + (direction * input.pct) / 100 / leverage);
}

export interface ProtectLegs {
  takeProfit?: number;
  stopLoss?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
}

export function protectLegsFromRoi(input: {
  side: MallowSide;
  entry: number;
  leverage: number;
  takeProfitPct?: number;
  stopLossPct?: number;
}): ProtectLegs {
  const legs: ProtectLegs = {};
  if (input.takeProfitPct != null && input.takeProfitPct > 0) {
    legs.takeProfit = protectPriceFromRoi({
      side: input.side,
      entry: input.entry,
      leverage: input.leverage,
      leg: "takeProfit",
      pct: input.takeProfitPct
    });
    legs.takeProfitPct = input.takeProfitPct;
  }
  if (input.stopLossPct != null && input.stopLossPct > 0) {
    legs.stopLoss = protectPriceFromRoi({
      side: input.side,
      entry: input.entry,
      leverage: input.leverage,
      leg: "stopLoss",
      pct: input.stopLossPct
    });
    legs.stopLossPct = input.stopLossPct;
  }
  return legs;
}

export type ProtectIssue = "tpDirection" | "slDirection" | "slLiq";

export function paperLiquidationPrice(
  side: MallowSide,
  entry: number,
  leverage: number
): number | null {
  if (!(entry > 0)) {
    return null;
  }
  const lev = Number.isFinite(leverage) && leverage >= 1 ? leverage : 1;
  if (side === "long") {
    const price = entry * (1 - 1 / lev);
    return price > 0 ? price : null;
  }
  return entry * (1 + 1 / lev);
}

export function validateProtectLegs(input: {
  side: MallowSide;
  entry: number;
  takeProfit?: number;
  stopLoss?: number;
  liquidation: number | null;
}): ProtectIssue | null {
  const { side, entry, takeProfit, stopLoss, liquidation } = input;
  if (!(entry > 0)) {
    return null;
  }
  if (takeProfit !== undefined) {
    if (side === "long" && !(takeProfit > entry)) {
      return "tpDirection";
    }
    if (side === "short" && !(takeProfit < entry)) {
      return "tpDirection";
    }
  }
  if (stopLoss !== undefined) {
    if (side === "long" && !(stopLoss < entry)) {
      return "slDirection";
    }
    if (side === "short" && !(stopLoss > entry)) {
      return "slDirection";
    }
    if (liquidation !== null && liquidation > 0) {
      if (side === "long" && !(stopLoss > liquidation)) {
        return "slLiq";
      }
      if (side === "short" && !(stopLoss < liquidation)) {
        return "slLiq";
      }
    }
  }
  return null;
}

export function quoteFailureReasons(quote: Record<string, unknown>): string[] | null {
  if (quote.ok === false || quote.ok === "false") {
    const reasons = quote.failure_reasons;
    return Array.isArray(reasons) ? reasons.map(String) : ["quote_rejected"];
  }
  return null;
}

export function firstUsd6(quote: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = quote[key];
    if (raw === undefined || raw === null) {
      continue;
    }
    const amount = pdexBigInt(raw, 0n);
    if (amount > 0n) {
      return Number(amount) / Number(AMOUNT6_SCALE);
    }
  }
  return null;
}

export function keeperFeeAmountForMinUsd(minUsd: bigint, assetMinPrice12: bigint): bigint {
  if (minUsd <= 0n) {
    return 0n;
  }
  if (assetMinPrice12 <= 0n) {
    return minUsd;
  }
  const scaled = (minUsd * ORACLE_PRICE_SCALE + assetMinPrice12 - 1n) / assetMinPrice12;
  return scaled > minUsd ? scaled : minUsd;
}
