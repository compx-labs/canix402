import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import { MALLOW_MARKETS, MALLOW_BUILDER_FEE_BPS, MALLOW_OPEN_LIMIT_SHAPE_KEY, MALLOW_USDC_ASSET_ID } from "../execution/shapes/mallow/constants.js";
import { loadMallowBookForRequest, readyMarket, type MallowMarketRow } from "../execution/shapes/mallow/book.js";
import { price12ToDecimal } from "../execution/shapes/mallow/math.js";
import type { ApiSuccess } from "../types/index.js";

export interface MallowMarketSnapshot {
  market: "ALGO" | "BTC";
  status: "ok" | "unavailable";
  symbol: string | null;
  marketId: string | null;
  indexPriceUsd: string | null;
  maxLeverage: number | null;
  collateralAssetId: number;
  builderFeeBps: number;
  shapeKey: string;
  reason: string | null;
}

export interface MallowMarketsData {
  markets: MallowMarketSnapshot[];
  collateralAssetId: number;
  builderFeeBps: number;
  shapeKey: string;
}

const MallowMarketSnapshotSchema = Type.Object({
  market: Type.Union([Type.Literal("ALGO"), Type.Literal("BTC")]),
  status: Type.Union([Type.Literal("ok"), Type.Literal("unavailable")]),
  symbol: Type.Union([Type.String(), Type.Null()]),
  marketId: Type.Union([Type.String(), Type.Null()]),
  indexPriceUsd: Type.Union([Type.String(), Type.Null()]),
  maxLeverage: Type.Union([Type.Integer(), Type.Null()]),
  collateralAssetId: Type.Integer(),
  builderFeeBps: Type.Integer(),
  shapeKey: Type.String(),
  reason: Type.Union([Type.String(), Type.Null()])
});

const MallowMarketsResponseSchema = Type.Object({
  data: Type.Object({
    markets: Type.Array(MallowMarketSnapshotSchema),
    collateralAssetId: Type.Integer(),
    builderFeeBps: Type.Integer(),
    shapeKey: Type.String()
  })
});

function presentMarket(row: MallowMarketRow): MallowMarketSnapshot {
  const shared = {
    market: row.market,
    collateralAssetId: MALLOW_USDC_ASSET_ID,
    builderFeeBps: Number(MALLOW_BUILDER_FEE_BPS),
    shapeKey: MALLOW_OPEN_LIMIT_SHAPE_KEY
  };
  if (row.status !== "ok") {
    return {
      ...shared,
      status: "unavailable",
      symbol: null,
      marketId: null,
      indexPriceUsd: null,
      maxLeverage: null,
      reason: row.reason
    };
  }
  return {
    ...shared,
    status: "ok",
    symbol: row.symbol,
    marketId: row.marketId,
    indexPriceUsd: row.prices.index && row.prices.index > 0n ? price12ToDecimal(row.prices.index) : null,
    maxLeverage: row.maxLeverage,
    reason: null
  };
}

export function registerMallowRoutes(app: FastifyInstance): void {
  app.get<{ Reply: ApiSuccess<MallowMarketsData> }>(
    "/protocols/mallow/markets",
    {
      schema: {
        response: {
          200: MallowMarketsResponseSchema
        }
      }
    },
    async () => {
      const book = await loadMallowBookForRequest();
      return {
        data: {
          markets: MALLOW_MARKETS.map((symbol) => presentMarket(readyMarket(book, symbol))),
          collateralAssetId: MALLOW_USDC_ASSET_ID,
          builderFeeBps: Number(MALLOW_BUILDER_FEE_BPS),
          shapeKey: MALLOW_OPEN_LIMIT_SHAPE_KEY
        }
      };
    }
  );
}
