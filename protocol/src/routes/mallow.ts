import { Type } from "@sinclair/typebox";
import algosdk from "algosdk";
import type { FastifyInstance } from "fastify";

import { MALLOW_MARKETS, MALLOW_BUILDER_FEE_BPS, MALLOW_CLOSE_MARKET_SHAPE_KEY, MALLOW_OPEN_LIMIT_SHAPE_KEY, MALLOW_USDC_ASSET_ID } from "../execution/shapes/mallow/constants.js";
import { loadMallowBookForRequest, readyMarket, type MallowAccountPosition, type MallowMarketRow } from "../execution/shapes/mallow/book.js";
import { amount6ToDecimal, price12ToDecimal } from "../execution/shapes/mallow/math.js";
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

export interface MallowPositionSnapshot {
  positionId: string;
  market: "ALGO" | "BTC";
  side: "long" | "short";
  sizeUsd: string;
  collateralAmount: string;
  shapeKey: string;
}

export interface MallowPositionsData {
  positions: MallowPositionSnapshot[];
  collateralAssetId: number;
  shapeKey: string;
}

const MallowPositionSnapshotSchema = Type.Object({
  positionId: Type.String(),
  market: Type.Union([Type.Literal("ALGO"), Type.Literal("BTC")]),
  side: Type.Union([Type.Literal("long"), Type.Literal("short")]),
  sizeUsd: Type.String(),
  collateralAmount: Type.String(),
  shapeKey: Type.String()
});

const MallowPositionsResponseSchema = Type.Object({
  data: Type.Object({
    positions: Type.Array(MallowPositionSnapshotSchema),
    collateralAssetId: Type.Integer(),
    shapeKey: Type.String()
  })
});

const MallowPositionsQuerySchema = Type.Object({
  address: Type.Optional(Type.String())
});

function presentPosition(position: MallowAccountPosition): MallowPositionSnapshot {
  return {
    positionId: position.positionId,
    market: position.market,
    side: position.side,
    sizeUsd: amount6ToDecimal(position.sizeUsd),
    collateralAmount: position.collateralAmount.toString(),
    shapeKey: MALLOW_CLOSE_MARKET_SHAPE_KEY
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

  app.get<{ Querystring: { address?: string }; Reply: ApiSuccess<MallowPositionsData> }>(
    "/protocols/mallow/positions",
    {
      schema: {
        querystring: MallowPositionsQuerySchema,
        response: {
          200: MallowPositionsResponseSchema
        }
      }
    },
    async (request) => {
      const address = request.query.address?.trim() ?? "";
      if (!algosdk.isValidAddress(address)) {
        return {
          data: {
            positions: [],
            collateralAssetId: MALLOW_USDC_ASSET_ID,
            shapeKey: MALLOW_CLOSE_MARKET_SHAPE_KEY
          }
        };
      }
      const book = await loadMallowBookForRequest();
      const positions = (await book.positions(address))
        .filter((position) => position.sizeUsd > 0n)
        .map(presentPosition);
      return {
        data: {
          positions,
          collateralAssetId: MALLOW_USDC_ASSET_ID,
          shapeKey: MALLOW_CLOSE_MARKET_SHAPE_KEY
        }
      };
    }
  );
}
