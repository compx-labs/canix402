import algosdk, { Algodv2, type SuggestedParams, type Transaction } from "algosdk";
import { pdexBigInt } from "@pdex/sdk";
import { SIDE, V2_ORDER_BOX_MBR_MICRO_ALGO, V2_ORDER_TARGET, V2_OPEN_ORDER_EXECUTION_STORAGE_ESCROW_MICRO_ALGO } from "@pdex/sdk/constants";
import { decodeV2OracleSnapshotMessage } from "@pdex/sdk/oracle";
import { buildV2OpenLimitWithAttachedOrdersTransactions } from "@pdex/sdk/transactions";

import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey,
  type SerializedTransaction
} from "../../types.js";
import { loadMallowBookForRequest, readyMarket, type MallowBook, type MallowPreparedMarket } from "./book.js";
import { mallowBuilderFee, quoteBuilderFields, type MallowBuilderFee } from "./config.js";
import { MALLOW_USDC_ASSET_ID, type MallowMarketSymbol, type MallowSide } from "./constants.js";
import {
  OPEN_LIMIT_KEEPER_FEE,
  TIME_IN_FORCE,
  V2_ORDER_KIND,
  acceptablePriceForDecrease,
  acceptablePriceForLimit,
  collateralForOpenTrade,
  dollarsToAmount6,
  firstUsd6,
  keeperFeeAmountForMinUsd,
  MIN_KEEPER_FEE_USD,
  numberToPrice12,
  openLimitCrossed,
  paperLiquidationPrice,
  price12ToDecimal,
  price12ToNumber,
  protectLegsFromRoi,
  quoteFailureReasons,
  reduceOrderCrossed,
  validateProtectLegs
} from "./math.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "mallow",
  protocolVersion: "v1",
  action: "openLimit",
  variant: "attached"
};

export interface MallowOpenLimitInput {
  userAddress: string;
  market: MallowMarketSymbol;
  side: MallowSide;
  collateralUsd: number;
  leverage: number;
  entryPriceUsd: number;
  takeProfitPct: number;
  stopLossPct: number;
}

export interface MallowOpenLimitState {
  market: MallowPreparedMarket;
  book: MallowBook;
  builder: MallowBuilderFee | undefined;
  collateralAmount: bigint;
  sizeUsdDelta: bigint;
  triggerPrice: bigint;
  acceptablePrice: bigint;
  ownerOrderId: bigint;
  takeProfitPrice: bigint;
  takeProfitAcceptable: bigint;
  stopLossPrice: bigint;
  stopLossAcceptable: bigint;
  takeProfitUsd: number;
  stopLossUsd: number;
  liquidationUsd: number | null;
  keeperFeeAmount: bigint;
  storageMicroAlgo: bigint;
  oracleMessage: Uint8Array;
  oracleSignature: Uint8Array;
  pexFeeUsd: number | null;
  mallowFeeUsd: number;
}

export interface MallowOpenLimitDependencies {
  loadBook: () => Promise<MallowBook>;
  builderFee: () => MallowBuilderFee | undefined;
  accountOptedIntoUsdc: (algod: Algodv2, address: string) => Promise<boolean>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  nextOwnerOrderId: (nowMs: number) => bigint;
}

let dependencyOverrides: Partial<MallowOpenLimitDependencies> | undefined;

export function setMallowOpenLimitDependenciesForTests(
  overrides?: Partial<MallowOpenLimitDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): MallowOpenLimitDependencies {
  return {
    loadBook: loadMallowBookForRequest,
    builderFee: () => mallowBuilderFee(),
    accountOptedIntoUsdc,
    getSuggestedParams,
    nextOwnerOrderId,
    ...dependencyOverrides
  };
}

export function nextOwnerOrderId(now = Date.now(), jitter = Math.floor(Math.random() * 1_000)): bigint {
  return BigInt(now) * 1_000n + BigInt(jitter);
}

async function getSuggestedParams(algod: Algodv2): Promise<SuggestedParams> {
  return algod.getTransactionParams().do();
}

export async function accountOptedIntoUsdc(algod: Algodv2, address: string): Promise<boolean> {
  try {
    const response = await algod.accountAssetInformation(address, MALLOW_USDC_ASSET_ID).do();
    const holding = (response as { assetHolding?: unknown }).assetHolding;
    return holding != null;
  } catch (error) {
    if (isAssetNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isAssetNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { status?: unknown; response?: { status?: unknown }; message?: unknown };
  if (record.status === 404 || record.response?.status === 404) {
    return true;
  }
  return typeof record.message === "string" && /not found|no asset/i.test(record.message);
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

function parsePositiveUsd(value: unknown, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0) {
    throw new InvalidShapeInputError(`${field} must be a positive USD amount.`, { [field]: value });
  }
  return numeric;
}

function parseLeverage(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 1) {
    throw new InvalidShapeInputError("leverage must be an integer greater than or equal to 1.", {
      leverage: value
    });
  }
  return numeric;
}

function parsePercent(value: unknown, field: string): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric === "number" && numeric < 0) {
    throw new InvalidShapeInputError(
      `${field} is a positive percent. Pass 25 for a -25% stop, not -25.`,
      { [field]: value }
    );
  }
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0 || numeric > 10_000) {
    throw new InvalidShapeInputError(`${field} must be a positive percent.`, { [field]: value });
  }
  return numeric;
}

function parseOpenLimitInput(raw: unknown): MallowOpenLimitInput {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidShapeInputError("Shape input must be an object.");
  }
  const value = raw as Record<string, unknown>;
  return {
    userAddress: parseAddress(value.userAddress),
    market: parseMarket(value.market),
    side: parseSide(value.side),
    collateralUsd: parsePositiveUsd(value.collateralUsd, "collateralUsd"),
    leverage: parseLeverage(value.leverage),
    entryPriceUsd: parsePositiveUsd(value.entryPriceUsd, "entryPriceUsd"),
    takeProfitPct: parsePercent(value.takeProfitPct, "takeProfitPct"),
    stopLossPct: parsePercent(value.stopLossPct, "stopLossPct")
  };
}

function refuse(message: string, reason: string, extra?: Record<string, unknown>): never {
  throw new ShapeStateError(message, { details: { reason, ...extra } });
}

function keeperFeeFromOracle(message: Uint8Array, keeperAssetId: number): bigint {
  const snapshot = decodeV2OracleSnapshotMessage(message);
  const assetId = BigInt(keeperAssetId);
  const minPrice =
    assetId === snapshot.longAssetId
      ? snapshot.longMinPrice
      : assetId === snapshot.shortAssetId
        ? snapshot.shortMinPrice
        : 0n;
  const amount = keeperFeeAmountForMinUsd(MIN_KEEPER_FEE_USD, minPrice);
  return amount > OPEN_LIMIT_KEEPER_FEE ? amount : OPEN_LIMIT_KEEPER_FEE;
}

function liquidationUsd(
  quote: Record<string, unknown>,
  side: MallowSide,
  entry: number,
  leverage: number
): number | null {
  const nested =
    quote.execution_quote && typeof quote.execution_quote === "object"
      ? (quote.execution_quote as Record<string, unknown>)
      : undefined;
  const raw = pdexBigInt(quote.liquidation_price ?? nested?.liquidation_price, 0n);
  const quoted = raw > 0n ? price12ToNumber(raw) : null;
  return quoted ?? paperLiquidationPrice(side, entry, leverage);
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

function rehydrate(transactions: readonly unknown[]): Transaction[] {
  return transactions.map((txn, index) => {
    if (!txn || typeof txn !== "object" || !("toByte" in txn) || typeof txn.toByte !== "function") {
      throw new ShapeBuildError(`Could not encode Mallow transaction ${index}.`);
    }
    const encoded = (txn as { toByte: () => Uint8Array }).toByte();
    return algosdk.decodeUnsignedTransaction(encoded);
  });
}

export const mallowOpenLimitShape: TransactionShapeSpec<MallowOpenLimitInput, MallowOpenLimitState> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Mallow limit order with take-profit and stop-loss",
  description:
    "Compiles an unsigned Mallow limit order on ALGO/USD or BTC/USD with leverage and attached take-profit and stop-loss. " +
    "collateralUsd is USDC margin. takeProfitPct and stopLossPct are return on that margin, not the price move. " +
    "Positions settle on People's Exchange. Canix attaches Mallow's 3 bps builder fee and does not sign or submit. " +
    "A limit already through the index is rejected rather than filled as a market order.",
  supportedOpportunityTypes: ["perps"],
  opportunityRole: "enter",
  requiredInputs: [
    "userAddress",
    "market",
    "side",
    "collateralUsd",
    "leverage",
    "entryPriceUsd",
    "takeProfitPct",
    "stopLossPct"
  ],
  sources: [
    {
      kind: "sdk",
      description: "PEX public SDK open-limit builder with attached take-profit and stop-loss",
      url: "https://ppls.exchange/"
    },
    {
      kind: "api",
      description: "Mallow API proxy for PEX market reads and order quotes",
      url: "https://usemallow.app"
    }
  ],

  parseInput: parseOpenLimitInput,

  async resolveState(_context, input): Promise<MallowOpenLimitState> {
    const dependencies = resolveDependencies();
    const optedIn = await dependencies.accountOptedIntoUsdc(_context.algod, input.userAddress);
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
    if (row.maxLeverage === null) {
      refuse("Mallow could not read this market's maximum leverage.", "leverage-unavailable", {
        market: input.market
      });
    }
    if (input.leverage > row.maxLeverage) {
      refuse(`Leverage ${input.leverage} is above the ${input.market} maximum of ${row.maxLeverage}.`, "leverage-above-max", {
        leverage: input.leverage,
        maxLeverage: row.maxLeverage
      });
    }

    const indexMin = row.prices.indexMin ?? 0n;
    const indexMax = row.prices.indexMax ?? 0n;
    if (indexMin <= 0n || indexMax <= 0n) {
      refuse("Mallow does not have a signed index band for this market.", "index-unavailable", {
        market: input.market
      });
    }

    const triggerPrice = numberToPrice12(input.entryPriceUsd);
    const acceptablePrice = acceptablePriceForLimit(input.side, triggerPrice);
    if (openLimitCrossed(input.side, triggerPrice, indexMin, indexMax)) {
      refuse("That limit is already through the market and would fill immediately.", "limit-crossed", {
        entryPriceUsd: input.entryPriceUsd
      });
    }

    const sizeUsdDelta = dollarsToAmount6(input.collateralUsd * input.leverage);
    const equityUsd = dollarsToAmount6(input.collateralUsd);
    const collateralAmount = collateralForOpenTrade({
      raw: row.raw,
      prices: row.prices,
      sizeUsd: sizeUsdDelta,
      equityUsd,
      builderFeeBps: builder?.builderFeeBps ?? 0n
    });
    const ownerOrderId = dependencies.nextOwnerOrderId(_context.now?.() ?? Date.now());
    const quote = await book.quoteOpenLimit({
      owner: input.userAddress,
      owner_order_id: ownerOrderId,
      market_id: Number(row.marketId),
      pool_id: Number(row.poolId),
      side: input.side === "long" ? SIDE.LONG : SIDE.SHORT,
      collateral_asset_id: row.collateralAssetId,
      collateral_amount: collateralAmount,
      size_usd_delta: sizeUsdDelta,
      trigger_price: triggerPrice,
      acceptable_price: acceptablePrice,
      keeper_fee_asset_id: row.collateralAssetId,
      keeper_fee_amount: OPEN_LIMIT_KEEPER_FEE,
      time_in_force: TIME_IN_FORCE.GTC,
      current_time: Math.floor((_context.now?.() ?? Date.now()) / 1_000),
      ...quoteBuilderFields(builder)
    });
    const blocked = quoteFailureReasons(quote);
    if (blocked) {
      refuse("Mallow rejected this limit quote.", "quote-rejected", { reasons: blocked });
    }
    if (quote.submission_result === "execute_immediately" || quote.crossed === true) {
      refuse("That limit is already through the market and would fill immediately.", "limit-crossed");
    }
    const quotedAcceptable = pdexBigInt(quote.acceptable_price, acceptablePrice);
    if (quotedAcceptable <= 0n) {
      refuse("Mallow did not return an acceptable price for this limit.", "quote-rejected");
    }

    const entry = price12ToNumber(triggerPrice) ?? input.entryPriceUsd;
    const legs = protectLegsFromRoi({
      side: input.side,
      entry,
      leverage: input.leverage,
      takeProfitPct: input.takeProfitPct,
      stopLossPct: input.stopLossPct
    });
    const liquidation = liquidationUsd(quote, input.side, entry, input.leverage);
    const issue = validateProtectLegs({
      side: input.side,
      entry,
      ...(legs.takeProfit !== undefined ? { takeProfit: legs.takeProfit } : {}),
      ...(legs.stopLoss !== undefined ? { stopLoss: legs.stopLoss } : {}),
      liquidation
    });
    if (issue === "slLiq") {
      refuse("That stop-loss sits at or beyond liquidation.", "stop-beyond-liquidation", {
        liquidationUsd: liquidation
      });
    }
    if (issue === "tpDirection" || issue === "slDirection" || legs.takeProfit === undefined || legs.stopLoss === undefined) {
      refuse("Take-profit or stop-loss is on the wrong side of the entry.", issue ?? "protect-invalid");
    }

    const takeProfitPrice = numberToPrice12(legs.takeProfit);
    const stopLossPrice = numberToPrice12(legs.stopLoss);
    if (reduceOrderCrossed(input.side, "takeProfit", takeProfitPrice, indexMin, indexMax)) {
      refuse("That take-profit is already through the market.", "take-profit-crossed");
    }
    if (reduceOrderCrossed(input.side, "stopLoss", stopLossPrice, indexMin, indexMax)) {
      refuse("That stop-loss is already through the market.", "stop-loss-crossed");
    }

    const oracle = await book.orderOracle(row.marketId, row.orderOpsAppId);
    let snapshot;
    try {
      snapshot = decodeV2OracleSnapshotMessage(oracle.message);
    } catch (error) {
      throw new ShapeStateError("Mallow could not read a signed oracle for this order.", {
        details: { reason: "oracle-unavailable" },
        cause: error
      });
    }
    if (openLimitCrossed(input.side, triggerPrice, snapshot.indexMinPrice, snapshot.indexMaxPrice)) {
      refuse("That limit is already through the signed index and would fill immediately.", "limit-crossed");
    }
    if (reduceOrderCrossed(input.side, "takeProfit", takeProfitPrice, snapshot.indexMinPrice, snapshot.indexMaxPrice)) {
      refuse("That take-profit is already through the signed index.", "take-profit-crossed");
    }
    if (reduceOrderCrossed(input.side, "stopLoss", stopLossPrice, snapshot.indexMinPrice, snapshot.indexMaxPrice)) {
      refuse("That stop-loss is already through the signed index.", "stop-loss-crossed");
    }

    const quotedStorage = pdexBigInt(quote.required_storage_payment_microalgo, 0n);
    return {
      market: row,
      book,
      builder,
      collateralAmount,
      sizeUsdDelta,
      triggerPrice,
      acceptablePrice: quotedAcceptable,
      ownerOrderId,
      takeProfitPrice,
      takeProfitAcceptable: acceptablePriceForDecrease(input.side, takeProfitPrice),
      stopLossPrice,
      stopLossAcceptable: acceptablePriceForDecrease(input.side, stopLossPrice),
      takeProfitUsd: legs.takeProfit,
      stopLossUsd: legs.stopLoss,
      liquidationUsd: liquidation,
      keeperFeeAmount: keeperFeeFromOracle(oracle.message, row.collateralAssetId),
      storageMicroAlgo:
        quotedStorage > 0n ? quotedStorage : BigInt(V2_OPEN_ORDER_EXECUTION_STORAGE_ESCROW_MICRO_ALGO),
      oracleMessage: oracle.message,
      oracleSignature: oracle.signature,
      pexFeeUsd: firstUsd6(quote, ["platform_fee_amount", "open_fee_usd", "trading_fee_usd", "fee_usd"]),
      mallowFeeUsd: mallowFeeUsd(quote, sizeUsdDelta, builder)
    };
  },

  async build(context, input, state): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const suggestedParams = await dependencies.getSuggestedParams(context.algod);
    const childOracle = {
      oracleMessage: state.oracleMessage,
      oracleSignature: state.oracleSignature
    };
    let transactions: Transaction[];
    try {
      transactions = rehydrate(
        buildV2OpenLimitWithAttachedOrdersTransactions(
          {
            ...state.market.appRefs,
            ...state.market.assetRefs,
            ...(state.book.marketYieldRegistry
              ? { marketYieldRegistry: state.book.marketYieldRegistry }
              : {}),
            v2OrderOpsAppId: state.market.orderOpsAppId,
            sender: input.userAddress,
            ownerOrderId: state.ownerOrderId,
            baseOrderId: state.ownerOrderId,
            orderKind: V2_ORDER_KIND.OPEN_LIMIT,
            targetKind: V2_ORDER_TARGET.PAIR,
            marketId: state.market.marketId,
            side: input.side === "long" ? SIDE.LONG : SIDE.SHORT,
            collateralAssetId: state.market.collateralAssetId,
            collateralAmount: state.collateralAmount,
            sizeUsdDelta: state.sizeUsdDelta,
            triggerPrice: state.triggerPrice,
            acceptablePrice: state.acceptablePrice,
            keeperFeeAssetId: state.market.collateralAssetId,
            keeperFeeAmount: state.keeperFeeAmount,
            timeInForce: TIME_IN_FORCE.GTC,
            oracleMessage: state.oracleMessage,
            oracleSignature: state.oracleSignature,
            storagePaymentMicroAlgo: state.storageMicroAlgo,
            childKeeperFeeAmount: state.keeperFeeAmount,
            childTimeInForce: TIME_IN_FORCE.GTC,
            childStoragePaymentMicroAlgo: BigInt(V2_ORDER_BOX_MBR_MICRO_ALGO),
            ...(state.builder ? { builderFee: state.builder } : {}),
            takeProfit: {
              triggerPrice: state.takeProfitPrice,
              acceptablePrice: state.takeProfitAcceptable,
              ...childOracle
            },
            stopLoss: {
              triggerPrice: state.stopLossPrice,
              acceptablePrice: state.stopLossAcceptable,
              ...childOracle
            }
          },
          suggestedParams
        )
      );
    } catch (error) {
      if (error instanceof ShapeBuildError || error instanceof ShapeStateError) {
        throw error;
      }
      if (error instanceof Error && /group_too_large/i.test(error.message)) {
        throw new ShapeBuildError("The Mallow order group does not fit in one Algorand group.", {
          details: { reason: "group-too-large" },
          cause: error
        });
      }
      throw new ShapeBuildError(
        error instanceof Error ? error.message : "Failed to build the Mallow limit order.",
        { cause: error }
      );
    }

    const feeNote = state.builder
      ? `Mallow charges ${state.builder.builderFeeBps.toString()} bps on this order.`
      : "Mallow builder fee is not configured for this environment.";
    return {
      transactions,
      warnings: [
        feeNote,
        "Take-profit and stop-loss percents are return on margin, not the price move.",
        "Positions settle on People's Exchange. Canix does not sign or submit."
      ],
      metadata: {
        protocol: "mallow",
        venue: "pex",
        market: input.market,
        symbol: state.market.symbol,
        marketId: state.market.marketId,
        side: input.side,
        collateralUsd: input.collateralUsd,
        collateralAssetId: state.market.collateralAssetId,
        collateralAmount: state.collateralAmount.toString(),
        leverage: input.leverage,
        sizeUsd: (input.collateralUsd * input.leverage).toString(),
        entryPriceUsd: price12ToDecimal(state.triggerPrice),
        takeProfitPct: input.takeProfitPct,
        stopLossPct: input.stopLossPct,
        takeProfitPriceUsd: price12ToDecimal(state.takeProfitPrice),
        stopLossPriceUsd: price12ToDecimal(state.stopLossPrice),
        liquidationPriceUsd: state.liquidationUsd,
        keeperFeeAmount: state.keeperFeeAmount.toString(),
        storageMicroAlgo: state.storageMicroAlgo.toString(),
        mallowFeeUsd: state.mallowFeeUsd,
        pexFeeUsd: state.pexFeeUsd,
        builderAddress: state.builder?.builderAddress ?? null,
        builderFeeBps: state.builder ? Number(state.builder.builderFeeBps) : 0,
        ownerOrderId: state.ownerOrderId.toString(),
        signed: false,
        submitted: false,
        executionSubmitted: false
      }
    };
  },

  validate(group, input): ShapeValidationResult {
    const errors: string[] = [];
    if (group.length === 0) {
      errors.push("Mallow order group is empty.");
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

export function assertMallowOrderEncodes(input: {
  transactions: readonly SerializedTransaction[];
  marketId: bigint;
  positionId?: bigint;
  builderAddress?: string;
}): void {
  const blob = Buffer.concat(
    input.transactions.flatMap((txn) =>
      (txn.applicationCall?.appArgsBase64 ?? []).map((arg) => Buffer.from(arg, "base64"))
    )
  );
  const marketBytes = Buffer.alloc(8);
  marketBytes.writeBigUInt64BE(input.marketId);
  if (!blob.includes(marketBytes)) {
    throw new Error(`Order group is missing market id ${input.marketId.toString()}.`);
  }
  if (input.positionId !== undefined) {
    const positionBytes = Buffer.alloc(8);
    positionBytes.writeBigUInt64BE(input.positionId);
    if (!blob.includes(positionBytes)) {
      throw new Error(`Order group is missing position id ${input.positionId.toString()}.`);
    }
  }
  if (input.builderAddress) {
    const addressBytes = Buffer.from(algosdk.decodeAddress(input.builderAddress).publicKey);
    if (!blob.includes(addressBytes)) {
      throw new Error("Order group is missing the Mallow builder address.");
    }
  }
}
