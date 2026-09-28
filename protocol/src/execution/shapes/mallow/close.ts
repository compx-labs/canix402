import algosdk, { Algodv2, type SuggestedParams, type Transaction } from "algosdk";
import { pdexBigInt } from "@pdex/sdk";
import { SIDE } from "@pdex/sdk/constants";
import { decodeV2OracleSnapshotMessage } from "@pdex/sdk/oracle";
import { YieldRecallUnavailableError } from "@pdex/sdk/marketYield";
import { prepareV2DecreaseOrCloseTransactions } from "@pdex/sdk/transactions";

import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import {
  loadMallowBookForRequest,
  readyMarket,
  type MallowAccountPosition,
  type MallowBook,
  type MallowPreparedMarket
} from "./book.js";
import { mallowBuilderFee, quoteBuilderFields, type MallowBuilderFee } from "./config.js";
import { MALLOW_USDC_ASSET_ID, type MallowMarketSymbol, type MallowSide } from "./constants.js";
import { accountOptedIntoUsdc } from "./open-limit.js";
import {
  OPEN_SLIPPAGE_BPS,
  V2_BPS,
  acceptablePriceForDecrease,
  amount6ToDecimal,
  firstUsd6,
  price12ToDecimal,
  quoteFailureReasons
} from "./math.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "mallow",
  protocolVersion: "v1",
  action: "close",
  variant: "market"
};

export interface MallowCloseMarketInput {
  userAddress: string;
  market: MallowMarketSymbol;
  side: MallowSide;
  positionId: string;
}

export interface MallowCloseMarketState {
  market: MallowPreparedMarket;
  book: MallowBook;
  builder: MallowBuilderFee | undefined;
  position: MallowAccountPosition;
  acceptablePrice: bigint;
  minPrimaryOutput: bigint;
  minSecondaryOutput: bigint;
  oracleMessage: Uint8Array;
  oracleSignature: Uint8Array;
  pexFeeUsd: number | null;
  mallowFeeUsd: number;
}

export interface MallowCloseMarketDependencies {
  loadBook: () => Promise<MallowBook>;
  builderFee: () => MallowBuilderFee | undefined;
  accountOptedIntoUsdc: (algod: Algodv2, address: string) => Promise<boolean>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
}

let dependencyOverrides: Partial<MallowCloseMarketDependencies> | undefined;

export function setMallowCloseMarketDependenciesForTests(
  overrides?: Partial<MallowCloseMarketDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): MallowCloseMarketDependencies {
  return {
    loadBook: loadMallowBookForRequest,
    builderFee: () => mallowBuilderFee(),
    accountOptedIntoUsdc,
    getSuggestedParams,
    ...dependencyOverrides
  };
}

async function getSuggestedParams(algod: Algodv2): Promise<SuggestedParams> {
  return algod.getTransactionParams().do();
}

function parseAddress(value: unknown): string {
  if (typeof value !== "string" || !algosdk.isValidAddress(value)) {
    throw new InvalidShapeInputError("userAddress must be a valid Algorand address.");
  }
  return value;
}

function parseMarket(value: unknown): MallowMarketSymbol {
  if (value === "ALGO" || value === "BTC") {
    return value;
  }
  throw new InvalidShapeInputError("market must be ALGO or BTC.", { market: value });
}

function parseSide(value: unknown): MallowSide {
  if (value === "long" || value === "short") {
    return value;
  }
  throw new InvalidShapeInputError("side must be long or short.", { side: value });
}

function parsePositionId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value.toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return value.replace(/^0+(?=\d)/, "");
  }
  throw new InvalidShapeInputError("positionId must be the id from GET /protocols/mallow/positions.", {
    positionId: value
  });
}

function parseCloseInput(raw: unknown): MallowCloseMarketInput {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidShapeInputError("Shape input must be an object.");
  }
  const value = raw as Record<string, unknown>;
  return {
    userAddress: parseAddress(value.userAddress),
    market: parseMarket(value.market),
    side: parseSide(value.side),
    positionId: parsePositionId(value.positionId)
  };
}

function refuse(message: string, reason: string, extra?: Record<string, unknown>): never {
  throw new ShapeStateError(message, { details: { reason, ...extra } });
}

function signedCloseIndex(side: MallowSide, indexMin: bigint, indexMax: bigint): bigint {
  return side === "long" ? indexMin : indexMax;
}

function indexMoved(left: bigint, right: bigint): boolean {
  if (left <= 0n || right <= 0n) {
    return true;
  }
  const delta = left > right ? left - right : right - left;
  const base = left > right ? left : right;
  return delta * V2_BPS > base * OPEN_SLIPPAGE_BPS;
}

function quotedAmount(quote: Record<string, unknown>, keys: readonly string[]): bigint | undefined {
  for (const key of keys) {
    if (quote[key] !== undefined && quote[key] !== null) {
      return pdexBigInt(quote[key], 0n);
    }
  }
  return undefined;
}

function mallowFeeUsd(quote: Record<string, unknown>, sizeUsd: bigint, builder: MallowBuilderFee | undefined): number {
  if (!builder) {
    return 0;
  }
  const quoted = firstUsd6(quote, [
    "builder_fee_paid",
    "builder_fee_assessed",
    "builderFeePaid",
    "builderFeeAssessed"
  ]);
  if (quoted !== null && quoted > 0) {
    return quoted;
  }
  return Number((sizeUsd * builder.builderFeeBps) / 10_000n) / 1_000_000;
}

function selectPosition(
  positions: readonly MallowAccountPosition[],
  input: MallowCloseMarketInput
): MallowAccountPosition {
  const onSide = positions.filter((position) => position.market === input.market && position.side === input.side);
  const selected = onSide.find((position) => position.positionId === input.positionId);
  if (!selected) {
    if (onSide.some((position) => position.sizeUsd > 0n)) {
      refuse("That position was replaced. Read GET /protocols/mallow/positions again.", "position-replaced", {
        positionId: input.positionId
      });
    }
    refuse("No open Mallow position matches that id.", "position-not-found", {
      positionId: input.positionId,
      market: input.market,
      side: input.side
    });
  }
  if (selected.sizeUsd <= 0n) {
    refuse("That Mallow position has no size left to close.", "position-not-found", {
      positionId: input.positionId
    });
  }
  return selected;
}

function rehydrate(transactions: readonly unknown[]): Transaction[] {
  return transactions.map((txn, index) => {
    if (!txn || typeof txn !== "object" || !("toByte" in txn) || typeof txn.toByte !== "function") {
      throw new ShapeBuildError(`Could not encode Mallow transaction ${index}.`);
    }
    const encoded = (txn as { toByte: () => Uint8Array }).toByte();
    return algosdk.decodeUnsignedTransaction(encoded);
  });
}

export const mallowCloseMarketShape: TransactionShapeSpec<MallowCloseMarketInput, MallowCloseMarketState> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Mallow market close",
  description:
    "Compiles an unsigned full close of an open Mallow ALGO/USD or BTC/USD position at the signed index, " +
    "with 1% of slippage against the close. positionId comes from GET /protocols/mallow/positions. " +
    "The group settles on People's Exchange, includes Mallow's 3 bps builder fee, and does not cancel " +
    "attached take-profit or stop-loss orders. Canix does not sign or submit.",
  supportedOpportunityTypes: ["perps"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "market", "side", "positionId"],
  sources: [
    {
      kind: "sdk",
      description: "PEX public SDK decrease-or-close builder with yield recall preparation",
      url: "https://ppls.exchange/"
    },
    {
      kind: "api",
      description: "Mallow API proxy for PEX position reads and decrease quotes",
      url: "https://usemallow.app"
    }
  ],

  parseInput: parseCloseInput,

  async resolveState(context, input): Promise<MallowCloseMarketState> {
    const dependencies = resolveDependencies();
    const optedIn = await dependencies.accountOptedIntoUsdc(context.algod, input.userAddress);
    if (!optedIn) {
      refuse(
        "Wallet is not opted into USDC. Compile mainnet:mallow:v1:optIn:usdc first.",
        "not-opted-in",
        { assetId: MALLOW_USDC_ASSET_ID }
      );
    }

    const builder = dependencies.builderFee();
    const book = await dependencies.loadBook();
    const row = readyMarket(book, input.market);
    if (row.status !== "ok") {
      refuse(`${input.market}/USD is unavailable on Mallow.`, row.reason, { market: input.market });
    }

    const bookMin = row.prices.indexMin ?? 0n;
    const bookMax = row.prices.indexMax ?? 0n;
    if (bookMin <= 0n || bookMax <= 0n) {
      refuse("Mallow does not have a signed index band for this market.", "index-unavailable", {
        market: input.market
      });
    }

    const position = selectPosition(await book.positions(input.userAddress), input);
    const oracle = await book.tradingOracle(row.marketId, row.appRefs.v2TradingAppId);
    let snapshot;
    try {
      snapshot = decodeV2OracleSnapshotMessage(oracle.message);
    } catch (error) {
      throw new ShapeStateError("Mallow could not read a signed trading oracle for this close.", {
        details: { reason: "oracle-unavailable" },
        cause: error
      });
    }
    if (
      snapshot.marketId !== BigInt(row.marketId) ||
      snapshot.targetAppId !== BigInt(row.appRefs.v2TradingAppId)
    ) {
      refuse("Mallow's trading oracle does not match this market.", "oracle-unavailable", {
        market: input.market
      });
    }
    const signedIndex = signedCloseIndex(input.side, snapshot.indexMinPrice, snapshot.indexMaxPrice);
    const bookIndex = signedCloseIndex(input.side, bookMin, bookMax);
    if (signedIndex <= 0n) {
      refuse("Mallow does not have a signed index for this close.", "index-unavailable", {
        market: input.market
      });
    }
    if (indexMoved(bookIndex, signedIndex)) {
      refuse("The signed index moved. Read the market again before closing.", "index-moved", {
        market: input.market
      });
    }

    const acceptablePrice = acceptablePriceForDecrease(input.side, signedIndex);
    const quote = await book.quoteDecrease({
      owner: input.userAddress,
      market_id: Number(row.marketId),
      pool_id: Number(row.poolId),
      side: input.side === "long" ? SIDE.LONG : SIDE.SHORT,
      collateral_asset_id: row.collateralAssetId,
      size_usd_delta: position.sizeUsd,
      acceptable_price: acceptablePrice,
      position_id: position.positionId,
      ...quoteBuilderFields(builder)
    });
    const blocked = quoteFailureReasons(quote);
    if (blocked) {
      refuse("Mallow rejected this close quote.", "quote-rejected", { reasons: blocked });
    }
    const quotedAcceptable = pdexBigInt(quote.acceptable_price, acceptablePrice);
    if (quotedAcceptable !== acceptablePrice) {
      refuse("Mallow's close price does not match the signed index.", "price-moved", {
        acceptablePrice: acceptablePrice.toString()
      });
    }
    const minPrimaryOutput = quotedAmount(quote, [
      "primary_output_amount",
      "min_primary_output",
      "minPrimaryOutput"
    ]);
    if (minPrimaryOutput === undefined) {
      refuse("Mallow did not return a minimum collateral output for this close.", "output-unavailable");
    }
    const minSecondaryOutput =
      quotedAmount(quote, ["pnl_output_amount", "secondary_output_amount", "min_secondary_output"]) ?? 0n;

    return {
      market: row,
      book,
      builder,
      position,
      acceptablePrice,
      minPrimaryOutput,
      minSecondaryOutput,
      oracleMessage: oracle.message,
      oracleSignature: oracle.signature,
      pexFeeUsd: firstUsd6(quote, ["platform_fee_amount", "close_fee_usd", "fee_amount", "fee_usd"]),
      mallowFeeUsd: mallowFeeUsd(quote, position.sizeUsd, builder)
    };
  },

  async build(context, input, state): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const suggestedParams = await dependencies.getSuggestedParams(context.algod);
    let transactions: Transaction[];
    try {
      transactions = rehydrate(
        await prepareV2DecreaseOrCloseTransactions(
          state.book.recallClient,
          {
            ...state.market.appRefs,
            ...state.market.assetRefs,
            ...(state.book.marketYieldRegistry
              ? { marketYieldRegistry: state.book.marketYieldRegistry }
              : {}),
            sender: input.userAddress,
            marketId: state.market.marketId,
            collateralAssetId: state.market.collateralAssetId,
            side: input.side === "long" ? SIDE.LONG : SIDE.SHORT,
            sizeUsdDelta: state.position.sizeUsd,
            acceptablePrice: state.acceptablePrice,
            minPrimaryOutput: state.minPrimaryOutput,
            minSecondaryOutput: state.minSecondaryOutput,
            oracleMessage: state.oracleMessage,
            oracleSignature: state.oracleSignature,
            expectedPositionId: state.position.positionId,
            ...(state.builder ? { builderFee: state.builder } : {})
          },
          suggestedParams
        )
      );
    } catch (error) {
      if (error instanceof ShapeBuildError || error instanceof ShapeStateError) {
        throw error;
      }
      if (error instanceof YieldRecallUnavailableError) {
        throw new ShapeStateError("Mallow could not prepare payout liquidity for this close.", {
          details: { reason: "recall-unavailable" },
          cause: error
        });
      }
      if (error instanceof Error && /group_too_large/i.test(error.message)) {
        throw new ShapeBuildError("The Mallow close group does not fit in one Algorand group.", {
          details: { reason: "group-too-large" },
          cause: error
        });
      }
      throw new ShapeBuildError(
        error instanceof Error ? error.message : "Failed to build the Mallow close.",
        { cause: error }
      );
    }

    const feeNote = state.builder
      ? `Mallow charges ${state.builder.builderFeeBps.toString()} bps on this close.`
      : "Mallow builder fee is not configured for this environment.";
    return {
      transactions,
      warnings: [
        feeNote,
        "This closes the full position. Attached take-profit and stop-loss orders are not cancelled.",
        "Positions settle on People's Exchange. Canix does not sign or submit."
      ],
      metadata: {
        protocol: "mallow",
        venue: "pex",
        market: input.market,
        symbol: state.market.symbol,
        marketId: state.market.marketId,
        side: input.side,
        positionId: state.position.positionId,
        collateralAssetId: state.market.collateralAssetId,
        collateralAmount: state.position.collateralAmount.toString(),
        sizeUsd: amount6ToDecimal(state.position.sizeUsd),
        acceptablePriceUsd: price12ToDecimal(state.acceptablePrice),
        minPrimaryOutput: state.minPrimaryOutput.toString(),
        minSecondaryOutput: state.minSecondaryOutput.toString(),
        mallowFeeUsd: state.mallowFeeUsd,
        pexFeeUsd: state.pexFeeUsd,
        builderAddress: state.builder?.builderAddress ?? null,
        builderFeeBps: state.builder ? Number(state.builder.builderFeeBps) : 0,
        signed: false,
        submitted: false,
        executionSubmitted: false
      }
    };
  },

  validate(group, input): ShapeValidationResult {
    const errors: string[] = [];
    if (group.length === 0) {
      errors.push("Mallow close group is empty.");
    }
    for (const [index, txn] of group.entries()) {
      if (txn.sender !== input.userAddress) {
        errors.push(`Transaction ${index} sender is not the user.`);
      }
      if (group.length > 1 && !txn.groupPresent) {
        errors.push(`Transaction ${index} is not grouped.`);
      }
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  }
};
