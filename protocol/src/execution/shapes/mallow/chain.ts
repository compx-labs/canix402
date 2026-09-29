import algosdk from "algosdk";
import { SIDE } from "@pdex/sdk/constants";
import {
  accountBytes,
  parseV2OrderState,
  parseV2PositionState,
  v2PositionBoxKey,
  type V2DecodedOrderState
} from "@pdex/sdk/boxes";
import type { ProtocolManifest } from "@pdex/sdk/manifest";

import { MALLOW_USDC_ASSET_ID, type MallowMarketSymbol, type MallowSide } from "./constants.js";

const ORDER_PAGE_LIMIT = 1000;
const ORDER_PAGE_CAP = 32;
const ORDER_NAME_PREFIX = new TextEncoder().encode("o2:");

export interface MallowBoxPage {
  boxes: Array<{ name: Uint8Array; value?: Uint8Array }>;
  nextToken?: string;
}

export interface MallowBoxQuery {
  prefix(prefix: Uint8Array): MallowBoxQuery;
  limit(limit: number): MallowBoxQuery;
  next(token?: string): MallowBoxQuery;
  include(...parts: Array<"values">): MallowBoxQuery;
  do(): Promise<MallowBoxPage>;
}

/** The algod surface used to read Mallow position and order boxes. */
export interface MallowBoxAlgod {
  getApplicationBoxByName(
    appId: number | bigint,
    name: Uint8Array
  ): { do(): Promise<{ value: Uint8Array }> };
  getApplicationBoxes(appId: number | bigint): MallowBoxQuery;
}

export interface MallowChainMarket {
  status: "ok";
  market: MallowMarketSymbol;
  marketId: string;
}

export interface MallowChainPosition {
  positionId: string;
  owner: string;
  market: MallowMarketSymbol;
  marketId: string;
  side: MallowSide;
  sizeUsd: bigint;
  collateralAmount: bigint;
  collateralAssetId: number;
}

export interface MallowChainRead {
  algod?: MallowBoxAlgod;
  markets: ReadonlyArray<MallowChainMarket | { status: "unavailable" }>;
  protocol: ProtocolManifest;
  address: string;
}

let algodOverride: (() => MallowBoxAlgod) | undefined;

export function setMallowAlgodForTests(factory?: () => MallowBoxAlgod): void {
  algodOverride = factory;
}

export function createMallowAlgodClient(): MallowBoxAlgod {
  return new algosdk.Algodv2(
    process.env.X402_ALGOD_TOKEN ?? "",
    trimSlash(process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud"),
    ""
  ) as unknown as MallowBoxAlgod;
}

function mallowAlgod(algod?: MallowBoxAlgod): MallowBoxAlgod {
  return algod ?? (algodOverride ?? createMallowAlgodClient)();
}

/**
 * Open ALGO/BTC USDC perps for one wallet. Each side is one trading-app box.
 * A missing box is an empty position.
 */
export async function readMallowPositionsFromBoxes(
  input: MallowChainRead & { tradingAppId: number }
): Promise<MallowChainPosition[]> {
  if (!Number.isInteger(input.tradingAppId) || input.tradingAppId <= 0) {
    throw new Error("Mallow positions are unavailable.");
  }
  const algod = mallowAlgod(input.algod);
  const ready = input.markets.filter((row): row is MallowChainMarket => row.status === "ok");
  const found = await Promise.all(
    ready.flatMap((market) =>
      (["long", "short"] as const).map((side) => readPositionBox(algod, input, market, side))
    )
  );
  return found.filter((row): row is MallowChainPosition => row !== undefined);
}

/**
 * Resting orders whose OrderOps box name starts with `o2:` plus this owner.
 * Does not call the PEX account order index.
 */
export async function readMallowOrderRecordsFromBoxes(
  input: MallowChainRead & { orderOpsAppId: number }
): Promise<Record<string, unknown>[]> {
  if (!Number.isInteger(input.orderOpsAppId) || input.orderOpsAppId <= 0) {
    throw new Error("Mallow orders are unavailable.");
  }
  const algod = mallowAlgod(input.algod);
  const prefix = orderOwnerPrefix(input.address);
  const records: Record<string, unknown>[] = [];
  let next: string | undefined;
  for (let page = 0; page < ORDER_PAGE_CAP; page += 1) {
    let response: MallowBoxPage;
    try {
      response = await algod
        .getApplicationBoxes(input.orderOpsAppId)
        .prefix(prefix)
        .include("values")
        .limit(ORDER_PAGE_LIMIT)
        .next(next)
        .do();
    } catch (error) {
      throw orderReadError(error);
    }
    for (const box of response.boxes) {
      if (!hasPrefix(box.name, prefix)) {
        continue;
      }
      const value = box.value ?? (await readOrderValue(algod, input.orderOpsAppId, box.name));
      let parsed: V2DecodedOrderState;
      try {
        parsed = parseV2OrderState(asBytes(value), input.protocol);
      } catch (error) {
        throw orderReadError(error);
      }
      records.push(orderRecord(input.address, parsed));
    }
    if (!response.nextToken || response.boxes.length === 0) {
      break;
    }
    if (page + 1 === ORDER_PAGE_CAP) {
      throw new Error("Mallow orders are unavailable.");
    }
    next = response.nextToken;
  }
  return records;
}

async function readPositionBox(
  algod: MallowBoxAlgod,
  input: MallowChainRead & { tradingAppId: number },
  market: MallowChainMarket,
  side: MallowSide
): Promise<MallowChainPosition | undefined> {
  const name = v2PositionBoxKey(
    input.address,
    BigInt(market.marketId),
    MALLOW_USDC_ASSET_ID,
    side === "long" ? SIDE.LONG : SIDE.SHORT
  );
  try {
    const response = await algod.getApplicationBoxByName(input.tradingAppId, name).do();
    const parsed = parseV2PositionState(asBytes(response.value), input.protocol);
    return positionFromParsed(market, side, input.address, parsed);
  } catch (error) {
    if (isMissingBoxError(error)) {
      return undefined;
    }
    throw new Error("Mallow positions are unavailable.", { cause: error });
  }
}

function positionFromParsed(
  market: MallowChainMarket,
  side: MallowSide,
  owner: string,
  parsed: Record<string, bigint>
): MallowChainPosition | undefined {
  const sizeUsd = parsed.size_usd ?? 0n;
  const positionId = parsed.position_id;
  if (sizeUsd <= 0n || positionId === undefined || positionId < 0n) {
    return undefined;
  }
  return {
    positionId: positionId.toString(),
    owner,
    market: market.market,
    marketId: market.marketId,
    side,
    sizeUsd,
    collateralAmount: parsed.collateral_amount ?? 0n,
    collateralAssetId: MALLOW_USDC_ASSET_ID
  };
}

async function readOrderValue(
  algod: MallowBoxAlgod,
  appId: number,
  name: Uint8Array
): Promise<Uint8Array> {
  try {
    const response = await algod.getApplicationBoxByName(appId, name).do();
    return asBytes(response.value);
  } catch (error) {
    throw orderReadError(error);
  }
}

function orderRecord(owner: string, parsed: V2DecodedOrderState): Record<string, unknown> {
  return {
    owner,
    owner_order_id: parsed.owner_order_id.toString(),
    market_id: parsed.market_id.toString(),
    side: Number(parsed.side),
    order_kind: Number(parsed.order_kind),
    size_usd_delta: parsed.size_usd_delta.toString(),
    collateral_amount: parsed.collateral_amount.toString(),
    collateral_asset_id: Number(parsed.collateral_asset_id),
    keeper_fee_amount: parsed.keeper_fee_amount.toString(),
    keeper_fee_asset_id: Number(parsed.keeper_fee_asset_id),
    flags: parsed.flags.toString(),
    schema_version: Number(parsed.schema_version),
    ...("position_id" in parsed && parsed.position_id !== undefined
      ? { position_id: parsed.position_id.toString() }
      : {})
  };
}

export function orderOwnerPrefix(address: string): Uint8Array {
  const owner = accountBytes(address);
  const prefix = new Uint8Array(ORDER_NAME_PREFIX.byteLength + owner.byteLength);
  prefix.set(ORDER_NAME_PREFIX, 0);
  prefix.set(owner, ORDER_NAME_PREFIX.byteLength);
  return prefix;
}

function hasPrefix(name: Uint8Array, prefix: Uint8Array): boolean {
  if (name.byteLength < prefix.byteLength) {
    return false;
  }
  for (let index = 0; index < prefix.byteLength; index += 1) {
    if (name[index] !== prefix[index]) {
      return false;
    }
  }
  return true;
}

function asBytes(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function isMissingBoxError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ("status" in error && error.status === 404) {
    return true;
  }
  if ("statusCode" in error && error.statusCode === 404) {
    return true;
  }
  const response = "response" in error ? error.response : undefined;
  if (
    response &&
    typeof response === "object" &&
    "status" in response &&
    response.status === 404
  ) {
    return true;
  }
  const message = "message" in error ? String(error.message) : "";
  return /box not found|no application box/i.test(message);
}

function orderReadError(error: unknown): Error {
  return new Error("Mallow orders are unavailable.", { cause: error });
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
