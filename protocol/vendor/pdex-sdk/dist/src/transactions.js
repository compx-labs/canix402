import { assignGroupID, encodeAddress, getApplicationAddress, makeApplicationNoOpTxnFromObject, makeAssetTransferTxnWithSuggestedParamsFromObject, makePaymentTxnWithSuggestedParamsFromObject, } from "algosdk";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { appMethod, loadManifest } from "./manifest.js";
import { decodeV2OracleSnapshotMessage, validateRawPrice12, } from "./oracle.js";
import { accountBytes, v2DynamicOiMarginBoxKey, v2CvaMarketAllocationBoxKey, v2CvaUserBoxKey, v2LpBoxKey, v2MarketAdaptiveFundingBoxKey, v2MarketCoreBoxKey, v2MarketFundingBorrowingBoxKey, v2MarketYieldBoxKey, v2MarketYieldStrategyConfigBoxKey, v2MarketYieldStrategyRuntimeBoxKey, v2MarketXalgoStrategyConfigBoxKey, v2MarketXalgoStrategyRuntimeBoxKey, v2MarketOpenInterestBoxKey, v2OrderBoxKey, v2MarketPoolBoxKey, v2MarketRiskBoxKey, v2PositionBoxKey, v2TraderBoxKey, v2VirtualPositionInventoryBoxKey, } from "./boxes.js";
import { concat, uint64Bytes } from "./codec.js";
import { UNCHECKED_CLOSE_POSITION_ID, HEAVY_METHOD_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_FINALIZATION_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_HOT_CHECK_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_MARK_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_REFRESH_ROUTER_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_RECALL_FLAT_FEE_MICRO_ALGO, NATIVE_ALGO_ASSET_ID, SIDE, TIME_IN_FORCE, V2_DECREASE_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_DECREASE_OR_CLOSE_METHOD_FLAT_FEE_MICRO_ALGO, V2_FUNDING_BORROWING_METHOD_FLAT_FEE_MICRO_ALGO, V2_CVA_MARKET_WITHDRAW_METHOD_FLAT_FEE_MICRO_ALGO, V2_CVA_METHOD_FLAT_FEE_MICRO_ALGO, V2_LIQUIDATION_METHOD_FLAT_FEE_MICRO_ALGO, V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO, V2_OPEN_ORDER_EXECUTION_STORAGE_ESCROW_MICRO_ALGO, V2_ORDER_BOX_MBR_MICRO_ALGO, V2_ORDER_BAD_PRICE_REASON, V2_ORDER_KIND, V2_ORDER_LINK_ID_MASK, V2_ORDER_LINK_MODE, V2_ORDER_LINK_MODE_FACTOR, V2_ORDER_OPS_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_DECREASE_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_INLINE_EXECUTION_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_TARGET, V2_OUTPUT_SWAP, V2_ROUTE_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_SINGLE_TOKEN_DECREASE_METHOD_FLAT_FEE_MICRO_ALGO, V2_SINGLE_TOKEN_INLINE_RECALL_METHOD_FLAT_FEE_MICRO_ALGO, V2_SWAP_EXACT_IN_METHOD_FLAT_FEE_MICRO_ALGO, V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO, V2_WITHDRAW_LIQUIDITY_METHOD_FLAT_FEE_MICRO_ALGO, V2_WITHDRAW_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_YIELD_MAX_POOL_CALL_FEE_MICRO_ALGO, V2_YIELD_PDEX_BASE_FLAT_FEE_MICRO_ALGO, XALGO_RESOURCE_ACCOUNT_LIMIT, } from "./constants.js";
export { UNCHECKED_CLOSE_POSITION_ID, HEAVY_METHOD_EXTRA_FEE_MICRO_ALGO, HEAVY_METHOD_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_FINALIZATION_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_HOT_CHECK_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_MARK_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_REFRESH_ROUTER_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_RECALL_PDEX_BASE_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_RECALL_FLAT_FEE_MICRO_ALGO, NATIVE_ALGO_ASSET_ID, SIDE, TIME_IN_FORCE, V2_ADMIN_OPS_METHOD_FLAT_FEE_MICRO_ALGO, V2_DECREASE_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_DECREASE_OR_CLOSE_METHOD_FLAT_FEE_MICRO_ALGO, V2_FUNDING_BORROWING_METHOD_FLAT_FEE_MICRO_ALGO, V2_CVA_MARKET_BOX_MBR_MICRO_ALGO, V2_CVA_MARKET_WITHDRAW_METHOD_FLAT_FEE_MICRO_ALGO, V2_CVA_METHOD_FLAT_FEE_MICRO_ALGO, V2_CVA_USER_BOX_MBR_MICRO_ALGO, V2_LIQUIDATION_METHOD_FLAT_FEE_MICRO_ALGO, V2_LP_BOX_MBR_MICRO_ALGO, V2_MARKET_BASE_BOX_MBR_MICRO_ALGO, V2_MARKETS_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO, V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO, V2_OPEN_ORDER_EXECUTION_STORAGE_ESCROW_MICRO_ALGO, V2_ORDER_BOX_MBR_MICRO_ALGO, V2_ORDER_BAD_PRICE_REASON, V2_ORDER_KIND, V2_ORDER_LINK_ID_MASK, V2_ORDER_LINK_MODE, V2_ORDER_LINK_MODE_FACTOR, V2_ORDER_OPS_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_DECREASE_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_INLINE_EXECUTION_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_TARGET, V2_OUTPUT_SWAP, V2_POSITION_BOX_MBR_MICRO_ALGO, V2_ROUTE_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_SINGLE_TOKEN_DECREASE_METHOD_FLAT_FEE_MICRO_ALGO, V2_SINGLE_TOKEN_INLINE_RECALL_METHOD_FLAT_FEE_MICRO_ALGO, V2_SWAP_EXACT_IN_METHOD_FLAT_FEE_MICRO_ALGO, V2_TRADER_BOX_MBR_MICRO_ALGO, V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO, V2_WITHDRAW_LIQUIDITY_METHOD_FLAT_FEE_MICRO_ALGO, V2_WITHDRAW_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_YIELD_MAX_EXTERNAL_PROTOCOL_FEE_MICRO_ALGO, V2_YIELD_PDEX_BASE_FLAT_FEE_MICRO_ALGO, XALGO_RESOURCE_ACCOUNT_LIMIT, } from "./constants.js";
export const V2_LARGE_PROGRAM_READ_BUDGET_REFS = {
    markets: 3,
    cva_vault: 2,
    trading: 1,
    single_token_trading: 1,
    order_ops: 1,
};
const V2_MARKETS_CALLER_METHODS = {
    PDexV2OrderOps: new Set(["execute_order", "submit_linked_order", "submit_order"]),
    PDexV2SingleTokenOps: new Set([
        "deposit_liquidity_single",
        "update_borrowing_single",
        "update_funding_single",
        "withdraw_liquidity_single",
    ]),
    PDexV2SingleTokenTrading: new Set([
        "decrease_or_close",
        "liquidate",
        "open_or_increase",
        "order_decrease_or_close",
        "order_open_or_increase",
    ]),
    PDexV2MarketYieldVault: new Set(["folks_mark_market_strategy"]),
    PDexV2MarketXAlgoYieldVault: new Set(["xalgo_mark_market_strategy"]),
    PDexV2AdminOps: new Set([
        "deposit_liquidity",
        "update_borrowing",
        "update_funding",
        "withdraw_liquidity",
        "withdraw_liquidity_with_swap",
    ]),
    PDexV2SwapOps: new Set(["swap_exact_in", "swap_exact_in_with_builder"]),
    PDexV2TradingRiskOps: new Set([
        "assert_position_admissible",
        "calculate_adl",
        "calculate_liquidation",
    ]),
    PDexV2Trading: new Set([
        "decrease_or_close",
        "liquidate",
        "open_or_increase",
        "order_decrease_or_close",
        "order_open_or_increase",
    ]),
    PDexV2CvaVault: new Set([
        "mark_market",
        "withdraw_from_market",
        "withdraw_to_idle",
    ]),
};
const V2_TRADING_CALLER_METHODS = {
    PDexV2OrderOps: new Set(["execute_order", "submit_linked_order", "submit_order"]),
};
const V2_TRANSACTION_GROUP_METADATA = Symbol("pdex.v2.transaction-group-metadata");
const V2_APPLICATION_CALL_METADATA = Symbol("pdex.v2.application-call-metadata");
function methodSelector(signature) {
    return sha512_256(new TextEncoder().encode(signature)).subarray(0, 4);
}
export function v2OrderPriceCoherenceFailure(input) {
    const orderKind = Number(input.orderKind);
    const side = Number(input.side);
    const triggerPrice = validateRawPrice12(input.triggerPrice, { allowZero: true });
    const acceptablePrice = validateRawPrice12(input.acceptablePrice, { allowZero: true });
    if (triggerPrice <= 0n || acceptablePrice <= 0n)
        return undefined;
    if (orderKind === V2_ORDER_KIND.OPEN_LIMIT) {
        if (side === SIDE.LONG && acceptablePrice < triggerPrice)
            return V2_ORDER_BAD_PRICE_REASON;
        if (side === SIDE.SHORT && acceptablePrice > triggerPrice)
            return V2_ORDER_BAD_PRICE_REASON;
        return undefined;
    }
    if (orderKind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT
        || orderKind === V2_ORDER_KIND.DECREASE_STOP_LOSS) {
        if (side === SIDE.LONG && acceptablePrice > triggerPrice)
            return V2_ORDER_BAD_PRICE_REASON;
        if (side === SIDE.SHORT && acceptablePrice < triggerPrice)
            return V2_ORDER_BAD_PRICE_REASON;
    }
    return undefined;
}
export function assertV2OrderPriceCoherent(input) {
    validateRawPrice12(input.triggerPrice);
    validateRawPrice12(input.acceptablePrice);
    const failure = v2OrderPriceCoherenceFailure(input);
    if (failure)
        throw new Error(failure);
}
function v2SubmitOrderFlatFee(input) {
    if (input.flatFeeMicroAlgo !== undefined)
        return input.flatFeeMicroAlgo;
    return v2OrderCrossedByOracle(input)
        ? V2_ORDER_OPS_INLINE_EXECUTION_METHOD_FLAT_FEE_MICRO_ALGO
        : V2_ORDER_OPS_METHOD_FLAT_FEE_MICRO_ALGO;
}
function v2OrderCrossedByOracle(input, onDecodeFailure = false) {
    let oracle;
    try {
        oracle = decodeV2OracleSnapshotMessage(bytes(input.oracleMessage));
    }
    catch {
        return onDecodeFailure;
    }
    const orderKind = Number(input.orderKind);
    const side = Number(input.side);
    const trigger = bigint(input.triggerPrice);
    const indexMin = oracle.indexMinPrice;
    const indexMax = oracle.indexMaxPrice;
    let crossed = false;
    if (orderKind === V2_ORDER_KIND.OPEN_LIMIT) {
        crossed = side === SIDE.LONG ? indexMax <= trigger : indexMin >= trigger;
    }
    else if (orderKind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT) {
        crossed = side === SIDE.LONG ? indexMin >= trigger : indexMax <= trigger;
    }
    else if (orderKind === V2_ORDER_KIND.DECREASE_STOP_LOSS) {
        crossed = side === SIDE.LONG ? indexMin <= trigger : indexMax >= trigger;
    }
    return crossed;
}
function encodeAppArgs(appName, methodName, values, manifest = loadManifest()) {
    const method = appMethod(appName, methodName, manifest);
    const argTypes = method.args.map((arg) => arg.type).filter((type) => !TXN_ARG_TYPES.has(type));
    if (argTypes.length !== values.length)
        throw new Error(`${methodName} expects ${argTypes.length} app args`);
    if (argTypes.length > 15) {
        const packedStart = 14;
        return [
            methodSelector(method.signature),
            ...argTypes.slice(0, packedStart).map((type, index) => encodeArg(type, values[index])),
            encodeTuple(argTypes.slice(packedStart), values.slice(packedStart)),
        ];
    }
    return [
        methodSelector(method.signature),
        ...argTypes.map((type, index) => encodeArg(type, values[index])),
    ];
}
export function buildV2WithdrawLiquidityCall(input) {
    const resourceCarrier = buildV2LpResourceCarrierCall(input);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId);
    const maxLongReceiptAmount = v2ActionRecallCap(input, "maxLongReceiptAmount", "max_long_receipt_amount");
    const maxShortReceiptAmount = v2ActionRecallCap(input, "maxShortReceiptAmount", "max_short_receipt_amount");
    const appCall = buildAppCall({
        appId: v2AdminOpsAppId(input),
        appName: "PDexV2AdminOps",
        methodName: "withdraw_liquidity",
        sender: input.sender,
        args: [
            input.marketId,
            input.shareAmount,
            input.minLongAmount,
            input.minShortAmount,
            input.oracleMessage,
            input.oracleSignature,
            v2YieldRecallMode(input),
            maxLongReceiptAmount,
            maxShortReceiptAmount,
        ],
        boxes: resourceCarrier
            ? v2MarketsOwnedBoxes(input.v2MarketsAppId, [v2LpBoxKey(input.sender, input.marketId)])
            : v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxesWithYieldFreshness(input, input.marketId, input.sender)),
        foreignApps: uniqueNumbers([
            input.v2MarketsAppId,
            v2AdminControlAppId(input),
        ]),
        foreignAssets: v2PoolAssets(input),
        flatFeeMicroAlgo: V2_WITHDRAW_LIQUIDITY_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    const baseCarriers = [...(resourceCarrier ? [resourceCarrier] : []), ...yieldFreshnessCarriers];
    const merged = mergeV2ActionRecallResources(appCall, input, v2TradingActionRecallAssets(input, maxLongReceiptAmount, maxShortReceiptAmount), Number(bigint(maxLongReceiptAmount) > 0n) + Number(bigint(maxShortReceiptAmount) > 0n), baseCarriers, Number(bigint(maxLongReceiptAmount) > 0n) + Number(bigint(maxShortReceiptAmount) > 0n), true);
    const withFee = withV2ActionXalgoProviderFeeCredit(merged, input, 1, [
        { marketId: input.marketId, assetId: input.longAssetId, receiptCap: maxLongReceiptAmount },
        { marketId: input.marketId, assetId: input.shortAssetId, receiptCap: maxShortReceiptAmount },
    ]);
    return {
        ...withFee,
        ...(resourceCarrier ? { resourceCarrier } : {}),
        ...(yieldFreshnessCarriers.length || (withFee.resourceCarriers?.length ?? 0)
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...(withFee.resourceCarriers ?? [])] }
            : {}),
    };
}
export function buildV2WithdrawLiquidityWithSwapCall(input) {
    const outputMode = v2WithdrawOutputMode(input);
    const resourceCarrier = buildV2LpResourceCarrierCall(input);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId);
    const maxLongReceiptAmount = v2ActionRecallCap(input, "maxLongReceiptAmount", "max_long_receipt_amount");
    const maxShortReceiptAmount = v2ActionRecallCap(input, "maxShortReceiptAmount", "max_short_receipt_amount");
    const appCall = buildAppCall({
        appId: v2AdminOpsAppId(input),
        appName: "PDexV2AdminOps",
        methodName: "withdraw_liquidity_with_swap",
        sender: input.sender,
        args: [
            input.marketId,
            input.shareAmount,
            outputMode,
            input.minPrimaryAmount ?? input.minOutputAmount ?? 0,
            input.minSecondaryAmount ?? 0,
            input.oracleMessage,
            input.oracleSignature,
            v2YieldRecallMode(input),
            maxLongReceiptAmount,
            maxShortReceiptAmount,
        ],
        boxes: resourceCarrier
            ? v2MarketsOwnedBoxes(input.v2MarketsAppId, [v2LpBoxKey(input.sender, input.marketId)])
            : v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxesWithYieldFreshness(input, input.marketId, input.sender)),
        foreignApps: outputMode === 0
            ? [input.v2MarketsAppId, v2AdminControlAppId(input)]
            : v2AdminOpsForeignApps(input),
        foreignAssets: v2WithdrawOutputAssets(input, outputMode),
        flatFeeMicroAlgo: V2_WITHDRAW_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    // Both pool assets may fund fees/impact even for a one-token withdrawal.
    const recallAssets = [];
    let recallCount = 0;
    if (bigint(maxLongReceiptAmount) > 0n) {
        recallAssets.push(input.longAssetId);
        recallCount += 1;
    }
    if (bigint(maxShortReceiptAmount) > 0n) {
        recallAssets.push(input.shortAssetId);
        recallCount += 1;
    }
    const baseCarriers = [...(resourceCarrier ? [resourceCarrier] : []), ...yieldFreshnessCarriers];
    const merged = mergeV2ActionRecallResources(appCall, input, recallAssets, recallCount, baseCarriers, recallCount, true);
    const withFee = withV2ActionXalgoProviderFeeCredit(merged, input, 1, [
        {
            marketId: input.marketId,
            assetId: input.longAssetId,
            receiptCap: maxLongReceiptAmount,
        },
        {
            marketId: input.marketId,
            assetId: input.shortAssetId,
            receiptCap: maxShortReceiptAmount,
        },
    ]);
    return {
        ...withFee,
        ...(resourceCarrier ? { resourceCarrier } : {}),
        ...(yieldFreshnessCarriers.length || (withFee.resourceCarriers?.length ?? 0)
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...(withFee.resourceCarriers ?? [])] }
            : {}),
    };
}
export function buildV2SwapExactInCall(input) {
    const tokenOutAssetId = v2SwapOutputAsset(input, input.tokenInAssetId);
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, MAX_SWAP_BUILDER_FEE_BPS);
    const assessedBuilderFee = builderFeeAmount(input.amountIn, builderFeeBps);
    const builderEnabled = assessedBuilderFee > 0n;
    const maxOutputReceiptAmount = v2ActionRecallCap(input, "maxOutputReceiptAmount", "max_output_receipt_amount");
    let marketBoxes = v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId));
    const foreignApps = v2SwapOpsForeignApps(input);
    const foreignAssets = foreignAsset(tokenOutAssetId);
    const marketResourceCarriers = [];
    if (marketBoxes.length + foreignApps.length + foreignAssets.length > 8) {
        const carrier = buildV2LpResourceCarrierCall(input);
        if (!carrier)
            throw new Error("v2MathAppId is required for direct swap resource carrier");
        marketResourceCarriers.push(carrier);
        marketBoxes = [];
    }
    const appCall = buildAppCall({
        appId: v2SwapOpsAppId(input),
        appName: "PDexV2SwapOps",
        methodName: builderEnabled ? "swap_exact_in_with_builder" : "swap_exact_in",
        sender: input.sender,
        args: builderEnabled
            ? [
                1,
                input.marketId,
                0,
                [builderAddress, builderFeeBps],
                input.minAmountOut,
                input.receiver ?? input.sender,
                input.oracleMessage,
                input.oracleSignature,
                new Uint8Array(),
                new Uint8Array(),
                v2YieldRecallMode(input),
                maxOutputReceiptAmount,
                0,
            ]
            : [
                1,
                input.marketId,
                0,
                input.minAmountOut,
                input.receiver ?? input.sender,
                input.oracleMessage,
                input.oracleSignature,
                new Uint8Array(),
                new Uint8Array(),
                v2YieldRecallMode(input),
                maxOutputReceiptAmount,
                0,
            ],
        boxes: marketBoxes,
        foreignApps,
        foreignAssets,
        flatFeeMicroAlgo: V2_SWAP_EXACT_IN_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId);
    const merged = mergeV2ActionRecallResources(appCall, input, [tokenOutAssetId], Number(bigint(maxOutputReceiptAmount) > 0n), [...marketResourceCarriers, ...yieldFreshnessCarriers], Number(bigint(maxOutputReceiptAmount) > 0n), true);
    const withFee = withV2ActionXalgoProviderFeeCredit(merged, input, 1, [{ marketId: input.marketId, assetId: tokenOutAssetId, receiptCap: maxOutputReceiptAmount }]);
    return {
        ...withFee,
        ...(marketResourceCarriers.length || yieldFreshnessCarriers.length || (withFee.resourceCarriers?.length ?? 0)
            ? { resourceCarriers: [...marketResourceCarriers, ...yieldFreshnessCarriers, ...(withFee.resourceCarriers ?? [])] }
            : {}),
    };
}
export function buildV2SwapRouteExactInCall(input) {
    if (input.hops.length < 1 || input.hops.length > 2)
        throw new Error("swap route supports one or two hops");
    const market0 = routeMarketId(input.hops[0]);
    const market1 = input.hops.length === 2 ? routeMarketId(input.hops[1]) : 0n;
    if (input.hops.length === 2 && market0 === market1)
        throw new Error("duplicate route markets are not supported");
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, MAX_SWAP_BUILDER_FEE_BPS);
    const assessedBuilderFee = builderFeeAmount(input.amountIn, builderFeeBps);
    const builderEnabled = assessedBuilderFee > 0n;
    const maxOutputReceiptAmount0 = v2ActionRecallCap(input, "maxOutputReceiptAmount0", "max_output_receipt_amount_0", "maxOutputReceiptAmount", "max_output_receipt_amount");
    const maxOutputReceiptAmount1 = v2ActionRecallCap(input, "maxOutputReceiptAmount1", "max_output_receipt_amount_1");
    const appCall = buildAppCall({
        appId: v2SwapOpsAppId(input),
        appName: "PDexV2SwapOps",
        methodName: builderEnabled ? "swap_exact_in_with_builder" : "swap_exact_in",
        sender: input.sender,
        args: builderEnabled
            ? [
                input.hops.length,
                market0,
                market1,
                [builderAddress, builderFeeBps],
                input.minFinalAmountOut,
                input.receiver ?? input.sender,
                routeOracleMessage(input.hops[0], input.oracleMessage),
                routeOracleSignature(input.hops[0], input.oracleSignature),
                input.hops.length === 2 ? routeOracleMessage(input.hops[1]) : new Uint8Array(),
                input.hops.length === 2 ? routeOracleSignature(input.hops[1]) : new Uint8Array(),
                v2YieldRecallMode(input),
                maxOutputReceiptAmount0,
                maxOutputReceiptAmount1,
            ]
            : [
                input.hops.length,
                market0,
                market1,
                input.minFinalAmountOut,
                input.receiver ?? input.sender,
                routeOracleMessage(input.hops[0], input.oracleMessage),
                routeOracleSignature(input.hops[0], input.oracleSignature),
                input.hops.length === 2 ? routeOracleMessage(input.hops[1]) : new Uint8Array(),
                input.hops.length === 2 ? routeOracleSignature(input.hops[1]) : new Uint8Array(),
                v2YieldRecallMode(input),
                maxOutputReceiptAmount0,
                maxOutputReceiptAmount1,
            ],
        boxes: [],
        foreignApps: v2SwapOpsForeignApps(input),
        foreignAssets: v2RouteAssets(input.hops),
        flatFeeMicroAlgo: V2_ROUTE_SWAP_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    const recallPairs = [];
    if (bigint(maxOutputReceiptAmount0) > 0n) {
        recallPairs.push({
            marketId: market0,
            assetId: v2SwapOutputAsset(input.hops[0], input.tokenInAssetId),
            receiptCap: maxOutputReceiptAmount0,
        });
    }
    if (input.hops.length === 2 && bigint(maxOutputReceiptAmount1) > 0n) {
        const hop1InputAssetId = v2SwapOutputAsset(input.hops[0], input.tokenInAssetId);
        recallPairs.push({
            marketId: market1,
            assetId: v2SwapOutputAsset(input.hops[1], hop1InputAssetId),
            receiptCap: maxOutputReceiptAmount1,
        });
    }
    const carriers = input.hops.flatMap((hop) => {
        const marketId = routeMarketId(hop);
        const carrierInput = { ...input, ...hop, marketId };
        return [
            requireV2LpResourceCarrier(buildV2LpResourceCarrierCall(carrierInput)),
            ...buildV2MarketYieldFreshnessResourceCarriers(carrierInput, input.sender, marketId),
        ];
    });
    const appCallWithResources = mergeV2RouteActionRecallResources(appCall, input, recallPairs, carriers);
    const withFee = withV2ActionXalgoProviderFeeCredit(appCallWithResources, input, 1, recallPairs);
    return {
        ...withFee,
        resourceCarriers: [...carriers, ...(withFee.resourceCarriers ?? [])],
    };
}
export function buildV2FundStorageCall(input) {
    return buildAppCall({
        appId: input.v2TradingAppId,
        appName: "PDexV2Trading",
        methodName: "fund_storage",
        sender: input.sender,
        args: [],
        boxes: [v2TraderBoxKey(input.sender)],
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
}
export function buildV2OpenOrIncreaseCall(input) {
    validateRawPrice12(input.acceptablePrice);
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, MAX_POSITION_BUILDER_FEE_BPS);
    const resourceCarrier = buildV2TradingResourceCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const riskOpsAppId = requiredV2TradingRiskOpsAppId(input);
    const dynamicOiCarriers = builderFeeBps > 0n
        ? [buildV2DynamicOiResourceCarrierCall(input, input.sender)]
        : [];
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input);
    const call = mergeV2AutomaticSettlementRecallResources(buildAppCall({
        appId: input.v2TradingAppId,
        appName: "PDexV2Trading",
        methodName: "open_or_increase",
        sender: input.sender,
        args: [
            input.marketId,
            input.side,
            input.sizeUsdDelta,
            input.acceptablePrice,
            [builderAddress, builderFeeBps],
            input.oracleMessage,
            input.oracleSignature,
        ],
        boxes: [
            ...v2TradingLocalBoxes(input, input.sender),
            ...(dynamicOiCarriers.length
                ? []
                : [[riskOpsAppId, v2DynamicOiMarginBoxKey(input.marketId)]]),
        ],
        foreignApps: v2TradingForeignApps(input, { includeRiskOps: true, includeMath: false }),
        foreignAssets: v2MarketAssets(input, input.collateralAssetId),
        accounts: v2TradingResourceAccounts(input),
        flatFeeMicroAlgo: BigInt(V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO)
            + (builderFeeBps > 0n ? 1000n : 0n),
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, [input.longAssetId, input.shortAssetId], [resourceCarrier, ...yieldFreshnessCarriers, ...dynamicOiCarriers]);
    const recallCarriers = call.resourceCarriers ?? [];
    return {
        ...call,
        resourceCarrier,
        ...(yieldFreshnessCarriers.length || dynamicOiCarriers.length || recallCarriers.length
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...dynamicOiCarriers, ...recallCarriers] }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
export function buildV2AddPositionMarginCall(input) {
    validateRawPrice12(input.acceptablePrice);
    const builderFee = normalizeBuilderFee(input.builderFee, 0);
    const resourceCarrier = buildV2PositionFactorsCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input);
    return {
        ...buildAppCall({
            appId: input.v2TradingAppId,
            appName: "PDexV2Trading",
            methodName: "open_or_increase",
            sender: input.sender,
            args: [
                input.marketId,
                input.side,
                0,
                input.acceptablePrice,
                builderFee,
                input.oracleMessage,
                input.oracleSignature,
            ],
            boxes: v2TradingLocalBoxes(input, input.sender),
            foreignApps: v2TradingForeignApps(input, { includeRiskOps: true, includeMath: false }),
            foreignAssets: v2MarketAssets(input, input.collateralAssetId),
            accounts: v2TradingResourceAccounts(input),
            flatFeeMicroAlgo: V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO,
            manifest: input.manifest ?? loadManifest(undefined, 2),
        }),
        resourceCarrier,
        ...(yieldFreshnessCarriers.length ? { resourceCarriers: yieldFreshnessCarriers } : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
function expectedClosePositionId(value) {
    if (value === undefined)
        throw new Error("expectedPositionId is required for a direct close or margin withdrawal");
    if (typeof value === "string" && !/^\d+$/.test(value))
        throw new Error("invalid expected position ID");
    const id = strictBigInt(value, "expected position ID");
    if (id !== UNCHECKED_CLOSE_POSITION_ID && (id < 0n || id >= 1n << 48n))
        throw new Error("invalid expected position ID");
    return id;
}
export function buildV2DecreaseOrCloseCall(input) {
    validateRawPrice12(input.acceptablePrice);
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, MAX_POSITION_BUILDER_FEE_BPS);
    const resourceCarrier = buildV2TradingResourceCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input);
    const yieldRecallMode = v2YieldRecallMode(input);
    const maxLongReceiptAmount = v2ActionRecallCap(input, "maxLongReceiptAmount", "max_long_receipt_amount");
    const maxShortReceiptAmount = v2ActionRecallCap(input, "maxShortReceiptAmount", "max_short_receipt_amount");
    const outputSwapMode = input.outputSwapMode ?? 0;
    const minPrimaryOutputAmount = input.minPrimaryOutputAmount ?? input.minPrimaryOutput ?? 0;
    const minSecondaryOutputAmount = input.minSecondaryOutputAmount ?? input.minSecondaryOutput ?? 0;
    const appCall = mergeV2ActionRecallResources(buildAppCall({
        appId: input.v2TradingAppId,
        appName: "PDexV2Trading",
        methodName: "decrease_or_close",
        sender: input.sender,
        args: [
            input.marketId,
            input.collateralAssetId,
            input.side,
            input.sizeUsdDelta,
            input.acceptablePrice,
            outputSwapMode,
            minPrimaryOutputAmount,
            minSecondaryOutputAmount,
            [builderAddress, builderFeeBps],
            input.oracleMessage,
            input.oracleSignature,
            yieldRecallMode,
            maxLongReceiptAmount,
            maxShortReceiptAmount,
            expectedClosePositionId(input.expectedPositionId),
        ],
        boxes: v2TradingLocalBoxes(input, input.sender),
        foreignApps: v2TradingForeignApps(input, { includeRiskOps: true }),
        foreignAssets: v2MarketAssets(input, input.collateralAssetId),
        accounts: v2TradingResourceAccounts(input),
        flatFeeMicroAlgo: bigint(closeFlatFeeMicroAlgo(input.flatFeeMicroAlgo, bigint(outputSwapMode) > 0n
            ? V2_DECREASE_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO
            : V2_DECREASE_OR_CLOSE_METHOD_FLAT_FEE_MICRO_ALGO)) + (builderFeeBps > 0n ? 1000n : 0n),
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, v2TradingActionRecallAssets(input, maxLongReceiptAmount, maxShortReceiptAmount), v2TradingActionRecallCount(input, maxLongReceiptAmount, maxShortReceiptAmount), [resourceCarrier, ...yieldFreshnessCarriers]);
    const referencePlannedCall = builderFeeBps > 0n
        ? relocateCarriedForeignAppForReferenceLimit(appCall, [input.v2MarketsAppId, Number(input.v2MathAppId ?? 0)], [resourceCarrier, ...yieldFreshnessCarriers, ...(appCall.resourceCarriers ?? [])])
        : appCall;
    const withFee = withV2ActionXalgoProviderFeeCredit(referencePlannedCall, input, 2, [
        { marketId: input.marketId, assetId: input.longAssetId, receiptCap: maxLongReceiptAmount },
        { marketId: input.marketId, assetId: input.shortAssetId, receiptCap: maxShortReceiptAmount },
    ]);
    return {
        ...withFee,
        resourceCarrier,
        ...(yieldFreshnessCarriers.length || (withFee.resourceCarriers?.length ?? 0)
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...(withFee.resourceCarriers ?? [])] }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
/** Prepare every possible pair-close payout asset before building or signing.
 * The contract decides whether a provider withdrawal is needed at execution.
 */
export async function prepareV2DecreaseOrCloseInput(client, input, outputs) {
    const { prepareV2ActionRecall } = await import("./marketYield.js");
    const recall = await prepareV2ActionRecall(client, {
        marketId: input.marketId,
        expectedMarketsAppId: input.v2MarketsAppId,
        indexAssetId: input.indexAssetId,
        assetIds: [input.longAssetId, input.shortAssetId],
        outputs,
        actionFamily: "trading",
        methodName: "decrease_or_close",
        marketYieldRegistry: input.marketYieldRegistry,
    });
    return {
        ...input,
        yieldRecallMode: recall.yieldRecallMode,
        maxLongReceiptAmount: recall.capForAsset(input.longAssetId),
        maxShortReceiptAmount: recall.capForAsset(input.shortAssetId),
        marketYieldRegistry: recall.marketYieldRegistry,
    };
}
export async function prepareV2DecreaseOrCloseTransactions(client, input, suggestedParams, outputs) {
    return buildV2DecreaseOrCloseTransactions(await prepareV2DecreaseOrCloseInput(client, input, outputs), suggestedParams);
}
export function buildV2WithdrawPositionMarginCall(input) {
    validateRawPrice12(input.acceptablePrice);
    const builderFee = normalizeBuilderFee(input.builderFee, 0);
    const resourceCarrier = buildV2PositionFactorsCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input);
    const yieldRecallMode = v2YieldRecallMode(input);
    const maxLongReceiptAmount = v2ActionRecallCap(input, "maxLongReceiptAmount", "max_long_receipt_amount");
    const maxShortReceiptAmount = v2ActionRecallCap(input, "maxShortReceiptAmount", "max_short_receipt_amount");
    const riskOpsAppId = requiredV2TradingRiskOpsAppId(input);
    const appCall = mergeV2ActionRecallResources(buildAppCall({
        appId: input.v2TradingAppId,
        appName: "PDexV2Trading",
        methodName: "decrease_or_close",
        sender: input.sender,
        args: [
            input.marketId,
            input.collateralAssetId,
            input.side,
            0,
            input.acceptablePrice,
            V2_OUTPUT_SWAP.NONE,
            input.collateralAmount,
            0,
            builderFee,
            input.oracleMessage,
            input.oracleSignature,
            yieldRecallMode,
            maxLongReceiptAmount,
            maxShortReceiptAmount,
            expectedClosePositionId(input.expectedPositionId),
        ],
        boxes: [
            ...v2TradingLocalBoxes(input, input.sender),
            [riskOpsAppId, v2DynamicOiMarginBoxKey(input.marketId)],
        ],
        foreignApps: v2TradingForeignApps(input, { includeRiskOps: true, includeMath: false }),
        foreignAssets: v2MarketAssets(input, input.collateralAssetId),
        accounts: v2TradingResourceAccounts(input),
        flatFeeMicroAlgo: V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, v2TradingActionRecallAssets(input, maxLongReceiptAmount, maxShortReceiptAmount), v2TradingActionRecallCount(input, maxLongReceiptAmount, maxShortReceiptAmount), [resourceCarrier, ...yieldFreshnessCarriers]);
    const withFee = withV2ActionXalgoProviderFeeCredit(appCall, input, 2, [
        { marketId: input.marketId, assetId: input.longAssetId, receiptCap: maxLongReceiptAmount },
        { marketId: input.marketId, assetId: input.shortAssetId, receiptCap: maxShortReceiptAmount },
    ]);
    return {
        ...withFee,
        resourceCarrier,
        ...(yieldFreshnessCarriers.length || (withFee.resourceCarriers?.length ?? 0)
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...(withFee.resourceCarriers ?? [])] }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
export function buildV2DecreaseOrCloseWithSwapCall(input) {
    return buildV2DecreaseOrCloseCall(input);
}
export function buildV2LiquidateCall(input) {
    return buildV2LiquidationCall(input);
}
function buildV2OrderOpsAppCall(input) {
    const defaultForeignApps = input.includeDefaultForeignApps === false
        ? []
        : [
            input.v2MarketsAppId,
            input.v2TradingAppId,
            input.v2TradingRiskOpsAppId ?? 0,
            input.v2SingleTokenTradingAppId ?? 0,
            input.v2MathAppId ?? 0,
        ];
    return buildAppCall({
        appId: v2OrderOpsAppId(input),
        appName: "PDexV2OrderOps",
        methodName: input.methodName,
        sender: input.sender,
        args: input.args,
        boxes: input.boxes ?? [],
        foreignApps: uniqueNumbers([
            ...(input.foreignApps ?? []),
            ...defaultForeignApps,
            ...(["submit_order", "submit_linked_order", "execute_order"].includes(input.methodName)
                ? [v2AdminControlAppId(input)]
                : []),
        ]),
        foreignAssets: uniqueNumbers((input.foreignAssets ?? []).filter((value) => Number(value) > 0)),
        accounts: input.accounts ?? [],
        flatFeeMicroAlgo: input.flatFeeMicroAlgo ?? V2_ORDER_OPS_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
}
export function v2OrderLinkMode(flags) {
    return Number(bigint(flags) / V2_ORDER_LINK_MODE_FACTOR);
}
export function v2OrderLinkBase(flags) {
    return bigint(flags) % V2_ORDER_LINK_MODE_FACTOR;
}
export function v2PackOrderLink(mode, baseOrderId) {
    const modeValue = Number(mode);
    const base = bigint(baseOrderId);
    if (modeValue < V2_ORDER_LINK_MODE.STANDALONE || modeValue > V2_ORDER_LINK_MODE.CHILD_ACTIVE) {
        throw new Error("bad link mode");
    }
    validateLinkBaseOrderId(base);
    return BigInt(modeValue) * V2_ORDER_LINK_MODE_FACTOR + base;
}
export function v2ExpectedLinkedChildOrderId(baseOrderId, orderKind) {
    const base = bigint(baseOrderId);
    validateLinkBaseOrderId(base);
    const kind = Number(orderKind);
    if (kind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT)
        return base + 1n;
    if (kind === V2_ORDER_KIND.DECREASE_STOP_LOSS)
        return base + 2n;
    throw new Error("bad child kind");
}
export function v2SiblingLinkedChildOrderId(baseOrderId, orderKind) {
    const base = bigint(baseOrderId);
    validateLinkBaseOrderId(base);
    const kind = Number(orderKind);
    if (kind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT)
        return base + 2n;
    if (kind === V2_ORDER_KIND.DECREASE_STOP_LOSS)
        return base + 1n;
    throw new Error("bad child kind");
}
export function v2OrderSubmitBoxRefs(input) {
    const targetKind = Number(input.targetKind);
    if (targetKind !== V2_ORDER_TARGET.PAIR && targetKind !== V2_ORDER_TARGET.SINGLE_TOKEN) {
        throw new Error("targetKind must be pair or single-token");
    }
    const refs = [
        v2OrderBoxKey(input.owner, input.ownerOrderId),
        [input.targetTradingAppId, v2TraderBoxKey(input.owner)],
        [input.targetTradingAppId, v2PositionBoxKey(input.owner, input.marketId, input.collateralAssetId, input.side)],
        ...v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId, undefined, input.indexAssetId)),
    ];
    if (input.orderKind === undefined || Number(input.orderKind) === V2_ORDER_KIND.OPEN_LIMIT) {
        const riskOpsAppId = Number(input.v2TradingRiskOpsAppId ?? 0);
        if (riskOpsAppId > 0)
            refs.push([riskOpsAppId, v2DynamicOiMarginBoxKey(input.marketId)]);
    }
    return refs;
}
export function v2LinkedOrderSubmitBoxRefs(input) {
    const targetKind = Number(input.targetKind);
    if (targetKind !== V2_ORDER_TARGET.PAIR && targetKind !== V2_ORDER_TARGET.SINGLE_TOKEN) {
        throw new Error("targetKind must be pair or single-token");
    }
    const refs = [
        v2OrderBoxKey(input.owner, input.ownerOrderId),
        ...v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId)),
    ];
    const ownerOrderId = bigint(input.ownerOrderId);
    const orderKind = Number(input.orderKind);
    const linkMode = Number(input.linkMode);
    const linkBaseOrderId = bigint(input.linkBaseOrderId);
    if (linkMode === V2_ORDER_LINK_MODE.BRACKET_PARENT) {
        if (orderKind !== V2_ORDER_KIND.OPEN_LIMIT)
            throw new Error("bad parent kind");
        if (ownerOrderId !== linkBaseOrderId)
            throw new Error("bad parent id");
    }
    else if (linkMode === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT ||
        linkMode === V2_ORDER_LINK_MODE.CHILD_ACTIVE) {
        const expectedChildId = v2ExpectedLinkedChildOrderId(linkBaseOrderId, orderKind);
        if (ownerOrderId !== expectedChildId)
            throw new Error("bad child id");
        refs.push(v2OrderBoxKey(input.owner, linkBaseOrderId));
    }
    else {
        throw new Error("bad link mode");
    }
    return uniqueBoxRefs(refs);
}
function v2OrderSubmitLocalBoxRefs(input) {
    return [
        v2OrderBoxKey(input.owner, input.ownerOrderId),
        [input.targetTradingAppId, v2TraderBoxKey(input.owner)],
        [input.targetTradingAppId, v2PositionBoxKey(input.owner, input.marketId, input.collateralAssetId, input.side)],
    ];
}
function v2OrderExecuteLocalBoxRefs(input) {
    const refs = v2OrderSubmitLocalBoxRefs(input);
    v2OrderExecuteLinkedBoxRefs(input);
    return refs;
}
function v2OrderExecuteLinkedBoxRefs(input) {
    const linkMode = Number(input.linkMode ?? V2_ORDER_LINK_MODE.STANDALONE);
    if (linkMode === V2_ORDER_LINK_MODE.STANDALONE) {
        if (bigint(input.linkBaseOrderId ?? 0) !== 0n)
            throw new Error("bad link base");
        return [];
    }
    const ownerOrderId = bigint(input.ownerOrderId);
    const orderKind = Number(input.orderKind);
    const linkBaseOrderId = bigint(input.linkBaseOrderId ?? 0);
    validateLinkBaseOrderId(linkBaseOrderId);
    if (linkMode === V2_ORDER_LINK_MODE.BRACKET_PARENT) {
        if (orderKind !== V2_ORDER_KIND.OPEN_LIMIT)
            throw new Error("bad parent kind");
        if (ownerOrderId !== linkBaseOrderId)
            throw new Error("bad parent id");
        const orderOpsAppId = v2OrderOpsAppId(input);
        return [
            [orderOpsAppId, v2OrderBoxKey(input.owner, linkBaseOrderId + 1n)],
            [orderOpsAppId, v2OrderBoxKey(input.owner, linkBaseOrderId + 2n)],
        ];
    }
    if (linkMode !== V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT && linkMode !== V2_ORDER_LINK_MODE.CHILD_ACTIVE) {
        throw new Error("bad link mode");
    }
    if (ownerOrderId !== v2ExpectedLinkedChildOrderId(linkBaseOrderId, orderKind)) {
        throw new Error("bad child id");
    }
    const orderOpsAppId = v2OrderOpsAppId(input);
    return [
        [orderOpsAppId, v2OrderBoxKey(input.owner, linkBaseOrderId)],
        [orderOpsAppId, v2OrderBoxKey(input.owner, v2SiblingLinkedChildOrderId(linkBaseOrderId, orderKind))],
    ];
}
function v2OrderExecutionPrimaryForeignApps(input, targetTradingAppId) {
    return [targetTradingAppId, v2AdminControlAppId(input)];
}
function buildV2OrderExecutionResourceCarrier(input, orderKind, linkedOrderBoxes = []) {
    const riskOpsAppId = Number(input.v2TradingRiskOpsAppId ?? 0);
    const includeRiskOps = riskOpsAppId > 0;
    const includeDynamicOiMargin = includeRiskOps && Number(orderKind) === V2_ORDER_KIND.OPEN_LIMIT;
    const foreignAssets = uniqueNumbers([
        ...v2PoolAssets(input),
        input.collateralAssetId ?? 0,
    ]);
    if (!includeRiskOps && foreignAssets.length === 0 && linkedOrderBoxes.length === 0)
        return undefined;
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for order execution resource carrier");
    const accounts = foreignAssets.length
        ? [
            addressString(getApplicationAddress(input.v2MarketsAppId)),
            addressString(input.owner ?? input.sender),
        ]
        : [];
    return buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender: input.sender,
        args: [],
        boxes: [
            ...(includeDynamicOiMargin ? [[riskOpsAppId, v2DynamicOiMarginBoxKey(input.marketId)]] : []),
            ...linkedOrderBoxes,
        ],
        foreignApps: uniqueNumbers([
            ...(includeRiskOps ? [riskOpsAppId] : []),
            ...linkedOrderBoxes
                .filter((ref) => Array.isArray(ref))
                .map((ref) => ref[0]),
        ]),
        foreignAssets,
        accounts,
        flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
}
function buildV2LinkedOrderMarketResourceCarrierCalls(input, ownerOrderIds = [input.ownerOrderId]) {
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for linked-order resource carrier");
    const immediateExecution = Number(input.linkMode) === V2_ORDER_LINK_MODE.BRACKET_PARENT;
    const carryAdaptiveWithYield = v2MarketYieldFreshnessBoxKeys(input, input.marketId).length > 0;
    const marketBoxes = v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId, undefined, immediateExecution ? v2IndexAssetId(input) : undefined, immediateExecution && !carryAdaptiveWithYield));
    const orderBoxes = ownerOrderIds.map((ownerOrderId) => [v2OrderOpsAppId(input), v2OrderBoxKey(input.sender, ownerOrderId)]);
    const marketCarrier = buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender: input.sender,
        args: [],
        boxes: marketBoxes,
        foreignApps: [input.v2MarketsAppId],
        flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    const orderCarrier = buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender: input.sender,
        args: [],
        boxes: orderBoxes,
        foreignApps: [v2OrderOpsAppId(input)],
        flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    return ownerOrderIds.length === 1 && !immediateExecution
        ? [buildAppCall({
                appId: mathAppId,
                appName: "PDexV2Math",
                methodName: "noop",
                sender: input.sender,
                args: [],
                boxes: [...marketBoxes, ...orderBoxes],
                foreignApps: [input.v2MarketsAppId, v2OrderOpsAppId(input)],
                flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
                manifest: input.manifest ?? loadManifest(undefined, 2),
            })]
        : [marketCarrier, orderCarrier];
}
function v2OrderSubmissionBinding(input) {
    const rawId = input.expectedPositionId;
    if (typeof rawId === "string" && !/^\d+$/.test(rawId))
        throw new Error("invalid expected position ID");
    const expected = rawId === undefined ? 0n : strictBigInt(rawId, "expected position ID");
    const offset = bigint(input.entryGroupOffset ?? 0);
    if (expected < 0n || expected >= 1n << 48n)
        throw new Error("position id out of range");
    if (offset < 0n || offset > 15n)
        throw new Error("entry group offset out of range");
    const unbound = Number(input.orderKind) === V2_ORDER_KIND.OPEN_LIMIT
        || Number(input.linkMode ?? 0) === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT;
    if (unbound) {
        if (expected !== 0n || offset !== 0n)
            throw new Error("unexpected position binding");
    }
    else if (offset > 0n) {
        if (expected !== 0n)
            throw new Error("unexpected expected position id");
    }
    else if (input.expectedPositionId === undefined) {
        throw new Error("expectedPositionId is required for an existing position");
    }
    return [expected, offset];
}
function v2OrderTradingRoles(targetKind) {
    return ["order_ops", "markets", targetKind === V2_ORDER_TARGET.SINGLE_TOKEN ? "single_token_trading" : "trading"];
}
export function buildV2SubmitOrderCall(input) {
    const binding = v2OrderSubmissionBinding(input);
    const targetKind = Number(input.targetKind);
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, targetKind === V2_ORDER_TARGET.PAIR ? MAX_POSITION_BUILDER_FEE_BPS : 0);
    const targetTradingAppId = targetKind === V2_ORDER_TARGET.SINGLE_TOKEN
        ? Number(input.v2SingleTokenTradingAppId ?? 0)
        : Number(input.v2TradingAppId);
    if (targetTradingAppId <= 0)
        throw new Error("target trading app id is required");
    assertV2OrderPriceCoherent(input);
    assertV2DecreaseOrderMarketAssets(input, targetKind);
    if (Number(input.orderKind) === V2_ORDER_KIND.OPEN_LIMIT)
        requiredV2TradingRiskOpsAppId(input);
    const resourceCarrier = buildV2TradingResourceCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const executionResourceCarrier = buildV2OrderExecutionResourceCarrier(input, input.orderKind);
    let call = buildAppCall({
        appId: v2OrderOpsAppId(input),
        appName: "PDexV2OrderOps",
        methodName: "submit_order",
        sender: input.sender,
        args: [
            input.ownerOrderId,
            input.orderKind,
            input.targetKind,
            input.marketId,
            input.side,
            input.collateralAssetId,
            input.sizeUsdDelta,
            input.collateralAmount,
            input.triggerPrice,
            input.acceptablePrice,
            input.keeperFeeAssetId,
            input.keeperFeeAmount,
            input.outputSwapMode ?? V2_OUTPUT_SWAP.NONE,
            input.minPrimaryOutputAmount ?? 0,
            input.minSecondaryOutputAmount ?? 0,
            input.timeInForce,
            input.expiryTime ?? 0,
            ...binding,
            [builderAddress, builderFeeBps],
            input.oracleMessage,
            input.oracleSignature,
        ],
        boxes: [
            ...v2OrderSubmitLocalBoxRefs({
                owner: input.sender,
                ownerOrderId: input.ownerOrderId,
                targetTradingAppId,
                marketId: input.marketId,
                collateralAssetId: input.collateralAssetId,
                side: input.side,
            }),
        ],
        foreignApps: v2OrderExecutionPrimaryForeignApps(input, targetTradingAppId),
        foreignAssets: uniqueNumbers([input.collateralAssetId, input.keeperFeeAssetId]),
        accounts: builderFeeBps > 0n ? [builderAddress] : [],
        flatFeeMicroAlgo: bigint(v2SubmitOrderFlatFee(input))
            + (builderFeeBps > 0n ? 1000n : 0n),
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    if (Number(input.orderKind) === V2_ORDER_KIND.OPEN_LIMIT
        && v2OrderCrossedByOracle(input, true)) {
        call = mergeV2AutomaticSettlementRecallResources(call, input, targetKind === V2_ORDER_TARGET.SINGLE_TOKEN
            ? [input.collateralAssetId]
            : [input.longAssetId ?? 0, input.shortAssetId ?? 0], [
            resourceCarrier,
            ...yieldFreshnessCarriers,
            ...(executionResourceCarrier ? [executionResourceCarrier] : []),
        ]);
    }
    const settlementRecallCarriers = call.resourceCarriers ?? [];
    call.abiTransactionArgs = ["escrow_transfer", "storage_payment"];
    call.largeProgramRoles = v2OrderTradingRoles(targetKind);
    call.resourceCarrier = resourceCarrier;
    call.resourceCarriers = [
        ...yieldFreshnessCarriers,
        ...(executionResourceCarrier ? [executionResourceCarrier] : []),
        ...settlementRecallCarriers,
    ];
    if (!call.resourceCarriers.length)
        delete call.resourceCarriers;
    return call;
}
function assertV2DecreaseOrderMarketAssets(input, targetKind) {
    const orderKind = Number(input.orderKind);
    if (orderKind !== V2_ORDER_KIND.DECREASE_TAKE_PROFIT
        && orderKind !== V2_ORDER_KIND.DECREASE_STOP_LOSS)
        return;
    if (targetKind === V2_ORDER_TARGET.PAIR) {
        if (input.longAssetId === undefined || input.shortAssetId === undefined) {
            throw new Error("pair decrease order requires longAssetId and shortAssetId");
        }
        return;
    }
    if (targetKind === V2_ORDER_TARGET.SINGLE_TOKEN) {
        if (input.backingAssetId === undefined) {
            throw new Error("single-token decrease order requires backingAssetId");
        }
        return;
    }
    throw new Error("targetKind must be pair or single-token");
}
export function buildV2SubmitLinkedOrderCall(input) {
    const binding = v2OrderSubmissionBinding(input);
    const targetKind = Number(input.targetKind);
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, targetKind === V2_ORDER_TARGET.PAIR ? MAX_POSITION_BUILDER_FEE_BPS : 0);
    const targetTradingAppId = targetKind === V2_ORDER_TARGET.SINGLE_TOKEN
        ? Number(input.v2SingleTokenTradingAppId ?? 0)
        : Number(input.v2TradingAppId);
    if (targetTradingAppId <= 0)
        throw new Error("target trading app id is required");
    assertV2OrderPriceCoherent(input);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, Number(input.linkMode) === V2_ORDER_LINK_MODE.BRACKET_PARENT);
    const executionResourceCarrier = Number(input.linkMode) === V2_ORDER_LINK_MODE.BRACKET_PARENT
        ? buildV2OrderExecutionResourceCarrier(input, input.orderKind)
        : undefined;
    const linkedBoxRefs = v2LinkedOrderSubmitBoxRefs({
        owner: input.sender,
        ownerOrderId: input.ownerOrderId,
        orderKind: input.orderKind,
        targetKind: input.targetKind,
        targetTradingAppId,
        v2MarketsAppId: input.v2MarketsAppId,
        marketId: input.marketId,
        collateralAssetId: input.collateralAssetId,
        side: input.side,
        linkMode: input.linkMode,
        linkBaseOrderId: input.linkBaseOrderId,
    });
    const immediateExecutionBoxes = Number(input.linkMode) === V2_ORDER_LINK_MODE.BRACKET_PARENT
        ? [
            [targetTradingAppId, v2TraderBoxKey(input.sender)],
            [targetTradingAppId, v2PositionBoxKey(input.sender, input.marketId, input.collateralAssetId, input.side)],
        ]
        : Number(input.linkMode) === V2_ORDER_LINK_MODE.CHILD_ACTIVE
            ? [[targetTradingAppId, v2PositionBoxKey(input.sender, input.marketId, input.collateralAssetId, input.side)]]
            : [];
    let call = buildAppCall({
        appId: v2OrderOpsAppId(input),
        appName: "PDexV2OrderOps",
        methodName: "submit_linked_order",
        sender: input.sender,
        args: [
            input.ownerOrderId,
            input.orderKind,
            input.targetKind,
            input.marketId,
            input.side,
            input.collateralAssetId,
            input.sizeUsdDelta,
            input.collateralAmount,
            input.triggerPrice,
            input.acceptablePrice,
            input.keeperFeeAssetId,
            input.keeperFeeAmount,
            input.outputSwapMode ?? V2_OUTPUT_SWAP.NONE,
            input.minPrimaryOutputAmount ?? 0,
            input.minSecondaryOutputAmount ?? 0,
            input.timeInForce,
            input.expiryTime ?? 0,
            input.linkMode,
            input.linkBaseOrderId,
            ...binding,
            [builderAddress, builderFeeBps],
            input.oracleMessage,
            input.oracleSignature,
        ],
        boxes: [
            ...linkedBoxRefs.filter((ref) => !Array.isArray(ref)).slice(1),
            ...immediateExecutionBoxes,
        ],
        foreignApps: [targetTradingAppId, v2AdminControlAppId(input)],
        foreignAssets: uniqueNumbers([input.collateralAssetId, input.keeperFeeAssetId]),
        accounts: builderFeeBps > 0n ? [builderAddress] : [],
        flatFeeMicroAlgo: v2SubmitOrderFlatFee(input),
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    if (Number(input.linkMode) === V2_ORDER_LINK_MODE.BRACKET_PARENT
        && v2OrderCrossedByOracle(input, true)) {
        call = mergeV2AutomaticSettlementRecallResources(call, input, targetKind === V2_ORDER_TARGET.SINGLE_TOKEN
            ? [input.collateralAssetId]
            : [input.longAssetId ?? 0, input.shortAssetId ?? 0], [
            ...yieldFreshnessCarriers,
            ...(executionResourceCarrier ? [executionResourceCarrier] : []),
        ]);
    }
    const settlementRecallCarriers = call.resourceCarriers ?? [];
    call.abiTransactionArgs = ["escrow_transfer", "storage_payment"];
    call.largeProgramRoles = Number(input.linkMode) === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT
        ? ["order_ops", "markets"]
        : v2OrderTradingRoles(targetKind);
    call.resourceCarriers = [
        ...yieldFreshnessCarriers,
        ...(executionResourceCarrier ? [executionResourceCarrier] : []),
        ...settlementRecallCarriers,
    ];
    if (!call.resourceCarriers.length)
        delete call.resourceCarriers;
    return call;
}
export function buildV2ExecuteOrderCall(input) {
    if (input.cleanup !== undefined)
        return buildV2OrderCleanupCall(input);
    const targetKind = Number(input.v2SingleTokenTradingAppId ?? 0) > 0
        && Number(input.targetTradingAppId) === Number(input.v2SingleTokenTradingAppId)
        ? V2_ORDER_TARGET.SINGLE_TOKEN
        : V2_ORDER_TARGET.PAIR;
    const orderKind = Number(input.orderKind ?? V2_ORDER_KIND.OPEN_LIMIT);
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, targetKind === V2_ORDER_TARGET.PAIR ? MAX_POSITION_BUILDER_FEE_BPS : 0);
    const resourceCarrier = buildV2TradingResourceCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    let maxLongReceiptAmount = v2ActionRecallCap(input, "maxLongReceiptAmount", "max_long_receipt_amount");
    const maxShortReceiptAmount = v2ActionRecallCap(input, "maxShortReceiptAmount", "max_short_receipt_amount");
    const maxBackingReceiptAmount = v2ActionRecallCap(input, "maxBackingReceiptAmount", "max_backing_receipt_amount");
    if (targetKind === V2_ORDER_TARGET.SINGLE_TOKEN && bigint(maxBackingReceiptAmount) > 0n) {
        maxLongReceiptAmount = maxBackingReceiptAmount;
    }
    const base = buildV2OrderOpsAppCall({
        ...input,
        methodName: "execute_order",
        args: [
            input.owner,
            input.ownerOrderId,
            input.oracleMessage,
            input.oracleSignature,
            v2YieldRecallMode(input),
            maxLongReceiptAmount,
            maxShortReceiptAmount,
        ],
        accounts: [
            input.owner,
            ...(builderFeeBps > 0n ? [builderAddress] : []),
        ],
        boxes: v2OrderExecuteLocalBoxRefs({
            owner: input.owner,
            ownerOrderId: input.ownerOrderId,
            orderKind,
            v2OrderOpsAppId: input.v2OrderOpsAppId,
            targetTradingAppId: input.targetTradingAppId,
            marketId: input.marketId,
            collateralAssetId: input.collateralAssetId,
            side: input.side,
            linkMode: input.linkMode,
            linkBaseOrderId: input.linkBaseOrderId,
        }),
        foreignAssets: foreignAsset(input.collateralAssetId),
        foreignApps: v2OrderExecutionPrimaryForeignApps(input, input.targetTradingAppId),
        includeDefaultForeignApps: false,
        flatFeeMicroAlgo: input.flatFeeMicroAlgo
            ?? BigInt(v2OrderExecutionFlatFeeMicroAlgo(orderKind))
                + (builderFeeBps > 0n ? 1000n : 0n),
    });
    let merged;
    if (orderKind === V2_ORDER_KIND.OPEN_LIMIT) {
        merged = mergeV2AutomaticSettlementRecallResources(base, input, targetKind === V2_ORDER_TARGET.SINGLE_TOKEN
            ? [input.collateralAssetId]
            : [input.longAssetId ?? 0, input.shortAssetId ?? 0], [resourceCarrier, ...yieldFreshnessCarriers]);
    }
    else if (targetKind === V2_ORDER_TARGET.SINGLE_TOKEN) {
        merged = mergeV2SingleTokenActionRecallResources(base, {
            ...input,
            marketId: input.marketId,
            backingAssetId: input.collateralAssetId,
        }, maxLongReceiptAmount, true, [resourceCarrier, ...yieldFreshnessCarriers]);
    }
    else {
        merged = mergeV2ActionRecallResources(base, input, v2TradingActionRecallAssets(input, maxLongReceiptAmount, maxShortReceiptAmount), v2TradingActionRecallCount(input, maxLongReceiptAmount, maxShortReceiptAmount), [resourceCarrier, ...yieldFreshnessCarriers]);
    }
    const withFee = withV2ActionXalgoProviderFeeCredit(merged, input, 2, orderKind === V2_ORDER_KIND.OPEN_LIMIT
        ? []
        : targetKind === V2_ORDER_TARGET.SINGLE_TOKEN
            ? [{ marketId: input.marketId, assetId: input.collateralAssetId, receiptCap: maxLongReceiptAmount }]
            : [
                { marketId: input.marketId, assetId: input.longAssetId ?? -1, receiptCap: maxLongReceiptAmount },
                { marketId: input.marketId, assetId: input.shortAssetId ?? -1, receiptCap: maxShortReceiptAmount },
            ]);
    const executionResourceCarrier = buildV2OrderExecutionResourceCarrier(input, orderKind, v2OrderExecuteLinkedBoxRefs({
        owner: input.owner,
        ownerOrderId: input.ownerOrderId,
        orderKind,
        v2OrderOpsAppId: input.v2OrderOpsAppId,
        linkMode: input.linkMode,
        linkBaseOrderId: input.linkBaseOrderId,
    }));
    if (executionResourceCarrier && executionResourceCarrier.boxes.length + executionResourceCarrier.foreignApps.length
        + executionResourceCarrier.foreignAssets.length + executionResourceCarrier.accounts.length > 8) {
        // Parent activation adds two child boxes. Share the owner account already
        // provided by the primary execution call.
        executionResourceCarrier.accounts = executionResourceCarrier.accounts.filter((account) => account !== addressString(input.owner));
    }
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input, { singleToken: targetKind === V2_ORDER_TARGET.SINGLE_TOKEN });
    return {
        ...withFee,
        largeProgramRoles: v2OrderTradingRoles(targetKind),
        resourceCarrier,
        ...((withFee.resourceCarriers?.length ?? 0) || yieldFreshnessCarriers.length || executionResourceCarrier
            ? {
                resourceCarriers: [
                    ...yieldFreshnessCarriers,
                    ...(withFee.resourceCarriers ?? []),
                    ...(executionResourceCarrier ? [executionResourceCarrier] : []),
                ],
            }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
function buildV2OrderCleanupCall(input) {
    if (input.cleanup !== "orphan")
        throw new Error("legacy orders remain executable; only orphan cleanup is supported");
    const orderKind = Number(input.orderKind);
    const linkMode = Number(input.linkMode ?? V2_ORDER_LINK_MODE.STANDALONE);
    v2OrderExecuteLinkedBoxRefs({
        owner: input.owner, ownerOrderId: input.ownerOrderId, orderKind,
        v2OrderOpsAppId: input.v2OrderOpsAppId, linkMode: input.linkMode, linkBaseOrderId: input.linkBaseOrderId,
    });
    if (orderKind !== V2_ORDER_KIND.DECREASE_TAKE_PROFIT && orderKind !== V2_ORDER_KIND.DECREASE_STOP_LOSS
        || (linkMode === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT && input.schemaVersion !== 3)) {
        throw new Error("only active TP/SL can be orphan cleanup candidates");
    }
    const roles = ["order_ops", input.targetTradingAppId === input.v2SingleTokenTradingAppId ? "single_token_trading" : "trading"];
    const boxes = [v2OrderBoxKey(input.owner, input.ownerOrderId),
        [input.targetTradingAppId, v2PositionBoxKey(input.owner, input.marketId, input.collateralAssetId, input.side)]];
    const foreignApps = [v2AdminControlAppId(input), input.targetTradingAppId];
    if (linkMode === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT) {
        boxes.push([v2OrderOpsAppId(input), v2OrderBoxKey(input.owner, input.linkBaseOrderId)]);
    }
    const call = buildAppCall({
        appId: v2OrderOpsAppId(input), appName: "PDexV2OrderOps", methodName: "execute_order",
        sender: input.sender,
        args: [input.owner, input.ownerOrderId, new Uint8Array(), new Uint8Array(), 0, 0, 0],
        boxes, foreignApps,
        foreignAssets: uniqueNumbers([input.collateralAssetId, input.keeperFeeAssetId ?? input.collateralAssetId]),
        accounts: [input.owner],
        flatFeeMicroAlgo: input.flatFeeMicroAlgo ?? 20000n,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    call.largeProgramRoles = roles;
    // Reuse the existing Math carrier only when the primary cannot hold its budget.
    return fundV2LargeProgramBudgetAcrossCalls(call, [], roles, input.v2MathAppId, input.sender, input.manifest);
}
export function buildV2CancelOrderCall(input) {
    return buildV2OrderOpsAppCall({
        ...input,
        methodName: "cancel_order",
        args: [input.ownerOrderId],
        boxes: v2CancelOrderBoxRefs(input.sender, input.ownerOrderId, {
            attachedTakeProfitOrderId: input.attachedTakeProfitOrderId,
            attachedStopLossOrderId: input.attachedStopLossOrderId,
        }),
        foreignAssets: uniqueNumbers([input.collateralAssetId ?? 0, input.keeperFeeAssetId ?? 0]),
        includeDefaultForeignApps: false,
    });
}
export function buildV2CancelExpiredOrderCall(input) {
    return buildV2OrderOpsAppCall({
        ...input,
        methodName: "cancel_expired_order",
        args: [input.owner, input.ownerOrderId],
        accounts: [input.owner],
        boxes: v2CancelOrderBoxRefs(input.owner, input.ownerOrderId, {
            attachedTakeProfitOrderId: input.attachedTakeProfitOrderId,
            attachedStopLossOrderId: input.attachedStopLossOrderId,
        }),
        foreignAssets: [Number(input.keeperFeeAssetId ?? 0)],
        includeDefaultForeignApps: false,
    });
}
function buildV2UpdateFundingCall(input) {
    const resourceCarrier = buildV2LpResourceCarrierCall({ ...input, includeAdaptiveFunding: true });
    const record = input;
    const yieldFreshnessCarriers = record.skipMarketYieldFreshnessCarrier || record.skip_market_yield_freshness_carrier
        ? []
        : buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId);
    return {
        ...buildAppCall({
            appId: v2AdminOpsAppId(input),
            appName: "PDexV2AdminOps",
            methodName: "update_funding",
            sender: input.sender,
            args: [input.marketId, input.oracleMessage, input.oracleSignature],
            boxes: resourceCarrier
                ? []
                : v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId, undefined, undefined, true)),
            foreignApps: v2AdminOpsForeignApps(input),
            foreignAssets: [],
            flatFeeMicroAlgo: V2_FUNDING_BORROWING_METHOD_FLAT_FEE_MICRO_ALGO,
            manifest: input.manifest ?? loadManifest(undefined, 2),
        }),
        ...(resourceCarrier ? { resourceCarrier } : {}),
        ...(yieldFreshnessCarriers.length ? { resourceCarriers: yieldFreshnessCarriers } : {}),
    };
}
function buildV2UpdateBorrowingCall(input) {
    const call = buildAppCall({
        appId: v2AdminOpsAppId(input),
        appName: "PDexV2AdminOps",
        methodName: "update_borrowing",
        sender: input.sender,
        args: [input.marketId, input.oracleMessage, input.oracleSignature],
        boxes: v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId)),
        foreignApps: uniqueNumbers([
            input.v2MarketsAppId,
            v2AdminControlAppId(input),
        ]),
        foreignAssets: [],
        flatFeeMicroAlgo: V2_FUNDING_BORROWING_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    return fundV2LargeProgramBudgetWithMathCarriers(call, ["markets"], input.v2MathAppId, input.sender, input.manifest);
}
function buildV2SettlementMaintenanceCalls(input, options = {}) {
    if (input.settlementMaintenance === false || input.settlement_maintenance === false)
        return [];
    const maintenanceDue = v2SettlementMaintenanceDue(input);
    const singleToken = Boolean(options.singleToken);
    const appId = singleToken
        ? Number(input.v2SingleTokenOpsAppId ?? 0)
        : Number(input.v2AdminOpsAppId ?? input.v2AdminAppId ?? 0);
    if (appId <= 0) {
        if (maintenanceDue === true)
            throw new Error("settlement_maintenance_app_id_missing");
        return [];
    }
    const target = singleToken ? "single_token_ops" : "admin_ops";
    const oracle = settlementMaintenanceOracle(input, appId, target);
    if (!oracle) {
        if (maintenanceDue === true)
            throw new Error("settlement_maintenance_material_missing");
        return [];
    }
    if (singleToken) {
        const record = input;
        const maintenanceInput = {
            ...input,
            v2MarketsAppId: Number(input.v2MarketsAppId ?? 0),
            v2SingleTokenOpsAppId: appId,
            backingAssetId: input.backingAssetId ?? input.longAssetId ?? record.collateralAssetId ?? 0,
            oracleMessage: oracle.oracleMessage,
            oracleSignature: oracle.oracleSignature,
            skipMarketYieldFreshnessCarrier: true,
        };
        return [
            ...flattenAppCallDescriptor(buildV2SingleTokenUpdateFundingCall(maintenanceInput)),
            ...flattenAppCallDescriptor(buildV2SingleTokenUpdateBorrowingCall(maintenanceInput)),
        ];
    }
    const maintenanceInput = {
        ...input,
        v2MarketsAppId: Number(input.v2MarketsAppId ?? 0),
        v2TradingAppId: Number(input.v2TradingAppId ?? 0),
        v2AdminOpsAppId: appId,
        longAssetId: input.longAssetId ?? 0,
        shortAssetId: input.shortAssetId ?? 0,
        indexAssetId: input.indexAssetId ?? 0,
        oracleMessage: oracle.oracleMessage,
        oracleSignature: oracle.oracleSignature,
        skipMarketYieldFreshnessCarrier: true,
    };
    return [
        ...flattenAppCallDescriptor(buildV2UpdateFundingCall(maintenanceInput)),
        ...flattenAppCallDescriptor(buildV2UpdateBorrowingCall(maintenanceInput)),
    ];
}
export function v2SettlementMaintenanceDue(input) {
    const explicitDue = input.settlementMaintenanceDue ?? input.settlement_maintenance_due;
    if (explicitDue === true)
        return true;
    if (input.settlementMaintenance === true || input.settlement_maintenance === true)
        return true;
    const state = input.settlementMaintenanceState ?? input.settlement_maintenance_state;
    if (!state)
        return explicitDue;
    const interval = bigint(state.funding_interval_seconds ?? state.fundingIntervalSeconds ?? 0);
    const lastFunding = bigint(state.last_funding_time ?? state.lastFundingTime ?? 0);
    const lastBorrowing = bigint(state.last_borrowing_time ?? state.lastBorrowingTime ?? 0);
    let currentTime = 0n;
    try {
        currentTime = decodeV2OracleSnapshotMessage(bytes(input.oracleMessage)).publishedAt;
    }
    catch {
        currentTime = bigint(state.oracle_timestamp ?? state.oracleTimestamp ?? 0);
    }
    if (currentTime <= 0n)
        throw new Error("settlement_maintenance_state_incomplete");
    if (interval <= 0n || lastFunding <= 0n || lastBorrowing <= 0n)
        return true;
    return (currentTime - lastFunding) / interval > 0n || (currentTime - lastBorrowing) / interval > 0n;
}
function closeFlatFeeMicroAlgo(value, fallback) {
    const resolved = value === undefined ? BigInt(fallback) : bigint(value);
    if (resolved <= 0n)
        throw new Error("invalid_close_fee_microalgos");
    return resolved;
}
export function v2OrderExecutionFlatFeeMicroAlgo(orderKind) {
    return Number(orderKind) === V2_ORDER_KIND.OPEN_LIMIT
        ? V2_ORDER_OPS_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO
        : V2_ORDER_OPS_DECREASE_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO;
}
function settlementMaintenanceOracle(input, appId, target) {
    const record = input;
    const directPairs = target === "single_token_ops"
        ? [
            ["singleTokenOpsOracleMessage", "singleTokenOpsOracleSignature"],
            ["single_token_ops_oracle_message", "single_token_ops_oracle_signature"],
        ]
        : [
            ["adminOpsOracleMessage", "adminOpsOracleSignature"],
            ["admin_ops_oracle_message", "admin_ops_oracle_signature"],
        ];
    for (const [messageKey, signatureKey] of [
        ...directPairs,
        ["settlementMaintenanceOracleMessage", "settlementMaintenanceOracleSignature"],
        ["settlement_maintenance_oracle_message", "settlement_maintenance_oracle_signature"],
        ["maintenanceOracleMessage", "maintenanceOracleSignature"],
        ["maintenance_oracle_message", "maintenance_oracle_signature"],
    ]) {
        const message = record[messageKey];
        const signature = record[signatureKey];
        if (message !== undefined && signature !== undefined) {
            return { oracleMessage: bytes(message), oracleSignature: bytes(signature) };
        }
    }
    const payload = settlementMaintenancePayload(input, appId, target);
    if (!payload)
        return undefined;
    return {
        oracleMessage: payloadBytes(payload, "oracleMessage", "message", "message_hex"),
        oracleSignature: payloadBytes(payload, "oracleSignature", "signature", "signature_hex"),
    };
}
function settlementMaintenancePayload(input, appId, target) {
    const record = input;
    const sources = [
        input.settlementMaintenanceOracles,
        input.settlement_maintenance_oracles,
        input.maintenanceOracles,
        input.maintenance_oracles,
        input.oraclePayloads,
        input.oracle_payloads,
        input.oraclePayload,
        input.oracle_payload,
    ];
    const marketId = bigint(input.marketId);
    const keys = [
        `app-${appId}/market-${marketId.toString()}`,
        String(appId),
        target,
        target.replace("_", "-"),
        target === "single_token_ops" ? "PDexV2SingleTokenOps" : "PDexV2AdminOps",
    ];
    for (const source of sources) {
        if (!source || typeof source !== "object")
            continue;
        const payloads = (source.payloads ?? source);
        for (const key of keys) {
            const payload = payloads[key];
            if (payload)
                return payload;
        }
        for (const payload of Object.values(payloads)) {
            if (!payload || typeof payload !== "object")
                continue;
            const payloadApp = payload.appId ?? payload.app_id;
            const payloadMarket = payload.marketId ?? payload.market_id;
            if (payloadApp !== undefined && Number(payloadApp) === appId && (payloadMarket === undefined || bigint(payloadMarket) === marketId)) {
                return payload;
            }
        }
    }
    const nestedPayloads = record.payloads;
    if (nestedPayloads && typeof nestedPayloads === "object") {
        return settlementMaintenancePayload({ ...input, oraclePayloads: nestedPayloads }, appId, target);
    }
    return undefined;
}
function flattenAppCallDescriptor(call) {
    return [
        call,
        ...(call.resourceCarrier ? [call.resourceCarrier] : []),
        ...(call.resourceCarriers ?? []),
    ];
}
function buildV2CvaMarkMarketCall(input) {
    const cvaVaultAppId = v2CvaVaultAppId(input);
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for CVA mark_market resource carrier");
    const cvaAddress = addressString(getApplicationAddress(cvaVaultAppId));
    const manifest = input.manifest ?? loadManifest(undefined, 2);
    const call = buildAppCall({
        appId: cvaVaultAppId,
        appName: "PDexV2CvaVault",
        methodName: "mark_market",
        sender: input.sender,
        args: [input.marketId, input.oracleMessage, input.oracleSignature],
        boxes: [
            v2CvaMarketAllocationBoxKey(input.marketId),
            [input.v2MarketsAppId, v2MarketFundingBorrowingBoxKey(input.marketId)],
        ],
        foreignApps: uniqueNumbers([
            input.v2MarketsAppId,
            v2AdminControlAppId(input),
        ]),
        foreignAssets: [],
        flatFeeMicroAlgo: V2_CVA_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest,
    });
    const carrierForeignApps = [input.v2MarketsAppId];
    const directFundingBorrowingBox = v2MarketFundingBorrowingBoxKey(input.marketId);
    const carrierBoxes = v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxesWithYieldFreshness(input, input.marketId, cvaAddress)
        .filter((box) => !boxRefMatchesKey(box, directFundingBorrowingBox)));
    const carrierBoxCapacity = 8 - uniqueNumbers(carrierForeignApps).length;
    call.resourceCarriers = chunks(carrierBoxes, carrierBoxCapacity).map((boxChunk) => buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender: input.sender,
        args: [],
        boxes: boxChunk,
        foreignApps: carrierForeignApps,
        flatFeeMicroAlgo: 1_000,
        manifest,
    }));
    if (input.skipLargeProgramReadBudget) {
        return call;
    }
    const requiredBudgetRefs = V2_LARGE_PROGRAM_READ_BUDGET_REFS.markets
        + V2_LARGE_PROGRAM_READ_BUDGET_REFS.cva_vault;
    const usedRefs = call.foreignApps.length
        + call.foreignAssets.length
        + call.accounts.length
        + call.boxes.length;
    const localBudgetRefs = Math.min(requiredBudgetRefs, Math.max(0, 8 - usedRefs));
    for (let index = 0; index < localBudgetRefs; index += 1) {
        call.boxes.push({ appIndex: 0, name: new Uint8Array() });
        call.boxesB64.push("");
    }
    return fundV2LargeProgramBudgetWithMathCarriers(call, ["markets", "cva_vault"], mathAppId, input.sender, manifest);
}
export function buildV2CvaDepositCall(input) {
    const activeMarkCalls = buildV2CvaActiveMarkCalls(input);
    const call = buildAppCall({
        appId: v2CvaVaultAppId(input),
        appName: "PDexV2CvaVault",
        methodName: "deposit",
        sender: input.sender,
        args: [input.minCvaShares ?? 0, input.oracleMessage, input.oracleSignature],
        boxes: uniqueBoxRefs([
            v2CvaUserBoxKey(input.sender),
            ...v2CvaActiveAllocationBoxes(input, 0, v2CvaOptionalMarketId(input)),
        ]),
        foreignApps: [v2AdminControlAppId(input)],
        foreignAssets: v2PoolAssets(input),
        flatFeeMicroAlgo: V2_CVA_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    return fundV2LargeProgramBudgetAcrossCalls(call, activeMarkCalls, activeMarkCalls.length ? ["markets", "cva_vault"] : ["cva_vault"], input.v2MathAppId, input.sender, input.manifest);
}
export function buildV2CvaWithdrawCall(input) {
    const activeMarkCalls = buildV2CvaActiveMarkCalls(input);
    const call = buildAppCall({
        appId: v2CvaVaultAppId(input),
        appName: "PDexV2CvaVault",
        methodName: "withdraw",
        sender: input.sender,
        args: [
            input.shareAmount,
            input.minLongAmount ?? 0,
            input.minShortAmount ?? 0,
            input.oracleMessage,
            input.oracleSignature,
        ],
        boxes: uniqueBoxRefs([
            v2CvaUserBoxKey(input.sender),
            ...v2CvaActiveAllocationBoxes(input, 0, v2CvaOptionalMarketId(input)),
        ]),
        foreignApps: [v2AdminControlAppId(input)],
        foreignAssets: v2PoolAssets(input),
        flatFeeMicroAlgo: V2_CVA_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    return fundV2LargeProgramBudgetAcrossCalls(call, activeMarkCalls, activeMarkCalls.length ? ["markets", "cva_vault"] : ["cva_vault"], input.v2MathAppId, input.sender, input.manifest);
}
export function buildV2CvaWithdrawFromMarketCall(input) {
    const cvaVaultAppId = v2CvaVaultAppId(input);
    const cvaAddress = addressString(getApplicationAddress(cvaVaultAppId));
    const activeMarkCalls = buildV2CvaActiveMarkCalls(input);
    const resourceCarriers = buildV2CvaMarketWithdrawResourceCarriers(input, cvaAddress);
    const maxLongReceiptAmount = v2ActionRecallCap(input, "maxLongReceiptAmount", "max_long_receipt_amount");
    const maxShortReceiptAmount = v2ActionRecallCap(input, "maxShortReceiptAmount", "max_short_receipt_amount");
    const appCall = buildAppCall({
        appId: cvaVaultAppId,
        appName: "PDexV2CvaVault",
        methodName: "withdraw_from_market",
        sender: input.sender,
        args: [
            input.marketId,
            input.shareAmount,
            input.minLongAmount ?? 0,
            input.minShortAmount ?? 0,
            input.oracleMessage,
            input.oracleSignature,
            v2YieldRecallMode(input),
            maxLongReceiptAmount,
            maxShortReceiptAmount,
        ],
        boxes: [
            v2CvaUserBoxKey(input.sender),
            ...(activeMarkCalls.length ? [] : v2CvaActiveAllocationBoxes(input, cvaVaultAppId, input.marketId)),
            ...v2MarketsOwnedBoxes(input.v2MarketsAppId, resourceCarriers.length
                ? [v2LpBoxKey(cvaAddress, input.marketId)]
                : v2MarketBoxesWithYieldFreshness(input, input.marketId, cvaAddress)),
        ],
        foreignApps: uniqueNumbers([
            v2AdminControlAppId(input),
            input.v2MarketsAppId,
        ]),
        foreignAssets: resourceCarriers.length ? [] : v2PoolAssets(input),
        flatFeeMicroAlgo: V2_CVA_MARKET_WITHDRAW_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
    const merged = mergeV2ActionRecallResources(appCall, input, v2CvaActionRecallAssets(input, maxLongReceiptAmount, maxShortReceiptAmount), v2TradingActionRecallCount(input, maxLongReceiptAmount, maxShortReceiptAmount), resourceCarriers, Number(bigint(maxLongReceiptAmount) > 0n) + Number(bigint(maxShortReceiptAmount) > 0n), true);
    const withFee = withV2ActionXalgoProviderFeeCredit(merged, input, 1, [
        { marketId: input.marketId, assetId: input.longAssetId, receiptCap: maxLongReceiptAmount },
        { marketId: input.marketId, assetId: input.shortAssetId, receiptCap: maxShortReceiptAmount },
    ]);
    const grouped = resourceCarriers.length || (withFee.resourceCarriers?.length ?? 0) || activeMarkCalls.length
        ? {
            ...withFee,
            ...(resourceCarriers.length || (withFee.resourceCarriers?.length ?? 0)
                ? { resourceCarriers: [...resourceCarriers, ...(withFee.resourceCarriers ?? [])] }
                : {}),
            ...(activeMarkCalls.length ? { activeMarkCalls } : {}),
        }
        : withFee;
    return activeMarkCalls.length
        ? fundV2LargeProgramBudgetAcrossCalls(grouped, activeMarkCalls, ["markets", "cva_vault"], input.v2MathAppId, input.sender, input.manifest)
        : grouped;
}
export function v2MarketYieldStrategyBoxRefs(marketId, assetId, localAppIndex = 0) {
    return [
        [localAppIndex, v2MarketYieldStrategyConfigBoxKey(marketId, assetId)],
        [localAppIndex, v2MarketYieldStrategyRuntimeBoxKey(marketId, assetId)],
    ];
}
export function v2MarketXalgoStrategyBoxRefs(marketId, localAppIndex = 0) {
    return [
        [localAppIndex, v2MarketXalgoStrategyConfigBoxKey(marketId)],
        [localAppIndex, v2MarketXalgoStrategyRuntimeBoxKey(marketId)],
    ];
}
function withV2ActionXalgoProviderFeeCredit(call, input, maxCallCount, assetCaps) {
    const xalgoCaps = assetCaps.filter(({ assetId, receiptCap }) => Number(assetId) === NATIVE_ALGO_ASSET_ID && bigint(receiptCap) > 0n);
    if (Number(v2YieldRecallMode(input)) !== 1 || xalgoCaps.length === 0)
        return call;
    const rawRegistry = (input.marketYieldRegistry ?? input.market_yield_registry);
    if (!rawRegistry)
        throw new Error("marketYieldRegistry is required for xALGO action recall");
    const registry = (rawRegistry.snapshot ?? rawRegistry);
    const strategies = arrayValues(registry.strategies);
    const matchedStrategies = xalgoCaps.map(({ marketId }) => {
        const strategy = strategies.find((candidate) => (Number(strategyField(candidate, "market_id", "marketId") ?? 0) === Number(marketId)
            && Number(strategyField(candidate, "asset_id", "assetId") ?? -1) === NATIVE_ALGO_ASSET_ID
            && Number(strategyField(candidate, "strategy_kind", "strategyKind") ?? 0) === V2_MARKET_YIELD_STRATEGY_KIND_XALGO_CONSENSUS));
        if (!strategy)
            throw new Error("xALGO strategy is required for action recall");
        return strategy;
    });
    const credits = new Set(matchedStrategies.map((strategy) => positiveXalgoProviderFeeCredit(strategyField(strategy, "xalgo_provider_fee_credit_per_call_microalgos", "xalgoProviderFeeCreditPerCallMicroalgos") ?? strategyField(strategy, "max_xalgo_call_fee_microalgos", "maxXalgoCallFeeMicroalgos")).toString()));
    if (credits.size !== 1)
        throw new Error("xALGO provider fee credit is inconsistent across strategies");
    const providerCredit = BigInt([...credits][0]) * BigInt(maxCallCount);
    return {
        ...call,
        flatFeeMicroAlgo: BigInt(call.flatFeeMicroAlgo ?? 0n) + providerCredit,
    };
}
function positiveXalgoProviderFeeCredit(value) {
    const credit = bigint(value);
    if (credit <= 0n || credit >= (1n << 64n)) {
        throw new Error("xalgo_provider_fee_credit_per_call_microalgos must be a positive uint64");
    }
    return credit;
}
function buildV2MarketXalgoYieldVaultMarkMarketStrategyGroup(input) {
    return buildV2MarketXalgoYieldVaultXalgoGroup(input, "xalgo_mark_market_strategy", [input.marketId], 0n);
}
function buildV2MarketYieldVaultFolksMarkMarketStrategyCall(input) {
    return buildV2MarketYieldVaultFolksMarkLikeCall(input, "folks_mark_market_strategy");
}
export function buildV2MarketYieldPublicMarkCalls(input) {
    const rawInput = input;
    const registry = (input.marketYieldRegistry ?? rawInput.market_yield_registry);
    if (!registry)
        return [];
    const runtimeStrategies = Array.isArray(input.marketYieldStrategies)
        ? input.marketYieldStrategies
        : Array.isArray(registry.strategies)
            ? registry.strategies
            : [];
    const currentRound = Number(input.currentRound ?? registry.last_indexed_round ?? 0);
    const nearStaleRounds = Number(input.nearStaleRounds ?? 0);
    const marketIds = new Set(uniqueNonNegativeNumbers(input.marketIds ?? (input.marketId === undefined ? [] : [input.marketId])).map(String));
    const assetIds = new Set(uniqueNonNegativeNumbers(input.assetIds ?? []).map(String));
    const calls = [];
    for (const strategy of runtimeStrategies) {
        const marketId = Number(strategyField(strategy, "market_id", "marketId"));
        const assetId = Number(strategyField(strategy, "asset_id", "assetId"));
        if (!Number.isFinite(marketId) || marketId <= 0 || !Number.isFinite(assetId) || assetId < 0)
            continue;
        if (marketIds.size && !marketIds.has(String(marketId)))
            continue;
        if (assetIds.size && !assetIds.has(String(assetId)))
            continue;
        if (!marketYieldStrategyNeedsPublicMark(strategy, currentRound, nearStaleRounds))
            continue;
        const kind = Number(strategyField(strategy, "strategy_kind", "strategyKind"));
        if (kind === V2_MARKET_YIELD_STRATEGY_KIND_FOLKS_LENDING) {
            calls.push(buildV2MarketYieldVaultFolksMarkMarketStrategyCall({
                ...input,
                v2MarketYieldVaultAppId: Number(strategyField(strategy, "market_yield_vault_app_id", "marketYieldVaultAppId")
                    ?? registry.market_folks_yield_vault_app_id
                    ?? input.marketFolksYieldVaultAppId
                    ?? input.v2MarketYieldVaultAppId
                    ?? input.marketYieldVaultAppId),
                marketsAppId: input.v2MarketsAppId,
                marketId,
                assetId,
                folksPoolAppId: Number(strategyField(strategy, "folks_pool_app_id", "folksPoolAppId") ?? 0),
                folksPoolManagerAppId: Number(strategyField(strategy, "folks_pool_manager_app_id", "folksPoolManagerAppId") ?? 0),
                receiptAssetId: Number(strategyField(strategy, "receipt_asset_id", "receiptAssetId") ?? 0),
            }));
        }
        else if (kind === V2_MARKET_YIELD_STRATEGY_KIND_XALGO_CONSENSUS) {
            calls.push(buildV2MarketXalgoYieldVaultMarkMarketStrategyGroup({
                ...input,
                v2MarketXalgoYieldVaultAppId: Number(strategyField(strategy, "market_yield_vault_app_id", "marketYieldVaultAppId")
                    ?? input.v2MarketXalgoYieldVaultAppId
                    ?? input.v2MarketYieldVaultAppId
                    ?? input.marketYieldVaultAppId
                    ?? registry.market_xalgo_yield_vault_app_id
                    ?? registry.market_yield_vault_app_id),
                marketsAppId: input.v2MarketsAppId,
                marketId,
                xalgoConsensusAppId: Number(strategyField(strategy, "xalgo_consensus_app_id", "xalgoConsensusAppId")
                    ?? registry.xalgo_consensus_app_id
                    ?? 0),
                xalgoAssetId: Number(strategyField(strategy, "xalgo_asset_id", "xalgoAssetId") ?? registry.xalgo_asset_id ?? 0),
                proposerAddresses: (() => {
                    const strategyProposers = arrayValues(strategyField(strategy, "xalgo_proposer_addresses", "xalgoProposerAddresses") ?? []);
                    return (strategyProposers.length ? strategyProposers : arrayValues(registry.xalgo_proposer_addresses ?? []))
                        .map(String);
                })(),
                marketXalgoVaultAppAddress: String(strategyField(strategy, "market_xalgo_vault_app_address", "marketXalgoVaultAppAddress")
                    ?? registry.market_xalgo_yield_vault_app_address
                    ?? ""),
            }));
        }
    }
    return calls;
}
export function buildV2SingleTokenDepositLiquidityCall(input) {
    const resourceCarrier = buildV2LpResourceCarrierCall(input);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId);
    return {
        ...buildAppCall({
            appId: input.v2SingleTokenOpsAppId,
            appName: "PDexV2SingleTokenOps",
            methodName: "deposit_liquidity_single",
            sender: input.sender,
            args: [input.marketId, input.minMarketShares ?? 1, input.oracleMessage, input.oracleSignature],
            boxes: v2MarketsOwnedBoxes(input.v2MarketsAppId, resourceCarrier
                ? [v2LpBoxKey(input.sender, input.marketId)]
                : v2MarketBoxesWithYieldFreshness(input, input.marketId, input.sender)),
            foreignApps: uniqueNumbers([
                input.v2MarketsAppId,
                v2AdminControlAppId(input),
            ]),
            foreignAssets: foreignAsset(input.backingAssetId),
            flatFeeMicroAlgo: HEAVY_METHOD_FLAT_FEE_MICRO_ALGO,
            manifest: input.manifest ?? loadManifest(undefined, 2),
        }),
        ...(resourceCarrier ? { resourceCarrier } : {}),
        ...(yieldFreshnessCarriers.length ? { resourceCarriers: yieldFreshnessCarriers } : {}),
    };
}
export function buildV2SingleTokenWithdrawLiquidityCall(input) {
    const yieldRecallMode = v2YieldRecallMode(input);
    const maxBackingReceiptAmount = v2ActionRecallCap(input, "maxBackingReceiptAmount", "max_backing_receipt_amount");
    const resourceCarrier = buildV2LpResourceCarrierCall(input);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId);
    const appCall = mergeV2SingleTokenActionRecallResources(buildAppCall({
        appId: input.v2SingleTokenOpsAppId,
        appName: "PDexV2SingleTokenOps",
        methodName: "withdraw_liquidity_single",
        sender: input.sender,
        args: [
            input.marketId,
            input.shareAmount,
            input.minBackingAmount,
            input.oracleMessage,
            input.oracleSignature,
            yieldRecallMode,
            maxBackingReceiptAmount,
        ],
        boxes: v2MarketsOwnedBoxes(input.v2MarketsAppId, resourceCarrier
            ? [v2LpBoxKey(input.sender, input.marketId)]
            : v2MarketBoxesWithYieldFreshness(input, input.marketId, input.sender)),
        foreignApps: uniqueNumbers([
            input.v2MarketsAppId,
            v2AdminControlAppId(input),
        ]),
        foreignAssets: foreignAsset(input.backingAssetId),
        flatFeeMicroAlgo: HEAVY_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, maxBackingReceiptAmount, false, [...(resourceCarrier ? [resourceCarrier] : []), ...yieldFreshnessCarriers], true);
    const withFee = withV2ActionXalgoProviderFeeCredit(appCall, input, 1, [{ marketId: input.marketId, assetId: input.backingAssetId, receiptCap: maxBackingReceiptAmount }]);
    return {
        ...withFee,
        ...(resourceCarrier ? { resourceCarrier } : {}),
        ...((withFee.resourceCarriers?.length ?? 0) || yieldFreshnessCarriers.length
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...(withFee.resourceCarriers ?? [])] }
            : {}),
    };
}
function buildV2SingleTokenUpdateFundingCall(input) {
    return buildV2SingleTokenMaintenanceCall(input, "update_funding_single");
}
function buildV2SingleTokenUpdateBorrowingCall(input) {
    return buildV2SingleTokenMaintenanceCall(input, "update_borrowing_single");
}
export function buildV2SingleTokenFundStorageCall(input) {
    return buildAppCall({
        appId: input.v2SingleTokenTradingAppId,
        appName: "PDexV2SingleTokenTrading",
        methodName: "fund_storage",
        sender: input.sender,
        args: [],
        boxes: [v2TraderBoxKey(input.sender)],
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
}
export function buildV2SingleTokenOpenOrIncreaseCall(input) {
    validateRawPrice12(input.acceptablePrice);
    const resourceCarrier = buildV2TradingResourceCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const riskOpsAppId = requiredV2TradingRiskOpsAppId(input);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input, { singleToken: true });
    const call = mergeV2AutomaticSettlementRecallResources(buildAppCall({
        appId: input.v2SingleTokenTradingAppId,
        appName: "PDexV2SingleTokenTrading",
        methodName: "open_or_increase",
        sender: input.sender,
        args: [
            input.marketId,
            input.side,
            input.sizeUsdDelta,
            input.acceptablePrice,
            input.oracleMessage,
            input.oracleSignature,
        ],
        boxes: [
            ...v2SingleTokenTradingLocalBoxes(input, input.sender),
            [riskOpsAppId, v2DynamicOiMarginBoxKey(input.marketId)],
        ],
        foreignApps: v2SingleTokenTradingForeignApps(input, { includeRiskOps: true, includeMath: false }),
        foreignAssets: foreignAsset(input.backingAssetId),
        accounts: v2TradingResourceAccounts(input),
        flatFeeMicroAlgo: V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, [input.backingAssetId], [resourceCarrier, ...yieldFreshnessCarriers]);
    const recallCarriers = call.resourceCarriers ?? [];
    return {
        ...call,
        resourceCarrier,
        ...(yieldFreshnessCarriers.length || recallCarriers.length
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...recallCarriers] }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
export function buildV2SingleTokenAddPositionMarginCall(input) {
    validateRawPrice12(input.acceptablePrice);
    const factorsInput = { ...input, collateralAssetId: input.backingAssetId };
    const resourceCarrier = buildV2PositionFactorsCarrierCall(factorsInput, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input, { singleToken: true });
    return {
        ...buildAppCall({
            appId: input.v2SingleTokenTradingAppId,
            appName: "PDexV2SingleTokenTrading",
            methodName: "open_or_increase",
            sender: input.sender,
            args: [
                input.marketId,
                input.side,
                0,
                input.acceptablePrice,
                input.oracleMessage,
                input.oracleSignature,
            ],
            boxes: v2SingleTokenTradingLocalBoxes(input, input.sender),
            foreignApps: v2SingleTokenTradingForeignApps(input, { includeRiskOps: true, includeMath: false }),
            foreignAssets: foreignAsset(input.backingAssetId),
            accounts: v2TradingResourceAccounts(input),
            flatFeeMicroAlgo: V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO,
            manifest: input.manifest ?? loadManifest(undefined, 2),
        }),
        resourceCarrier,
        ...(yieldFreshnessCarriers.length ? { resourceCarriers: yieldFreshnessCarriers } : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
export function buildV2SingleTokenDecreaseOrCloseCall(input) {
    validateRawPrice12(input.acceptablePrice);
    const resourceCarrier = buildV2TradingResourceCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input, { singleToken: true });
    const yieldRecallMode = v2YieldRecallMode(input);
    const maxBackingReceiptAmount = v2ActionRecallCap(input, "maxBackingReceiptAmount", "max_backing_receipt_amount");
    const appCall = mergeV2SingleTokenActionRecallResources(buildAppCall({
        appId: input.v2SingleTokenTradingAppId,
        appName: "PDexV2SingleTokenTrading",
        methodName: "decrease_or_close",
        sender: input.sender,
        args: [
            input.marketId,
            input.backingAssetId,
            input.side,
            input.sizeUsdDelta,
            input.acceptablePrice,
            input.minPrimaryOutput,
            input.oracleMessage,
            input.oracleSignature,
            yieldRecallMode,
            maxBackingReceiptAmount,
            expectedClosePositionId(input.expectedPositionId),
        ],
        boxes: v2SingleTokenTradingLocalBoxes(input, input.sender),
        foreignApps: v2SingleTokenTradingForeignApps(input, { includeRiskOps: true }),
        foreignAssets: foreignAsset(input.backingAssetId),
        accounts: v2TradingResourceAccounts(input),
        flatFeeMicroAlgo: closeFlatFeeMicroAlgo(input.flatFeeMicroAlgo, V2_SINGLE_TOKEN_DECREASE_METHOD_FLAT_FEE_MICRO_ALGO),
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, maxBackingReceiptAmount, true, [resourceCarrier, ...yieldFreshnessCarriers]);
    const withFee = withV2ActionXalgoProviderFeeCredit(appCall, input, 2, [{ marketId: input.marketId, assetId: input.backingAssetId, receiptCap: maxBackingReceiptAmount }]);
    return {
        ...withFee,
        resourceCarrier,
        ...((withFee.resourceCarriers?.length ?? 0) || yieldFreshnessCarriers.length
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...(withFee.resourceCarriers ?? [])] }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
export function buildV2SingleTokenWithdrawPositionMarginCall(input) {
    validateRawPrice12(input.acceptablePrice);
    const factorsInput = { ...input, collateralAssetId: input.backingAssetId };
    const resourceCarrier = buildV2PositionFactorsCarrierCall(factorsInput, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input, { singleToken: true });
    const yieldRecallMode = v2YieldRecallMode(input);
    const maxBackingReceiptAmount = v2ActionRecallCap(input, "maxBackingReceiptAmount", "max_backing_receipt_amount");
    const riskOpsAppId = requiredV2TradingRiskOpsAppId(input);
    const appCall = mergeV2SingleTokenActionRecallResources(buildAppCall({
        appId: input.v2SingleTokenTradingAppId,
        appName: "PDexV2SingleTokenTrading",
        methodName: "decrease_or_close",
        sender: input.sender,
        args: [
            input.marketId,
            input.backingAssetId,
            input.side,
            0,
            input.acceptablePrice,
            input.collateralAmount,
            input.oracleMessage,
            input.oracleSignature,
            yieldRecallMode,
            maxBackingReceiptAmount,
            expectedClosePositionId(input.expectedPositionId),
        ],
        boxes: [
            ...v2SingleTokenTradingLocalBoxes(input, input.sender),
            [riskOpsAppId, v2DynamicOiMarginBoxKey(input.marketId)],
        ],
        foreignApps: v2SingleTokenTradingForeignApps(input, { includeRiskOps: true, includeMath: false }),
        foreignAssets: foreignAsset(input.backingAssetId),
        accounts: v2TradingResourceAccounts(input),
        flatFeeMicroAlgo: V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, maxBackingReceiptAmount, true, [resourceCarrier, ...yieldFreshnessCarriers]);
    const withFee = withV2ActionXalgoProviderFeeCredit(appCall, input, 2, [{ marketId: input.marketId, assetId: input.backingAssetId, receiptCap: maxBackingReceiptAmount }]);
    return {
        ...withFee,
        resourceCarrier,
        ...((withFee.resourceCarriers?.length ?? 0) || yieldFreshnessCarriers.length
            ? { resourceCarriers: [...yieldFreshnessCarriers, ...(withFee.resourceCarriers ?? [])] }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
export function buildV2SingleTokenLiquidateCall(input) {
    return buildV2SingleTokenLiquidationCall(input);
}
export function buildAppCall(input) {
    const manifest = input.manifest ?? loadManifest();
    const method = appMethod(input.appName, input.methodName, manifest);
    const appArgs = encodeAppArgs(input.appName, input.methodName, input.args, manifest);
    const boxes = (input.boxes ?? []).map(boxRef);
    const abiTransactionArgs = method.args
        .filter((arg) => TXN_ARG_TYPES.has(String(arg.type)))
        .map((arg) => String(arg.name));
    const abiTransactionArgTypes = method.args
        .filter((arg) => TXN_ARG_TYPES.has(String(arg.type)))
        .map((arg) => String(arg.type));
    const largeProgramRoles = v2LargeProgramRoles(input.appName, input.methodName);
    return {
        type: "appl",
        appId: input.appId,
        appName: input.appName,
        method: input.methodName,
        sender: addressString(input.sender),
        appArgs,
        appArgsB64: appArgs.map(bytesToBase64),
        boxes,
        boxesB64: boxes.map((box) => `${Number(box.appIndex)}:${bytesToBase64(box.name)}`),
        foreignApps: input.foreignApps ?? [],
        foreignAssets: input.foreignAssets ?? [],
        accounts: (input.accounts ?? []).map(addressString),
        flatFeeMicroAlgo: input.flatFeeMicroAlgo === undefined ? undefined : bigint(input.flatFeeMicroAlgo),
        ...(abiTransactionArgs.length ? { abiTransactionArgs } : {}),
        ...(abiTransactionArgTypes.length ? { abiTransactionArgTypes } : {}),
        ...(largeProgramRoles.length ? { largeProgramRoles } : {}),
    };
}
export function toApplicationNoOpTxn(call, suggestedParams, options = {}) {
    const flatFeeMicroAlgo = options.flatFeeMicroAlgo ?? call.flatFeeMicroAlgo;
    const boxes = v2LargeProgramBudgetedBoxes(call, options.deferLargeProgramReadBudget ?? false);
    const transaction = makeApplicationNoOpTxnFromObject({
        sender: call.sender,
        appIndex: call.appId,
        appArgs: call.appArgs,
        foreignApps: call.foreignApps,
        foreignAssets: call.foreignAssets,
        accounts: call.accounts,
        boxes,
        suggestedParams: paramsWithFee(suggestedParams, flatFeeMicroAlgo),
    });
    Object.defineProperty(transaction, V2_APPLICATION_CALL_METADATA, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: {
            appName: call.appName,
            method: call.method,
            argumentNames: [...(call.abiTransactionArgs ?? [])],
            argumentTypes: [...(call.abiTransactionArgTypes ?? [])],
            largeProgramRoles: [...(call.largeProgramRoles ?? [])],
        },
    });
    return transaction;
}
export function buildV2FundStorageTransactions(input, suggestedParams) {
    const appCall = buildV2FundStorageCall(input);
    return grouped([
        makePaymentTxnWithSuggestedParamsFromObject({
            sender: addressString(input.sender),
            receiver: getApplicationAddress(input.v2TradingAppId),
            amount: bigint(input.paymentMicroAlgo),
            suggestedParams,
        }),
        toApplicationNoOpTxn(appCall, suggestedParams),
    ]);
}
export function buildV2DepositLiquidityCall(input) {
    const resourceCarrier = buildV2LpResourceCarrierCall(input);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId);
    return {
        ...buildAppCall({
            appId: v2AdminOpsAppId(input),
            appName: "PDexV2AdminOps",
            methodName: "deposit_liquidity",
            sender: input.sender,
            args: [input.marketId, input.minMarketShares, input.oracleMessage, input.oracleSignature],
            boxes: v2MarketsOwnedBoxes(input.v2MarketsAppId, resourceCarrier
                ? [v2LpBoxKey(input.sender, input.marketId)]
                : v2MarketBoxesWithYieldFreshness(input, input.marketId, input.sender)),
            foreignApps: v2AdminOpsForeignApps(input),
            foreignAssets: [],
            flatFeeMicroAlgo: HEAVY_METHOD_FLAT_FEE_MICRO_ALGO,
            manifest: input.manifest ?? loadManifest(undefined, 2),
        }),
        ...(resourceCarrier ? { resourceCarrier } : {}),
        ...(yieldFreshnessCarriers.length ? { resourceCarriers: yieldFreshnessCarriers } : {}),
    };
}
export function buildV2DepositLiquidityTransactions(input, suggestedParams) {
    const appCall = buildV2DepositLiquidityCall(input);
    return grouped([
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2MarketsAppId), input.longAssetId, input.longAmount, suggestedParams, undefined, true),
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2MarketsAppId), input.shortAssetId, input.shortAmount, suggestedParams, undefined, true),
        makePaymentTxnWithSuggestedParamsFromObject({
            sender: addressString(input.sender),
            receiver: getApplicationAddress(input.v2MarketsAppId),
            amount: bigint(input.storagePaymentMicroAlgo),
            suggestedParams,
        }),
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarrier ? [toApplicationNoOpTxn(appCall.resourceCarrier, suggestedParams)] : []),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], 3, appCall.appName);
}
export function buildV2SwapExactInTransactions(input, suggestedParams) {
    const appCall = buildV2SwapExactInCall(input);
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, MAX_SWAP_BUILDER_FEE_BPS);
    const assessedBuilderFee = builderFeeAmount(input.amountIn, builderFeeBps);
    const builderTransfer = assessedBuilderFee > 0n
        ? [makeTokenTransferTxn(input.sender, builderAddress, input.tokenInAssetId, assessedBuilderFee, suggestedParams)]
        : [];
    return grouped([
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2MarketsAppId), input.tokenInAssetId, input.amountIn, suggestedParams),
        ...builderTransfer,
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], assessedBuilderFee > 0n ? 2 : 1, appCall.appName);
}
export function buildV2SwapRouteExactInTransactions(input, suggestedParams) {
    const appCall = buildV2SwapRouteExactInCall(input);
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, MAX_SWAP_BUILDER_FEE_BPS);
    const assessedBuilderFee = builderFeeAmount(input.amountIn, builderFeeBps);
    const builderTransfer = assessedBuilderFee > 0n
        ? [makeTokenTransferTxn(input.sender, builderAddress, input.tokenInAssetId, assessedBuilderFee, suggestedParams)]
        : [];
    return grouped([
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2MarketsAppId), input.tokenInAssetId, input.amountIn, suggestedParams),
        ...builderTransfer,
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], assessedBuilderFee > 0n ? 2 : 1, appCall.appName);
}
export function buildV2WithdrawLiquidityTransactions(input, suggestedParams) {
    const appCall = buildV2WithdrawLiquidityCall(input);
    return grouped([
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarrier ? [toApplicationNoOpTxn(appCall.resourceCarrier, suggestedParams)] : []),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], 0, appCall.appName);
}
export function buildV2WithdrawLiquidityWithSwapTransactions(input, suggestedParams) {
    const appCall = buildV2WithdrawLiquidityWithSwapCall(input);
    return grouped([
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarrier ? [toApplicationNoOpTxn(appCall.resourceCarrier, suggestedParams)] : []),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], 0, appCall.appName);
}
export function buildV2OpenOrIncreaseTransactions(input, suggestedParams) {
    const group = buildV2OpenOrIncreaseTransactionParts(input, suggestedParams);
    return grouped(group.transactions, group.primaryIndex, group.primaryAppName);
}
export function buildV2AddPositionMarginTransactions(input, suggestedParams) {
    const appCall = buildV2AddPositionMarginCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    return grouped([
        ...maintenance,
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2TradingAppId), input.collateralAssetId, input.collateralAmount, suggestedParams),
        toApplicationNoOpTxn(appCall, suggestedParams),
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], maintenance.length + 1, appCall.appName);
}
export function buildV2OpenOrIncreaseWithStorageTransactions(input, suggestedParams) {
    const group = buildV2OpenOrIncreaseTransactionParts(input, suggestedParams);
    return grouped(group.transactions, group.primaryIndex, group.primaryAppName);
}
export function buildV2DecreaseOrCloseTransactions(input, suggestedParams) {
    const appCall = buildV2DecreaseOrCloseCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    return grouped([
        ...maintenance,
        toApplicationNoOpTxn(appCall, suggestedParams),
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], maintenance.length, appCall.appName);
}
export function buildV2WithdrawPositionMarginTransactions(input, suggestedParams) {
    const appCall = buildV2WithdrawPositionMarginCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    return grouped([
        ...maintenance,
        toApplicationNoOpTxn(appCall, suggestedParams),
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], maintenance.length, appCall.appName);
}
export function buildV2DecreaseOrCloseWithSwapTransactions(input, suggestedParams) {
    const appCall = buildV2DecreaseOrCloseWithSwapCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    return grouped([
        ...maintenance,
        toApplicationNoOpTxn(appCall, suggestedParams),
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], maintenance.length, appCall.appName);
}
export function buildV2LiquidateTransactions(input, suggestedParams) {
    const appCall = buildV2LiquidateCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    return grouped([
        ...maintenance,
        toApplicationNoOpTxn(appCall, suggestedParams),
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], maintenance.length, appCall.appName);
}
export function buildV2SubmitOrderTransactions(input, suggestedParams) {
    const orderKind = Number(input.orderKind);
    let escrowAmount;
    let requiredStoragePayment;
    if (orderKind === V2_ORDER_KIND.OPEN_LIMIT) {
        escrowAmount = bigint(input.collateralAmount) + bigint(input.keeperFeeAmount);
        requiredStoragePayment = BigInt(V2_OPEN_ORDER_EXECUTION_STORAGE_ESCROW_MICRO_ALGO);
    }
    else if (orderKind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT ||
        orderKind === V2_ORDER_KIND.DECREASE_STOP_LOSS) {
        escrowAmount = bigint(input.keeperFeeAmount);
        requiredStoragePayment = BigInt(V2_ORDER_BOX_MBR_MICRO_ALGO);
    }
    else {
        throw new Error("bad V2 order kind");
    }
    const orderOpsAddress = v2OrderOpsAppAddress(input);
    const appCall = buildV2SubmitOrderCall(input);
    return grouped([
        makeTokenTransferTxn(input.sender, orderOpsAddress, input.collateralAssetId, escrowAmount, suggestedParams),
        makePaymentTxnWithSuggestedParamsFromObject({
            sender: addressString(input.sender),
            receiver: orderOpsAddress,
            amount: bigint(input.storagePaymentMicroAlgo ?? requiredStoragePayment),
            suggestedParams,
        }),
        toApplicationNoOpTxn(appCall, suggestedParams),
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], 2, appCall.appName);
}
export function buildV2SubmitLinkedOrderTransactions(input, suggestedParams) {
    return grouped(buildV2SubmitLinkedOrderTransactionParts(input, suggestedParams));
}
export function buildV2MarketOpenWithAttachedOrdersTransactions(input, suggestedParams) {
    const baseOrderId = bigint(input.baseOrderId);
    validateLinkBaseOrderId(baseOrderId);
    const targetKind = Number(input.targetKind ?? V2_ORDER_TARGET.PAIR);
    const openGroup = targetKind === V2_ORDER_TARGET.SINGLE_TOKEN
        ? buildV2SingleTokenOpenOrIncreaseTransactionParts({
            ...input,
            backingAssetId: input.backingAssetId ?? input.collateralAssetId,
            v2SingleTokenTradingAppId: Number(input.v2SingleTokenTradingAppId ?? 0),
        }, suggestedParams)
        : buildV2OpenOrIncreaseTransactionParts(input, suggestedParams);
    const transactions = openGroup.transactions;
    let sharedCarrierOrderIds = v2AttachedOrderIds(input, baseOrderId);
    if (appendAttachedOrderLegTransactions(transactions, input, input.takeProfit, {
        baseOrderId,
        orderKind: V2_ORDER_KIND.DECREASE_TAKE_PROFIT,
        linkMode: V2_ORDER_LINK_MODE.CHILD_ACTIVE,
        targetKind,
        suggestedParams,
        sharedCarrierOrderIds,
        entryTransactionIndex: openGroup.primaryIndex,
    })) {
        sharedCarrierOrderIds = [];
    }
    appendAttachedOrderLegTransactions(transactions, input, input.stopLoss, {
        baseOrderId,
        orderKind: V2_ORDER_KIND.DECREASE_STOP_LOSS,
        linkMode: V2_ORDER_LINK_MODE.CHILD_ACTIVE,
        targetKind,
        suggestedParams,
        sharedCarrierOrderIds,
        entryTransactionIndex: openGroup.primaryIndex,
    });
    validateGroupTransactionCount(transactions);
    return grouped(transactions, openGroup.primaryIndex, openGroup.primaryAppName);
}
export function buildV2ActiveAttachedOrdersTransactions(input, suggestedParams) {
    const baseOrderId = bigint(input.baseOrderId);
    validateLinkBaseOrderId(baseOrderId);
    const targetKind = Number(input.targetKind ?? V2_ORDER_TARGET.PAIR);
    const attachedOrderIds = v2AttachedOrderIds(input, baseOrderId);
    if (!attachedOrderIds.length)
        throw new Error("attached order is required");
    const transactions = [];
    let sharedCarrierOrderIds = attachedOrderIds;
    if (appendAttachedOrderLegTransactions(transactions, input, input.takeProfit, {
        baseOrderId,
        orderKind: V2_ORDER_KIND.DECREASE_TAKE_PROFIT,
        linkMode: V2_ORDER_LINK_MODE.CHILD_ACTIVE,
        targetKind,
        suggestedParams,
        sharedCarrierOrderIds,
    })) {
        sharedCarrierOrderIds = [];
    }
    appendAttachedOrderLegTransactions(transactions, input, input.stopLoss, {
        baseOrderId,
        orderKind: V2_ORDER_KIND.DECREASE_STOP_LOSS,
        linkMode: V2_ORDER_LINK_MODE.CHILD_ACTIVE,
        targetKind,
        suggestedParams,
        sharedCarrierOrderIds,
    });
    validateGroupTransactionCount(transactions);
    return grouped(transactions, 2, "PDexV2OrderOps");
}
export function buildV2OpenLimitWithAttachedOrdersTransactions(input, suggestedParams) {
    const baseOrderId = bigint(input.baseOrderId ?? input.ownerOrderId);
    validateLinkBaseOrderId(baseOrderId);
    const targetKind = Number(input.targetKind);
    const childLinkMode = v2OrderCrossedByOracle(input)
        ? V2_ORDER_LINK_MODE.CHILD_ACTIVE
        : V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT;
    // The bracket parent always reads both child slots and requires them to be
    // empty. A one-sided protect still has to name the sibling that is not created.
    const sharedCarrierOrderIds = [
        baseOrderId,
        v2ExpectedLinkedChildOrderId(baseOrderId, V2_ORDER_KIND.DECREASE_TAKE_PROFIT),
        v2ExpectedLinkedChildOrderId(baseOrderId, V2_ORDER_KIND.DECREASE_STOP_LOSS),
    ];
    const transactions = buildV2SubmitLinkedOrderTransactionParts({
        ...input,
        ownerOrderId: baseOrderId,
        orderKind: V2_ORDER_KIND.OPEN_LIMIT,
        targetKind,
        linkMode: V2_ORDER_LINK_MODE.BRACKET_PARENT,
        linkBaseOrderId: baseOrderId,
    }, suggestedParams, true, sharedCarrierOrderIds);
    appendAttachedOrderLegTransactions(transactions, input, input.takeProfit, {
        baseOrderId,
        orderKind: V2_ORDER_KIND.DECREASE_TAKE_PROFIT,
        linkMode: childLinkMode,
        targetKind,
        suggestedParams,
        sharedCarrierOrderIds: [],
        entryTransactionIndex: childLinkMode === V2_ORDER_LINK_MODE.CHILD_ACTIVE ? 2 : undefined,
    });
    appendAttachedOrderLegTransactions(transactions, input, input.stopLoss, {
        baseOrderId,
        orderKind: V2_ORDER_KIND.DECREASE_STOP_LOSS,
        linkMode: childLinkMode,
        targetKind,
        suggestedParams,
        sharedCarrierOrderIds: [],
        entryTransactionIndex: childLinkMode === V2_ORDER_LINK_MODE.CHILD_ACTIVE ? 2 : undefined,
    });
    validateGroupTransactionCount(transactions);
    return grouped(transactions, 2, "PDexV2OrderOps");
}
export function buildV2ExecuteOrderTransactions(input, suggestedParams) {
    const appCall = buildV2ExecuteOrderCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    return grouped([
        ...maintenance,
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarrier ? [toApplicationNoOpTxn(appCall.resourceCarrier, suggestedParams)] : []),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], maintenance.length, appCall.appName);
}
export function buildV2CancelOrderTransactions(input, suggestedParams) {
    const appCall = buildV2CancelOrderCall(input);
    const budgetCarrier = buildV2LinkedOrderCancelBudgetCarrier(input);
    return grouped([
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(budgetCarrier ? [toApplicationNoOpTxn(budgetCarrier, suggestedParams)] : []),
    ], 0, appCall.appName);
}
export function buildV2CancelExpiredOrderTransactions(input, suggestedParams) {
    const appCall = buildV2CancelExpiredOrderCall(input);
    const budgetCarrier = buildV2LinkedOrderCancelBudgetCarrier(input);
    return grouped([
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(budgetCarrier ? [toApplicationNoOpTxn(budgetCarrier, suggestedParams)] : []),
    ], 0, appCall.appName);
}
export function buildV2UpdateFundingTransactions(input, suggestedParams) {
    const appCall = buildV2UpdateFundingCall(input);
    return grouped([
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarrier ? [toApplicationNoOpTxn(appCall.resourceCarrier, suggestedParams)] : []),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], 0, appCall.appName);
}
export function buildV2CvaDepositTransactions(input, suggestedParams) {
    const cvaAddress = getApplicationAddress(v2CvaVaultAppId(input));
    const appCall = buildV2CvaDepositCall(input);
    const activeMarkCount = appCall.activeMarkCalls?.length ?? 0;
    return grouped([
        ...(appCall.activeMarkCalls ?? []).map((mark) => toApplicationNoOpTxn(mark, suggestedParams, { deferLargeProgramReadBudget: true })),
        makeTokenTransferTxn(input.sender, cvaAddress, input.longAssetId, input.longAmount, suggestedParams, undefined, true),
        makeTokenTransferTxn(input.sender, cvaAddress, input.shortAssetId, input.shortAmount, suggestedParams, undefined, true),
        makePaymentTxnWithSuggestedParamsFromObject({
            sender: addressString(input.sender),
            receiver: cvaAddress,
            amount: bigint(input.storagePaymentMicroAlgo ?? 0),
            note: new TextEncoder().encode("pdex-v2-cva-deposit-storage"),
            suggestedParams,
        }),
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], activeMarkCount + 3, appCall.appName);
}
export function buildV2CvaWithdrawTransactions(input, suggestedParams) {
    const appCall = buildV2CvaWithdrawCall(input);
    const activeMarkCount = appCall.activeMarkCalls?.length ?? 0;
    return grouped([
        ...(appCall.activeMarkCalls ?? []).map((mark) => toApplicationNoOpTxn(mark, suggestedParams, { deferLargeProgramReadBudget: true })),
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], activeMarkCount, appCall.appName);
}
export function buildV2CvaWithdrawFromMarketTransactions(input, suggestedParams) {
    const appCall = buildV2CvaWithdrawFromMarketCall(input);
    const activeMarks = (appCall.activeMarkCalls ?? []).map((mark) => toApplicationNoOpTxn(mark, suggestedParams, { deferLargeProgramReadBudget: true }));
    return grouped([
        ...activeMarks,
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarrier ? [toApplicationNoOpTxn(appCall.resourceCarrier, suggestedParams)] : []),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], activeMarks.length, appCall.appName);
}
export function buildV2SingleTokenDepositLiquidityTransactions(input, suggestedParams) {
    const appCall = buildV2SingleTokenDepositLiquidityCall(input);
    return grouped([
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2MarketsAppId), input.backingAssetId, input.backingAmount, suggestedParams),
        makePaymentTxnWithSuggestedParamsFromObject({
            sender: addressString(input.sender),
            receiver: getApplicationAddress(input.v2MarketsAppId),
            amount: bigint(input.storagePaymentMicroAlgo),
            suggestedParams,
        }),
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarrier ? [toApplicationNoOpTxn(appCall.resourceCarrier, suggestedParams)] : []),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], 2, appCall.appName);
}
export function buildV2SingleTokenWithdrawLiquidityTransactions(input, suggestedParams) {
    const appCall = buildV2SingleTokenWithdrawLiquidityCall(input);
    return grouped([
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...(appCall.resourceCarrier ? [toApplicationNoOpTxn(appCall.resourceCarrier, suggestedParams)] : []),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ], 0, appCall.appName);
}
export function buildV2SingleTokenFundStorageTransactions(input, suggestedParams) {
    return grouped([
        makePaymentTxnWithSuggestedParamsFromObject({
            sender: addressString(input.sender),
            receiver: getApplicationAddress(input.v2SingleTokenTradingAppId),
            amount: bigint(input.paymentMicroAlgo),
            suggestedParams,
        }),
        toApplicationNoOpTxn(buildV2SingleTokenFundStorageCall(input), suggestedParams),
    ]);
}
export function buildV2SingleTokenOpenOrIncreaseTransactions(input, suggestedParams) {
    const group = buildV2SingleTokenOpenOrIncreaseTransactionParts(input, suggestedParams);
    return grouped(group.transactions, group.primaryIndex, group.primaryAppName);
}
export function buildV2SingleTokenAddPositionMarginTransactions(input, suggestedParams) {
    const appCall = buildV2SingleTokenAddPositionMarginCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    const actionCarriers = transactionsNotAlreadyPresent(maintenance, [
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ]);
    return grouped([
        ...maintenance,
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2SingleTokenTradingAppId), input.backingAssetId, input.collateralAmount, suggestedParams),
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...actionCarriers,
    ], maintenance.length + 1, appCall.appName);
}
export function buildV2SingleTokenOpenOrIncreaseWithStorageTransactions(input, suggestedParams) {
    const group = buildV2SingleTokenOpenOrIncreaseTransactionParts(input, suggestedParams);
    return grouped(group.transactions, group.primaryIndex, group.primaryAppName);
}
export function buildV2SingleTokenDecreaseOrCloseTransactions(input, suggestedParams) {
    const appCall = buildV2SingleTokenDecreaseOrCloseCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    const actionCarriers = transactionsNotAlreadyPresent(maintenance, [
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ]);
    return grouped([
        ...maintenance,
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...actionCarriers,
    ], maintenance.length, appCall.appName);
}
export function buildV2SingleTokenWithdrawPositionMarginTransactions(input, suggestedParams) {
    const appCall = buildV2SingleTokenWithdrawPositionMarginCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    const actionCarriers = transactionsNotAlreadyPresent(maintenance, [
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ]);
    return grouped([
        ...maintenance,
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...actionCarriers,
    ], maintenance.length, appCall.appName);
}
export function buildV2SingleTokenLiquidateTransactions(input, suggestedParams) {
    const appCall = buildV2SingleTokenLiquidateCall(input);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    const actionCarriers = transactionsNotAlreadyPresent(maintenance, [
        toApplicationNoOpTxn(requireResourceCarrier(appCall), suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
    ]);
    return grouped([
        ...maintenance,
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...actionCarriers,
    ], maintenance.length, appCall.appName);
}
export function buildSingleAppCallTransaction(call, suggestedParams, options = {}) {
    const transactions = [toApplicationNoOpTxn(call, suggestedParams, options)];
    validateAbiTransactionArguments(transactions);
    return attachV2TransactionGroupMetadata(transactions, 0, call.appName);
}
const TXN_ARG_TYPES = new Set(["pay", "txn", "axfer", "acfg", "afrz", "keyreg", "appl"]);
function buildV2LiquidationCall(input) {
    const resourceCarrier = buildV2TradingResourceCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input);
    const yieldRecallMode = v2YieldRecallMode(input);
    const maxLongReceiptAmount = v2ActionRecallCap(input, "maxLongReceiptAmount", "max_long_receipt_amount");
    const maxShortReceiptAmount = v2ActionRecallCap(input, "maxShortReceiptAmount", "max_short_receipt_amount");
    const appCall = mergeV2ActionRecallResources(buildAppCall({
        appId: input.v2TradingAppId,
        appName: "PDexV2Trading",
        methodName: "liquidate",
        sender: input.sender,
        args: [
            input.target,
            input.marketId,
            input.collateralAssetId,
            input.side,
            input.oracleMessage,
            input.oracleSignature,
            yieldRecallMode,
            maxLongReceiptAmount,
            maxShortReceiptAmount,
        ],
        boxes: v2TradingLocalBoxes(input, input.target),
        foreignApps: v2TradingForeignApps(input, { includeRiskOps: true, includeMath: false }),
        foreignAssets: v2MarketAssets(input, input.collateralAssetId),
        accounts: v2TradingResourceAccounts(input),
        flatFeeMicroAlgo: V2_LIQUIDATION_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, v2TradingActionRecallAssets(input, maxLongReceiptAmount, maxShortReceiptAmount), v2TradingActionRecallCount(input, maxLongReceiptAmount, maxShortReceiptAmount), [resourceCarrier, ...yieldFreshnessCarriers]);
    const withFee = withV2ActionXalgoProviderFeeCredit(appCall, input, 2, [
        { marketId: input.marketId, assetId: input.longAssetId, receiptCap: maxLongReceiptAmount },
        { marketId: input.marketId, assetId: input.shortAssetId, receiptCap: maxShortReceiptAmount },
    ]);
    return {
        ...withFee,
        resourceCarrier,
        ...(yieldFreshnessCarriers.length || (withFee.resourceCarriers?.length ?? 0)
            ? {
                resourceCarriers: [
                    ...yieldFreshnessCarriers,
                    ...(withFee.resourceCarriers ?? []),
                ],
            }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
function buildV2SingleTokenMaintenanceCall(input, methodName) {
    const resourceCarrier = methodName === "update_funding_single"
        ? buildV2LpResourceCarrierCall({ ...input, carrierIndexAssetId: v2IndexAssetId(input) })
        : undefined;
    const record = input;
    const yieldFreshnessCarriers = methodName !== "update_funding_single"
        || record.skipMarketYieldFreshnessCarrier
        || record.skip_market_yield_freshness_carrier
        ? []
        : buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId);
    const call = {
        ...buildAppCall({
            appId: input.v2SingleTokenOpsAppId,
            appName: "PDexV2SingleTokenOps",
            methodName,
            sender: input.sender,
            args: [input.marketId, input.oracleMessage, input.oracleSignature],
            boxes: resourceCarrier
                ? v2MarketsOwnedBoxes(input.v2MarketsAppId, [v2MarketAdaptiveFundingBoxKey(input.marketId)])
                : v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId, undefined, methodName === "update_funding_single" ? v2IndexAssetId(input) : undefined, methodName === "update_funding_single")),
            foreignApps: methodName === "update_funding_single"
                ? uniqueNumbers([
                    input.v2MarketsAppId,
                    v2AdminControlAppId(input),
                    ...v2MathAppRefs(input),
                ])
                : [input.v2MarketsAppId, v2AdminControlAppId(input)],
            foreignAssets: [],
            flatFeeMicroAlgo: V2_FUNDING_BORROWING_METHOD_FLAT_FEE_MICRO_ALGO,
            manifest: input.manifest ?? loadManifest(undefined, 2),
        }),
        ...(resourceCarrier ? { resourceCarrier } : {}),
        ...(yieldFreshnessCarriers.length ? { resourceCarriers: yieldFreshnessCarriers } : {}),
    };
    return methodName === "update_borrowing_single"
        ? fundV2LargeProgramBudgetWithMathCarriers(call, ["markets"], input.v2MathAppId, input.sender, input.manifest)
        : call;
}
function buildV2SingleTokenLiquidationCall(input) {
    const resourceCarrier = buildV2TradingResourceCarrierCall(input, input.sender);
    const yieldFreshnessCarriers = buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId, true);
    const settlementMaintenanceCalls = buildV2SettlementMaintenanceCalls(input, { singleToken: true });
    const yieldRecallMode = v2YieldRecallMode(input);
    const maxBackingReceiptAmount = v2ActionRecallCap(input, "maxBackingReceiptAmount", "max_backing_receipt_amount");
    const appCall = mergeV2SingleTokenActionRecallResources(buildAppCall({
        appId: input.v2SingleTokenTradingAppId,
        appName: "PDexV2SingleTokenTrading",
        methodName: "liquidate",
        sender: input.sender,
        args: [
            input.target,
            input.marketId,
            input.backingAssetId,
            input.side,
            input.oracleMessage,
            input.oracleSignature,
            yieldRecallMode,
            maxBackingReceiptAmount,
        ],
        boxes: v2SingleTokenTradingLocalBoxes(input, input.target),
        foreignApps: v2SingleTokenTradingForeignApps(input, { includeRiskOps: true }),
        foreignAssets: foreignAsset(input.backingAssetId),
        accounts: v2TradingResourceAccounts(input),
        flatFeeMicroAlgo: V2_LIQUIDATION_METHOD_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    }), input, maxBackingReceiptAmount, true, [resourceCarrier, ...yieldFreshnessCarriers]);
    const withFee = withV2ActionXalgoProviderFeeCredit(appCall, input, 2, [{ marketId: input.marketId, assetId: input.backingAssetId, receiptCap: maxBackingReceiptAmount }]);
    return {
        ...withFee,
        resourceCarrier,
        ...((withFee.resourceCarriers?.length ?? 0) || yieldFreshnessCarriers.length
            ? {
                resourceCarriers: [
                    ...yieldFreshnessCarriers,
                    ...(withFee.resourceCarriers ?? []),
                ],
            }
            : {}),
        ...(settlementMaintenanceCalls.length ? { settlementMaintenanceCalls } : {}),
    };
}
function buildV2TradingResourceCarrierCall(input, sender) {
    const carryAdaptiveWithYield = v2MarketYieldFreshnessBoxKeys(input, input.marketId).length > 0;
    return buildV2MathMarketResourceCarrierCall(input, sender, v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId, undefined, v2IndexAssetId(input), !carryAdaptiveWithYield)));
}
function buildV2DynamicOiResourceCarrierCall(input, sender) {
    const riskOpsAppId = requiredV2TradingRiskOpsAppId(input);
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0) {
        throw new Error("v2MathAppId is required for builder-aware open resource planning");
    }
    return buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender,
        args: [],
        boxes: [[riskOpsAppId, v2DynamicOiMarginBoxKey(input.marketId)]],
        foreignApps: [riskOpsAppId],
        flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
}
function relocateCarriedForeignAppForReferenceLimit(call, appIds, carriers) {
    const referenceCount = (call.foreignApps?.length ?? 0)
        + (call.foreignAssets?.length ?? 0)
        + (call.accounts?.length ?? 0)
        + (call.boxes?.length ?? 0);
    if (referenceCount <= 8)
        return call;
    const foreignApps = [...(call.foreignApps ?? [])];
    for (const appId of appIds) {
        const index = foreignApps.indexOf(appId);
        const carried = carriers.some((carrier) => carrier.appId === appId || carrier.foreignApps?.includes(appId));
        if (index >= 0 && carried) {
            foreignApps.splice(index, 1);
            return { ...call, foreignApps };
        }
    }
    throw new Error("over-budget call has no relocatable carried foreign app");
}
function buildV2MathMarketResourceCarrierCall(input, sender, boxes) {
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for market resource carrier");
    return buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender,
        args: [],
        boxes,
        foreignApps: [input.v2MarketsAppId],
        flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
}
function buildV2PositionFactorsCarrierCall(input, sender) {
    const carryAdaptiveWithYield = v2MarketYieldFreshnessBoxKeys(input, input.marketId).length > 0;
    return buildV2MathMarketResourceCarrierCall(input, sender, v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId, undefined, v2IndexAssetId(input), !carryAdaptiveWithYield)));
}
function buildV2LpResourceCarrierCall(input) {
    if (Number(input.v2MathAppId ?? 0) <= 0)
        return undefined;
    return buildV2MathMarketResourceCarrierCall(input, input.sender, v2MarketsOwnedBoxes(input.v2MarketsAppId, v2MarketBoxes(input.marketId, undefined, input.carrierIndexAssetId, Boolean(input.includeAdaptiveFunding))));
}
function buildV2MarketYieldFreshnessResourceCarriers(input, sender, marketId, includeAdaptiveFunding = false) {
    let yieldBoxes = v2MarketYieldFreshnessBoxKeys(input, marketId);
    if (!yieldBoxes.length)
        return [];
    if (includeAdaptiveFunding) {
        yieldBoxes = [v2MarketAdaptiveFundingBoxKey(marketId), ...yieldBoxes];
    }
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for market-yield freshness resource carrier");
    return [
        buildAppCall({
            appId: mathAppId,
            appName: "PDexV2Math",
            methodName: "noop",
            sender,
            args: [],
            boxes: v2MarketsOwnedBoxes(input.v2MarketsAppId, yieldBoxes),
            foreignApps: [input.v2MarketsAppId],
            flatFeeMicroAlgo: 1_000,
            manifest: input.manifest ?? loadManifest(undefined, 2),
        }),
    ];
}
function buildV2CvaMarketWithdrawResourceCarriers(input, cvaAddress) {
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        return [];
    const manifest = input.manifest ?? loadManifest(undefined, 2);
    return [
        buildAppCall({
            appId: mathAppId,
            appName: "PDexV2Math",
            methodName: "noop",
            sender: input.sender,
            args: [],
            boxes: v2MarketsOwnedBoxes(input.v2MarketsAppId, [
                v2MarketCoreBoxKey(input.marketId),
                v2MarketRiskBoxKey(input.marketId),
                v2MarketPoolBoxKey(input.marketId),
                v2MarketOpenInterestBoxKey(input.marketId),
                v2LpBoxKey(cvaAddress, input.marketId),
                v2MarketFundingBorrowingBoxKey(input.marketId),
            ]),
            foreignApps: [input.v2MarketsAppId],
            flatFeeMicroAlgo: 1_000,
            manifest,
        }),
        buildAppCall({
            appId: mathAppId,
            appName: "PDexV2Math",
            methodName: "noop",
            sender: input.sender,
            args: [],
            accounts: [
                addressString(input.sender),
                cvaAddress,
                addressString(getApplicationAddress(input.v2MarketsAppId)),
            ],
            foreignAssets: v2PoolAssets(input),
            flatFeeMicroAlgo: 1_000,
            manifest,
        }),
        ...buildV2MarketYieldFreshnessResourceCarriers(input, input.sender, input.marketId),
    ];
}
function requireV2LpResourceCarrier(carrier) {
    if (!carrier)
        throw new Error("v2MathAppId is required for swap route resource carriers");
    return carrier;
}
function routeMarketId(hop) {
    return bigint(hop.marketId ?? hop.market_id ?? 0);
}
function routeOracleMessage(hop, fallback) {
    return hop.oracleMessage ?? fallback ?? new Uint8Array();
}
function routeOracleSignature(hop, fallback) {
    return hop.oracleSignature ?? fallback ?? new Uint8Array();
}
function v2RouteAssets(hops) {
    const values = hops.flatMap((hop) => [
        Number(hop.longAssetId),
        Number(hop.shortAssetId),
        Number(hop.tokenInAssetId ?? hop.token_in_asset_id ?? 0),
    ]);
    return [...new Set(values.filter((value) => value > 0))];
}
function uniqueNumbers(values) {
    return [...new Set(values.map(Number).filter((value) => value > 0))];
}
function v2MarketBoxes(marketId, lpOwner, indexAssetId, includeAdaptiveFunding = false) {
    const boxes = [
        v2MarketCoreBoxKey(marketId),
        v2MarketRiskBoxKey(marketId),
        v2MarketPoolBoxKey(marketId),
        v2MarketOpenInterestBoxKey(marketId),
        v2MarketFundingBorrowingBoxKey(marketId),
    ];
    if (includeAdaptiveFunding)
        boxes.push(v2MarketAdaptiveFundingBoxKey(marketId));
    if (indexAssetId !== undefined && indexAssetId !== null)
        boxes.push(v2VirtualPositionInventoryBoxKey(indexAssetId));
    if (lpOwner)
        boxes.push(v2LpBoxKey(lpOwner, marketId));
    return boxes;
}
function v2MarketBoxesWithYieldFreshness(input, marketId, lpOwner, indexAssetId, includeAdaptiveFunding = false) {
    return [
        ...v2MarketBoxes(marketId, lpOwner, indexAssetId, includeAdaptiveFunding),
        ...v2MarketYieldFreshnessBoxKeys(input, marketId),
    ];
}
function v2MarketYieldFreshnessBoxKeys(input, marketId) {
    return v2MarketYieldFreshnessAssetIds(input, marketId).map((assetId) => v2MarketYieldBoxKey(marketId, assetId));
}
function v2MarketYieldFreshnessAssetIds(input, marketId) {
    const record = input;
    const explicit = (record.marketYieldFreshAssetIds ?? record.market_yield_fresh_asset_ids);
    if (explicit)
        return uniqueNonNegativeNumbers(explicit);
    const marketAssetIds = uniqueNonNegativeNumbers([
        record.backingAssetId ?? record.backing_asset_id,
        record.longAssetId ?? record.long_asset_id,
        record.shortAssetId ?? record.short_asset_id,
    ]);
    if (marketAssetIds.length)
        return marketAssetIds;
    const registry = (record.marketYieldRegistry ?? record.market_yield_registry);
    if (!registry)
        return [];
    const strategies = (registry.strategies ?? []);
    return uniqueNonNegativeNumbers(strategies
        .filter((strategy) => Number(strategy.market_id ?? strategy.marketId) === Number(marketId))
        .map((strategy) => Number(strategy.asset_id ?? strategy.assetId)));
}
function uniqueNonNegativeNumbers(values) {
    return [...new Set(Array.from(values, (value) => Number(value)).filter((value) => value >= 0))];
}
const V2_MARKET_YIELD_STRATEGY_KIND_FOLKS_LENDING = 1;
const V2_MARKET_YIELD_STRATEGY_KIND_XALGO_CONSENSUS = 2;
function strategyField(strategy, ...names) {
    for (const name of names) {
        if (strategy[name] !== undefined)
            return strategy[name];
    }
    return undefined;
}
function arrayValues(value) {
    return Array.isArray(value) ? value : [];
}
function optionalBooleanValue(value) {
    if (typeof value === "boolean")
        return value;
    if (typeof value === "number")
        return value !== 0;
    if (typeof value === "bigint")
        return value !== 0n;
    if (typeof value === "string" && value.length) {
        return !["0", "false", "no", "none", "null"].includes(value.toLowerCase());
    }
    return undefined;
}
function marketYieldStrategyNeedsPublicMark(strategy, currentRound, nearStaleRounds) {
    if (optionalBooleanValue(strategyField(strategy, "public_mark_required", "publicMarkRequired")) === true)
        return true;
    if (optionalBooleanValue(strategyField(strategy, "needs_public_mark", "needsPublicMark")) === true)
        return true;
    const markStale = optionalBooleanValue(strategyField(strategy, "mark_stale", "markStale"));
    if (!marketYieldStrategyDeployed(strategy))
        return false;
    const maxAge = Number(strategyField(strategy, "max_mark_age_rounds", "maxMarkAgeRounds")
        ?? strategyField(strategy, "mark_stale_rounds", "markStaleRounds")
        ?? 0);
    if (!Number.isFinite(currentRound) || currentRound <= 0 || !Number.isFinite(maxAge) || maxAge <= 0) {
        return markStale === true;
    }
    const lastMark = Number(strategyField(strategy, "last_mark_round", "lastMarkRound") ?? 0);
    if (!Number.isFinite(lastMark) || lastMark <= 0)
        return true;
    if (currentRound + Math.max(0, nearStaleRounds) > lastMark + maxAge)
        return true;
    return markStale === true;
}
function marketYieldStrategyDeployed(strategy) {
    return [
        "principal_amount",
        "principalAmount",
        "receipt_amount",
        "receiptAmount",
        "receipt_token_balance",
        "receiptTokenBalance",
        "economic_underlying",
        "economicUnderlying",
    ].some((name) => {
        const value = strategyField(strategy, name);
        return value !== undefined && bigint(value) > 0n;
    });
}
function v2MarketsOwnedBoxes(v2MarketsAppId, boxes) {
    return boxes.map((box) => [v2MarketsAppId, Array.isArray(box) ? box[1] : box]);
}
function boxRefMatchesKey(box, key) {
    const boxKey = Array.isArray(box) ? box[1] : box;
    return boxKey.length === key.length && boxKey.every((byte, index) => byte === key[index]);
}
function v2CvaActiveMarketIds(input, includeMarketId) {
    const values = [];
    const explicit = input.activeMarketIds ?? input.active_market_ids;
    if (explicit)
        values.push(...explicit);
    else {
        values.push(input.activeMarket0 ?? input.active_market_0 ?? 0, input.activeMarket1 ?? input.active_market_1 ?? 0, input.activeMarket2 ?? input.active_market_2 ?? 0, input.activeMarket3 ?? input.active_market_3 ?? 0);
    }
    if (includeMarketId !== undefined)
        values.unshift(includeMarketId);
    return [...new Set(values.map(Number).filter((value) => value > 0))];
}
function v2CvaOptionalMarketId(input) {
    const record = input;
    return record.marketId ?? record.market_id;
}
function v2CvaActiveAllocationBoxes(input, appId = 0, includeMarketId) {
    const allocationIds = input.activeAllocationMarketIds ?? input.active_allocation_market_ids;
    const refsInput = allocationIds ? { activeMarketIds: allocationIds } : input;
    return uniqueBoxRefs(v2CvaActiveMarketIds(refsInput, includeMarketId).map((marketId) => {
        const key = v2CvaMarketAllocationBoxKey(marketId);
        return appId > 0 ? [appId, key] : key;
    }));
}
function buildV2CvaActiveMarkCalls(input) {
    const carriers = [];
    const marks = [];
    for (const marketId of v2CvaActiveMarketIds(input)) {
        const payload = v2CvaActiveOraclePayload(input, Number(marketId));
        if (!payload)
            throw new Error(`missing active CVA mark oracle for market ${Number(marketId)}`);
        const mark = buildV2CvaMarkMarketCall({
            ...input,
            marketId,
            oracleMessage: payloadBytes(payload, "oracleMessage", "message", "message_hex"),
            oracleSignature: payloadBytes(payload, "oracleSignature", "signature", "signature_hex"),
            indexAssetId: payload.indexAssetId ?? payload.index_asset_id ?? input.indexAssetId,
            longAssetId: payload.longAssetId ?? payload.long_asset_id ?? input.longAssetId ?? 0,
            shortAssetId: payload.shortAssetId ?? payload.short_asset_id ?? input.shortAssetId ?? 0,
            skipLargeProgramReadBudget: true,
        });
        const { resourceCarriers = [], ...atomicMark } = mark;
        carriers.push(...resourceCarriers);
        marks.push(atomicMark);
    }
    return [...carriers, ...marks];
}
function v2CvaActiveOraclePayload(input, marketId) {
    const payloads = input.activeMarketOracles
        ?? input.active_market_oracles
        ?? input.activeMarkOracles
        ?? input.active_mark_oracles;
    if (!payloads)
        return undefined;
    if (Array.isArray(payloads)) {
        return payloads.find((payload) => Number(payload.marketId ?? payload.market_id ?? 0) === marketId);
    }
    return payloads[String(marketId)];
}
function payloadBytes(payload, directKey, bytesKey, hexKey) {
    const direct = payload[directKey];
    if (direct !== undefined)
        return bytes(direct);
    const value = payload[bytesKey];
    if (value !== undefined)
        return bytes(value);
    const hex = payload[hexKey];
    if (hex !== undefined)
        return bytes(hex.startsWith("0x") ? hex.slice(2) : hex);
    throw new Error(`missing oracle ${bytesKey}`);
}
function v2TradingLocalBoxes(input, owner) {
    return [
        v2TraderBoxKey(owner),
        v2PositionBoxKey(owner, input.marketId, input.collateralAssetId, input.side),
    ];
}
function v2IndexAssetId(input) {
    const value = input.indexAssetId ?? input.backingAssetId ?? input.longAssetId ?? input.collateralAssetId;
    if (value === undefined || value === null || bigint(value) < 0n) {
        throw new Error("indexAssetId must be non-negative for V2 position-impact resources");
    }
    return value;
}
function v2SingleTokenTradingLocalBoxes(input, owner) {
    return [
        v2TraderBoxKey(owner),
        v2PositionBoxKey(owner, input.marketId, input.backingAssetId, input.side),
    ];
}
function v2TradingResourceAccounts(input) {
    const marketsAddress = addressString(getApplicationAddress(input.v2MarketsAppId));
    const accounts = [marketsAddress];
    if (input.target !== undefined) {
        const targetAddress = addressString(input.target);
        if (!accounts.includes(targetAddress))
            accounts.push(targetAddress);
    }
    const [builderAddress, builderFeeBps] = normalizeBuilderFee(input.builderFee, MAX_POSITION_BUILDER_FEE_BPS);
    if (builderFeeBps > 0n && !accounts.includes(builderAddress)) {
        accounts.push(builderAddress);
    }
    return accounts;
}
function v2MathAppRefs(input) {
    const mathAppId = Number(input.v2MathAppId ?? 0);
    return mathAppId > 0 ? [mathAppId] : [];
}
function v2AdminOpsAppId(input) {
    const appId = Number(input.v2AdminOpsAppId ?? input.v2AdminAppId ?? 0);
    if (appId <= 0)
        throw new Error("v2AdminOpsAppId is required");
    return appId;
}
function v2SwapOpsAppId(input) {
    const appId = Number(input.v2SwapOpsAppId ?? input.swapOpsAppId ?? input.appId ?? 0);
    if (appId <= 0)
        throw new Error("v2SwapOpsAppId is required");
    return appId;
}
function v2OrderOpsAppId(input) {
    const appId = Number(input.v2OrderOpsAppId ?? input.orderOpsAppId ?? input.appId ?? 0);
    if (appId <= 0)
        throw new Error("v2OrderOpsAppId is required");
    return appId;
}
function v2OrderOpsAppAddress(input) {
    const configured = input.v2OrderOpsAppAddress ?? input.orderOpsAppAddress;
    return configured === undefined ? addressString(getApplicationAddress(v2OrderOpsAppId(input))) : addressString(configured);
}
function v2AdminControlAppId(input) {
    const appId = Number(input.v2AdminControlAppId ?? input.v2AdminAppId ?? 0);
    if (appId <= 0)
        throw new Error("v2AdminControlAppId is required");
    return appId;
}
function v2AdminOpsForeignApps(input) {
    return uniqueNumbers([
        input.v2MarketsAppId,
        v2AdminControlAppId(input),
        ...v2MathAppRefs(input),
    ]);
}
function v2SwapOpsForeignApps(input) {
    return uniqueNumbers([
        input.v2MarketsAppId,
        v2AdminControlAppId(input),
        ...v2MathAppRefs(input),
    ]);
}
function v2TradingForeignApps(input, options = {}) {
    return [
        ...new Set([
            v2AdminControlAppId(input),
            options.includeRiskOps ? input.v2TradingRiskOpsAppId ?? 0 : 0,
            ...(options.includeMath === false ? [] : v2MathAppRefs(input)),
        ].filter((value) => Number(value) > 0)),
    ];
}
function requiredV2TradingRiskOpsAppId(input) {
    const appId = Number(input.v2TradingRiskOpsAppId ?? 0);
    if (appId <= 0)
        throw new Error("v2TradingRiskOpsAppId is required");
    return appId;
}
function v2SingleTokenTradingForeignApps(input, options = {}) {
    return [
        ...new Set([
            v2AdminControlAppId(input),
            options.includeRiskOps ? input.v2TradingRiskOpsAppId ?? 0 : 0,
            ...(options.includeMath === false ? [] : v2MathAppRefs(input)),
        ].filter((value) => Number(value) > 0)),
    ];
}
function v2CvaVaultAppId(input) {
    const appId = Number(input.v2CvaVaultAppId ?? input.cvaVaultAppId ?? input.appId ?? 0);
    if (appId <= 0)
        throw new Error("v2CvaVaultAppId is required");
    return appId;
}
function v2MarketYieldVaultAppId(input) {
    const appId = Number(input.v2MarketYieldVaultAppId ??
        input.marketFolksYieldVaultAppId ??
        input.marketYieldVaultAppId ??
        input.appId ??
        0);
    if (!Number.isFinite(appId) || appId <= 0)
        throw new Error("v2MarketYieldVaultAppId is required");
    return appId;
}
function v2MarketXalgoYieldVaultAppId(input) {
    const appId = Number(input.v2MarketXalgoYieldVaultAppId ??
        input.marketXalgoYieldVaultAppId ??
        input.marketYieldVaultAppId ??
        input.appId ??
        0);
    if (!Number.isFinite(appId) || appId <= 0)
        throw new Error("v2MarketXalgoYieldVaultAppId is required");
    return appId;
}
function buildV2MarketYieldVaultFolksMarkLikeCall(input, methodName) {
    const appId = v2MarketYieldVaultAppId(input);
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for market yield Folks mark/refresh resource carrier");
    const receiptAssetId = Number(input.receiptAssetId ?? 0);
    const foreignAssets = receiptAssetId > 0 ? uniqueNumbers([input.assetId, receiptAssetId]) : [];
    const manifest = input.manifest ?? loadManifest(undefined, 2);
    const call = buildAppCall({
        appId,
        appName: "PDexV2MarketYieldVault",
        methodName,
        sender: input.sender,
        args: [input.marketId, input.assetId],
        boxes: [],
        foreignApps: uniqueNumbers([
            input.folksPoolAppId,
            input.folksPoolManagerAppId,
            v2AdminControlAppId(input),
        ]),
        foreignAssets,
        flatFeeMicroAlgo: V2_YIELD_PDEX_BASE_FLAT_FEE_MICRO_ALGO,
        manifest,
    });
    call.resourceCarriers = [
        buildAppCall({
            appId: mathAppId,
            appName: "PDexV2Math",
            methodName: "noop",
            sender: input.sender,
            args: [],
            boxes: [
                ...v2MarketYieldStrategyBoxRefs(input.marketId, input.assetId, appId),
            ],
            foreignApps: [appId],
            flatFeeMicroAlgo: 1_000,
            manifest,
        }),
        buildAppCall({
            appId: mathAppId,
            appName: "PDexV2Math",
            methodName: "noop",
            sender: input.sender,
            args: [],
            boxes: v2MarketYieldMarkValueBoxRefs(input),
            foreignApps: [input.marketsAppId],
            foreignAssets: foreignAsset(input.assetId),
            flatFeeMicroAlgo: 1_000,
            manifest,
        }),
    ];
    return addFolksPoolUpdatePrerequisite(call, input);
}
function buildFolksUpdatePoolInterestIndexesCall(input) {
    if (input.folksPoolAppId <= 0 || input.folksPoolManagerAppId <= 0) {
        throw new Error("Folks pool and manager app ids are required");
    }
    const appArgs = [
        methodSelector("update_pool_interest_indexes(application)void"),
        new Uint8Array([1]),
    ];
    return {
        type: "appl",
        appId: input.folksPoolAppId,
        appName: "FolksLendingPool",
        method: "update_pool_interest_indexes",
        sender: addressString(input.sender),
        appArgs,
        appArgsB64: appArgs.map(bytesToBase64),
        boxes: [],
        boxesB64: [],
        foreignApps: [input.folksPoolManagerAppId],
        foreignAssets: [],
        accounts: [],
        flatFeeMicroAlgo: 2000n,
    };
}
function addFolksPoolUpdatePrerequisite(call, input) {
    if (input.updateFolksPoolInterestIndexes !== false) {
        call.prerequisiteCalls = [buildFolksUpdatePoolInterestIndexesCall(input)];
    }
    return call;
}
function v2MarketYieldMarkValueBoxRefs(input) {
    return [
        ...v2MarketsOwnedBoxes(input.marketsAppId, [
            v2MarketCoreBoxKey(input.marketId),
            v2MarketRiskBoxKey(input.marketId),
            v2MarketPoolBoxKey(input.marketId),
            v2MarketOpenInterestBoxKey(input.marketId),
            v2MarketFundingBorrowingBoxKey(input.marketId),
        ]),
        [input.marketsAppId, v2MarketYieldBoxKey(input.marketId, input.assetId)],
    ];
}
function buildV2MarketXalgoYieldVaultXalgoGroup(input, methodName, args, xalgoProviderFeeCredit) {
    const appId = v2MarketXalgoYieldVaultAppId(input);
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for market xALGO resource carriers");
    const manifest = input.manifest ?? loadManifest(undefined, 2);
    const vaultAddress = addressString(input.marketXalgoVaultAppAddress ?? getApplicationAddress(appId));
    const boxes = [
        ...v2MarketsOwnedBoxes(input.marketsAppId, v2MarketBoxes(input.marketId, undefined, input.indexAssetId)),
        [input.marketsAppId, v2MarketYieldBoxKey(input.marketId, NATIVE_ALGO_ASSET_ID)],
        ...v2MarketXalgoStrategyBoxRefs(input.marketId, appId),
        [input.xalgoConsensusAppId, new TextEncoder().encode("pr")],
    ];
    const foreignApps = [
        input.marketsAppId,
        input.xalgoConsensusAppId,
        v2AdminControlAppId(input),
    ];
    const foreignAssets = foreignAsset(input.xalgoAssetId);
    const accounts = xalgoResourceAccounts(vaultAddress, input.proposerAddresses);
    const directCount = directAccountCapacity({
        foreignApps,
        foreignAssets,
        boxes: [],
    });
    const resourceCarriers = chunks(accounts.slice(directCount), XALGO_RESOURCE_ACCOUNT_LIMIT).map((chunk) => buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender: input.sender,
        args: [],
        accounts: chunk,
        flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
        manifest,
    }));
    const boxesByOwner = new Map();
    for (const rawBox of boxes) {
        const normalized = boxRef(rawBox);
        const ownerAppId = Number(normalized.appIndex);
        if (ownerAppId <= 0)
            throw new Error("xALGO box owner app id must be positive");
        const ownerBoxes = boxesByOwner.get(ownerAppId) ?? [];
        ownerBoxes.push([ownerAppId, normalized.name]);
        boxesByOwner.set(ownerAppId, ownerBoxes);
    }
    for (const [ownerAppId, ownerBoxes] of boxesByOwner) {
        const ownerForeignApps = ownerAppId === mathAppId ? [] : [ownerAppId];
        for (const boxChunk of chunks(ownerBoxes, 8 - ownerForeignApps.length)) {
            resourceCarriers.push(buildAppCall({
                appId: mathAppId,
                appName: "PDexV2Math",
                methodName: "noop",
                sender: input.sender,
                args: [],
                boxes: boxChunk,
                foreignApps: ownerForeignApps,
                flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
                manifest,
            }));
        }
    }
    const call = {
        ...buildAppCall({
            appId,
            appName: "PDexV2MarketXAlgoYieldVault",
            methodName,
            sender: input.sender,
            args,
            accounts: accounts.slice(0, directCount),
            boxes: [],
            foreignApps,
            foreignAssets,
            flatFeeMicroAlgo: BigInt(V2_YIELD_PDEX_BASE_FLAT_FEE_MICRO_ALGO) + xalgoProviderFeeCredit,
            manifest,
        }),
        resourceCarriers,
    };
    return call;
}
function xalgoResourceAccounts(vaultAppAddress, proposerAddresses) {
    const values = [vaultAppAddress, ...proposerAddresses].map(addressString).filter(Boolean);
    return [...new Set(values)];
}
function directAccountCapacity(input) {
    const resourceCount = new Set(input.foreignApps.map(Number)).size
        + new Set(input.foreignAssets.map(Number)).size
        + input.boxes.length;
    return Math.min(XALGO_RESOURCE_ACCOUNT_LIMIT, Math.max(0, 8 - resourceCount));
}
function chunks(values, chunkSize) {
    const result = [];
    for (let index = 0; index < values.length; index += chunkSize) {
        result.push(values.slice(index, index + chunkSize));
    }
    return result;
}
function v2MarketAssets(input, extra) {
    const values = [input.longAssetId, input.shortAssetId, extra].filter((value) => value !== undefined && Number(value) > 0);
    return [...new Set(values.map((value) => Number(value)))];
}
function v2PoolAssets(input) {
    const values = [input.longAssetId, input.shortAssetId].filter((value) => value !== undefined && Number(value) > 0);
    return [...new Set(values.map((value) => Number(value)))];
}
function v2YieldRecallMode(input) {
    const mode = input.yieldRecallMode ?? input.yield_recall_mode;
    if (mode === undefined || mode === null) {
        throw new Error("Yield recall preparation is required. Use prepareV2ActionRecall or prepareV2DecreaseOrCloseTransactions before building a payout transaction.");
    }
    if (![0, 1, 0n, 1n, "0", "1"].includes(mode))
        throw new Error("Invalid yield recall mode");
    return mode;
}
function v2ActionRecallCap(input, ...names) {
    for (const name of names) {
        const value = input[name];
        if (value !== undefined && value !== null)
            return value;
    }
    return 0;
}
function v2TradingActionRecallAssets(input, maxLongReceiptAmount, maxShortReceiptAmount) {
    const assets = [];
    if (Number(maxLongReceiptAmount) > 0)
        assets.push(input.longAssetId);
    if (Number(maxShortReceiptAmount) > 0)
        assets.push(input.shortAssetId);
    return assets;
}
function v2CvaActionRecallAssets(input, maxLongReceiptAmount, maxShortReceiptAmount) {
    const assets = [];
    if (bigint(maxLongReceiptAmount) > 0n)
        assets.push(input.longAssetId);
    if (bigint(maxShortReceiptAmount) > 0n)
        assets.push(input.shortAssetId);
    return assets;
}
function v2TradingActionRecallCount(input, maxLongReceiptAmount, maxShortReceiptAmount) {
    const override = input.marketYieldRecallCount ?? input.market_yield_recall_count;
    if (override !== undefined && override !== null)
        return Number(override);
    if (Number(maxLongReceiptAmount) <= 0 && Number(maxShortReceiptAmount) <= 0)
        return 0;
    return 3;
}
function marketYieldResourceClosureFromRegistry(input) {
    const registry = input.registry;
    const marketId = Number(input.marketId);
    const assetId = Number(input.assetId);
    const marketsAppId = Number(registry.markets_app_id ?? registry.marketsAppId);
    const defaultVaultAppId = Number(registry.market_yield_vault_app_id ?? registry.marketYieldVaultAppId);
    const strategy = (registry.strategies ?? []).find((item) => Number(item.market_id ?? item.marketId) === marketId &&
        Number(item.asset_id ?? item.assetId) === assetId);
    if (!strategy)
        throw new Error(`market-yield strategy not found for asset ${assetId}`);
    const market = (registry.markets ?? []).find((item) => Number(item.market_id ?? item.marketId) === marketId);
    const indexAssetId = input.indexAssetId ??
        market?.index_asset_id ??
        market?.indexAssetId ??
        (input.includeVirtualInventory ? assetId : undefined);
    const accounts = [];
    const boxes = [
        [marketsAppId, v2MarketCoreBoxKey(marketId)],
        [marketsAppId, v2MarketRiskBoxKey(marketId)],
        [marketsAppId, v2MarketPoolBoxKey(marketId)],
        [marketsAppId, v2MarketOpenInterestBoxKey(marketId)],
        [marketsAppId, v2MarketFundingBorrowingBoxKey(marketId)],
        [marketsAppId, v2MarketYieldBoxKey(marketId, assetId)],
    ];
    if (input.includeVirtualInventory && indexAssetId !== undefined && indexAssetId !== null) {
        boxes.push([marketsAppId, v2VirtualPositionInventoryBoxKey(indexAssetId)]);
    }
    const strategyKind = Number(strategy.strategy_kind ?? strategy.strategyKind);
    if (strategyKind === 2) {
        const xalgoVaultAppId = Number(registry.market_xalgo_yield_vault_app_id
            || registry.marketXalgoYieldVaultAppId
            || defaultVaultAppId);
        const xalgoConsensusAppId = Number(strategy.xalgo_consensus_app_id ??
            strategy.xalgoConsensusAppId ??
            registry.xalgo_consensus_app_id ??
            registry.xalgoConsensusAppId);
        const xalgoAssetId = Number(strategy.xalgo_asset_id ??
            strategy.xalgoAssetId ??
            registry.xalgo_asset_id ??
            registry.xalgoAssetId);
        boxes.push([xalgoVaultAppId, v2MarketXalgoStrategyConfigBoxKey(marketId)], [xalgoVaultAppId, v2MarketXalgoStrategyRuntimeBoxKey(marketId)], [xalgoConsensusAppId, new TextEncoder().encode("pr")]);
        accounts.push(addressString(registry.market_xalgo_yield_vault_app_address
            || registry.marketXalgoYieldVaultAppAddress
            || getApplicationAddress(xalgoVaultAppId)), getApplicationAddress(xalgoConsensusAppId).toString());
        for (const account of (strategy.xalgo_proposer_addresses ??
            strategy.xalgoProposerAddresses ??
            registry.xalgo_proposer_addresses ??
            registry.xalgoProposerAddresses ??
            [])) {
            accounts.push(addressString(account));
        }
        return {
            foreignApps: uniqueNumbers([marketsAppId, xalgoVaultAppId, xalgoConsensusAppId]),
            foreignAssets: uniqueNumbers([xalgoAssetId]),
            accounts: [...new Set(accounts)],
            boxes,
            requiredResourceBundles: [],
            flatFeeMicroAlgo: BigInt(V2_YIELD_PDEX_BASE_FLAT_FEE_MICRO_ALGO + V2_YIELD_MAX_POOL_CALL_FEE_MICRO_ALGO),
        };
    }
    const folksVaultAppId = Number(registry.market_folks_yield_vault_app_id ??
        registry.marketFolksYieldVaultAppId ??
        registry.market_yield_vault_app_id ??
        registry.marketYieldVaultAppId);
    const actionRouterAppId = Boolean(registry.action_recall_uses_router ?? registry.actionRecallUsesRouter ?? false)
        ? Number(registry.market_xalgo_yield_vault_app_id
            || registry.marketXalgoYieldVaultAppId
            || defaultVaultAppId)
        : 0;
    boxes.push([folksVaultAppId, v2MarketYieldStrategyConfigBoxKey(marketId, assetId)], [folksVaultAppId, v2MarketYieldStrategyRuntimeBoxKey(marketId, assetId)]);
    accounts.push(addressString(registry.market_folks_yield_vault_app_address
        ?? registry.marketFolksYieldVaultAppAddress
        ?? getApplicationAddress(folksVaultAppId)), getApplicationAddress(Number(strategy.folks_pool_app_id ?? strategy.folksPoolAppId)).toString(), getApplicationAddress(Number(strategy.folks_pool_manager_app_id ?? strategy.folksPoolManagerAppId)).toString());
    const folksPoolAppId = Number(strategy.folks_pool_app_id ?? strategy.folksPoolAppId);
    const folksPoolManagerAppId = Number(strategy.folks_pool_manager_app_id ?? strategy.folksPoolManagerAppId);
    const folksVaultAddress = addressString(registry.market_folks_yield_vault_app_address
        ?? registry.marketFolksYieldVaultAppAddress
        ?? getApplicationAddress(folksVaultAppId));
    const folksPoolAddress = getApplicationAddress(folksPoolAppId).toString();
    return {
        foreignApps: uniqueNumbers([
            marketsAppId,
            // Keep the external provider apps first so resource-carrier packing
            // co-locates the Folks pool with the vault account it reads locally.
            Number(strategy.folks_pool_app_id ?? strategy.folksPoolAppId),
            Number(strategy.folks_pool_manager_app_id ?? strategy.folksPoolManagerAppId),
            actionRouterAppId,
            folksVaultAppId,
        ]),
        foreignAssets: uniqueNumbers([
            Number(strategy.underlying_asset_id ?? strategy.underlyingAssetId),
            Number(strategy.receipt_asset_id ?? strategy.receiptAssetId),
        ]),
        accounts: [...new Set(accounts)],
        boxes,
        // Folks reads pool local state through the manager and reads provider
        // holdings through the pool/vault accounts. These resources must coexist
        // in one top-level transaction; group-level availability alone is not
        // sufficient for local-state or asset-holding access.
        requiredResourceBundles: [{
                foreignApps: uniqueNumbers([folksPoolManagerAppId, folksPoolAppId]),
                foreignAssets: uniqueNumbers([
                    Number(strategy.underlying_asset_id ?? strategy.underlyingAssetId),
                    Number(strategy.receipt_asset_id ?? strategy.receiptAssetId),
                ]),
                accounts: [...new Set([folksPoolAddress, folksVaultAddress])],
            }],
        flatFeeMicroAlgo: BigInt(Number(registry.market_yield_recall_flat_fee_micro_algos ?? registry.marketYieldRecallFlatFeeMicroAlgos ?? MARKET_YIELD_ACTION_RECALL_FLAT_FEE_MICRO_ALGO)),
    };
}
function v2AutomaticSettlementRouterAppId(input) {
    const rawRegistry = (input.marketYieldRegistry ?? input.market_yield_registry);
    const registry = (rawRegistry?.snapshot ?? rawRegistry);
    const directAppId = Number(input.v2MarketXalgoYieldVaultAppId
        ?? input.v2_market_xalgo_yield_vault_app_id
        ?? input.marketXalgoYieldVaultAppId
        ?? input.market_xalgo_yield_vault_app_id
        ?? 0);
    const registryAppId = Number(registry?.market_xalgo_yield_vault_app_id
        || registry?.marketXalgoYieldVaultAppId
        || registry?.market_yield_vault_app_id
        || registry?.marketYieldVaultAppId
        || 0);
    const appId = directAppId > 0 ? directAppId : registryAppId;
    if (!Number.isFinite(appId) || appId <= 0) {
        throw new Error("v2MarketXalgoYieldVaultAppId is required for automatic position-cost settlement");
    }
    return appId;
}
function v2AutomaticSettlementStrategyAssets(input, assetIds) {
    const rawRegistry = (input.marketYieldRegistry ?? input.market_yield_registry);
    if (!rawRegistry)
        return [];
    const registry = (rawRegistry.snapshot ?? rawRegistry);
    const marketId = Number(input.marketId);
    const configured = new Set(arrayValues(registry.strategies)
        .filter((strategy) => Number(strategyField(strategy, "market_id", "marketId") ?? 0) === marketId)
        .map((strategy) => Number(strategyField(strategy, "asset_id", "assetId") ?? -1)));
    return [...new Set(assetIds.map(Number).filter((assetId) => configured.has(assetId)))];
}
function mergeV2AutomaticSettlementRecallResources(call, input, assetIds, coveredResourceCalls) {
    const existingResourceCarriers = call.resourceCarriers ?? [];
    const resourceCoverageCalls = [
        ...new Set([...coveredResourceCalls, ...existingResourceCarriers]),
    ];
    const strategyAssets = v2AutomaticSettlementStrategyAssets(input, assetIds);
    const routerAppId = v2AutomaticSettlementRouterAppId(input);
    let routerCovered = resourceCoverageCalls.some((descriptor) => descriptor.foreignApps.includes(routerAppId));
    if (!routerCovered) {
        for (const descriptor of resourceCoverageCalls) {
            const resourceCount = descriptor.foreignApps.length
                + descriptor.foreignAssets.length
                + descriptor.accounts.length
                + descriptor.boxes.length;
            if (resourceCount < 8) {
                descriptor.foreignApps = uniqueNumbers([...descriptor.foreignApps, routerAppId]);
                routerCovered = true;
                break;
            }
        }
    }
    const routerCarriers = routerCovered
        ? []
        : buildV2ActionRecallResourceCarriers(input, call.sender, { foreignApps: [routerAppId], foreignAssets: [], accounts: [], boxes: [] }, [call, ...resourceCoverageCalls]);
    if (!strategyAssets.length) {
        return {
            ...call,
            resourceCarriers: [...routerCarriers, ...(call.resourceCarriers ?? [])],
        };
    }
    const settlementCall = { ...call };
    delete settlementCall.resourceCarriers;
    const settlementInput = { ...input, yieldRecallMode: 1 };
    const withResources = mergeV2ActionRecallResources(settlementCall, settlementInput, strategyAssets, 
    // Each configured claim asset can traverse the complete router -> Folks
    // vault -> provider return path during one settlement.
    3 * strategyAssets.length, [...resourceCoverageCalls, ...routerCarriers]);
    const withFee = withV2ActionXalgoProviderFeeCredit(withResources, settlementInput, 1, strategyAssets.map((assetId) => ({ marketId: input.marketId, assetId, receiptCap: 1 })));
    return {
        ...withFee,
        resourceCarriers: [
            ...routerCarriers,
            ...existingResourceCarriers,
            ...(withFee.resourceCarriers ?? []),
        ],
    };
}
function mergeV2ActionRecallResources(call, input, assetIds, recallCount, coveredResourceCalls, refreshAssetCount = 0, finalizeAfterRecall = false) {
    if (Number(v2YieldRecallMode(input)) !== 1 || recallCount <= 0)
        return call;
    const registry = (input.marketYieldRegistry ?? input.market_yield_registry);
    if (!registry)
        throw new Error("marketYieldRegistry is required when yieldRecallMode is 1");
    const marketId = Number(input.marketId);
    const foreignApps = [];
    const foreignAssets = [];
    const accounts = [];
    const boxes = [];
    const requiredResourceBundles = [];
    for (const rawAssetId of [...new Set(assetIds.map(Number))]) {
        const closure = marketYieldResourceClosureFromRegistry({
            registry,
            marketId,
            assetId: rawAssetId,
            includeVirtualInventory: false,
        });
        foreignApps.push(...closure.foreignApps);
        foreignAssets.push(...closure.foreignAssets);
        accounts.push(...closure.accounts);
        boxes.push(...closure.boxes);
        requiredResourceBundles.push(...closure.requiredResourceBundles);
    }
    const actionRecallCarriers = buildV2ActionRecallResourceCarriers(input, call.sender, { foreignApps, foreignAssets, accounts, boxes, requiredResourceBundles }, [call, ...coveredResourceCalls]);
    return {
        ...call,
        flatFeeMicroAlgo: (call.flatFeeMicroAlgo ?? 1000n)
            + BigInt(recallCount * MARKET_YIELD_ACTION_RECALL_FLAT_FEE_MICRO_ALGO)
            + BigInt(refreshAssetCount > 0
                ? refreshAssetCount
                    * (MARKET_YIELD_ACTION_HOT_CHECK_FLAT_FEE_MICRO_ALGO
                        + MARKET_YIELD_ACTION_MARK_FLAT_FEE_MICRO_ALGO)
                : 0)
            + BigInt(finalizeAfterRecall ? MARKET_YIELD_ACTION_FINALIZATION_FLAT_FEE_MICRO_ALGO : 0),
        ...(actionRecallCarriers.length ? { resourceCarriers: actionRecallCarriers } : {}),
    };
}
function mergeV2SingleTokenActionRecallResources(call, input, maxBackingReceiptAmount, includeVirtualInventory, coveredResourceCalls, refreshBeforeQuote = false) {
    if (Number(v2YieldRecallMode(input)) !== 1 || bigint(maxBackingReceiptAmount) <= 0n)
        return call;
    const registry = (input.marketYieldRegistry ?? input.market_yield_registry);
    if (!registry)
        throw new Error("marketYieldRegistry is required when yieldRecallMode is 1");
    const closure = marketYieldResourceClosureFromRegistry({
        registry,
        marketId: input.marketId,
        assetId: input.backingAssetId,
        indexAssetId: input.indexAssetId,
        includeVirtualInventory,
    });
    const actionRecallCarriers = buildV2ActionRecallResourceCarriers(input, call.sender, closure, [call, ...coveredResourceCalls]);
    const inlineRecallFee = BigInt(V2_SINGLE_TOKEN_INLINE_RECALL_METHOD_FLAT_FEE_MICRO_ALGO
        + (refreshBeforeQuote
            ? MARKET_YIELD_ACTION_HOT_CHECK_FLAT_FEE_MICRO_ALGO
                + MARKET_YIELD_ACTION_MARK_FLAT_FEE_MICRO_ALGO
                + MARKET_YIELD_ACTION_FINALIZATION_FLAT_FEE_MICRO_ALGO
            : 0));
    let flatFeeMicroAlgo = closure.flatFeeMicroAlgo > inlineRecallFee
        ? closure.flatFeeMicroAlgo
        : inlineRecallFee;
    if (call.flatFeeMicroAlgo !== undefined && call.flatFeeMicroAlgo !== BigInt(HEAVY_METHOD_FLAT_FEE_MICRO_ALGO)) {
        flatFeeMicroAlgo = call.flatFeeMicroAlgo > flatFeeMicroAlgo ? call.flatFeeMicroAlgo : flatFeeMicroAlgo;
    }
    return {
        ...call,
        flatFeeMicroAlgo,
        ...(actionRecallCarriers.length ? { resourceCarriers: actionRecallCarriers } : {}),
    };
}
function buildV2ActionRecallResourceCarriers(input, sender, closure, coveredResourceCalls) {
    const mathAppId = Number(input.v2MathAppId ?? input.v2_math_app_id ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for action-recall resource carriers");
    const manifest = input.manifest ?? loadManifest(undefined, 2);
    const coveredApps = new Set(coveredResourceCalls.flatMap((descriptor) => descriptor.foreignApps.map(Number)));
    const coveredAssets = new Set(coveredResourceCalls.flatMap((descriptor) => descriptor.foreignAssets.map(Number)));
    const coveredAccounts = new Set(coveredResourceCalls.flatMap((descriptor) => descriptor.accounts));
    coveredAccounts.add(addressString(sender));
    const coveredBoxes = new Set(coveredResourceCalls.flatMap((descriptor) => descriptor.boxesB64));
    const bundles = [];
    const descriptorCoversBundle = (descriptor, bundle) => (bundle.foreignApps.every((appId) => descriptor.foreignApps.includes(appId))
        && bundle.foreignAssets.every((assetId) => descriptor.foreignAssets.includes(assetId))
        && bundle.accounts.every((account) => descriptor.accounts.includes(account)));
    for (const required of closure.requiredResourceBundles ?? []) {
        const bundle = {
            foreignApps: uniqueNumbers(required.foreignApps.filter((value) => Number(value) > 0)),
            foreignAssets: uniqueNumbers(required.foreignAssets.filter((value) => Number(value) > 0)),
            accounts: [...new Set(required.accounts.map(addressString))],
        };
        const resourceCount = bundle.foreignApps.length + bundle.foreignAssets.length + bundle.accounts.length;
        if (resourceCount > 8)
            throw new Error("action-recall required resource bundle exceeds eight references");
        if (bundle.accounts.length > XALGO_RESOURCE_ACCOUNT_LIMIT) {
            throw new Error("action-recall required resource bundle exceeds account limit");
        }
        if (!coveredResourceCalls.some((descriptor) => descriptorCoversBundle(descriptor, bundle))) {
            bundles.push(bundle);
        }
    }
    const bundledApps = new Set(bundles.flatMap((bundle) => bundle.foreignApps));
    const bundledAssets = new Set(bundles.flatMap((bundle) => bundle.foreignAssets));
    const bundledAccounts = new Set(bundles.flatMap((bundle) => bundle.accounts));
    const missingApps = uniqueNumbers(closure.foreignApps.filter((value) => Number(value) > 0))
        .filter((appId) => !coveredApps.has(appId) && !bundledApps.has(appId));
    const holdingAssets = uniqueNumbers(closure.foreignAssets.filter((value) => Number(value) > 0));
    const missingAssets = holdingAssets.filter((assetId) => !coveredAssets.has(assetId) && !bundledAssets.has(assetId));
    const missingAccounts = [...new Set(closure.accounts.map(addressString))]
        .filter((account) => !coveredAccounts.has(account) && !bundledAccounts.has(account));
    if (missingAccounts.length) {
        const accountCapacity = Math.min(XALGO_RESOURCE_ACCOUNT_LIMIT, 8 - holdingAssets.length);
        if (accountCapacity <= 0)
            throw new Error("action-recall assets leave no room for holding accounts");
        for (const accountChunk of chunks(missingAccounts, accountCapacity)) {
            bundles.push({
                foreignApps: [],
                foreignAssets: [...holdingAssets],
                accounts: [...accountChunk],
            });
        }
    }
    const addResource = (kind, value) => {
        for (const bundle of bundles) {
            const resourceCount = bundle.foreignApps.length + bundle.foreignAssets.length + bundle.accounts.length;
            if (resourceCount >= 8)
                continue;
            if (kind === "accounts" && bundle.accounts.length >= XALGO_RESOURCE_ACCOUNT_LIMIT)
                continue;
            bundle[kind].push(value);
            return;
        }
        bundles.push({
            foreignApps: kind === "foreignApps" ? [Number(value)] : [],
            foreignAssets: kind === "foreignAssets" ? [Number(value)] : [],
            accounts: kind === "accounts" ? [String(value)] : [],
        });
    };
    for (const appId of missingApps)
        addResource("foreignApps", appId);
    const packedAssets = new Set(bundles.flatMap((bundle) => bundle.foreignAssets));
    for (const assetId of missingAssets) {
        if (!packedAssets.has(assetId))
            addResource("foreignAssets", assetId);
    }
    const carriers = bundles.map((bundle) => buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender,
        args: [],
        foreignApps: bundle.foreignApps,
        foreignAssets: bundle.foreignAssets,
        accounts: bundle.accounts,
        flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
        manifest,
    }));
    const boxesByOwner = new Map();
    for (const rawBox of closure.boxes) {
        const normalized = boxRef(rawBox);
        const ownerAppId = Number(normalized.appIndex);
        const key = `${ownerAppId}:${bytesToBase64(normalized.name)}`;
        if (coveredBoxes.has(key))
            continue;
        if (ownerAppId <= 0)
            throw new Error("action-recall box owner app id must be positive");
        const ownerBoxes = boxesByOwner.get(ownerAppId) ?? [];
        ownerBoxes.push([ownerAppId, normalized.name]);
        boxesByOwner.set(ownerAppId, ownerBoxes);
    }
    for (const [ownerAppId, ownerBoxes] of boxesByOwner) {
        const ownerForeignApps = ownerAppId === mathAppId ? [] : [ownerAppId];
        for (const boxChunk of chunks(ownerBoxes, 8 - ownerForeignApps.length)) {
            carriers.push(buildAppCall({
                appId: mathAppId,
                appName: "PDexV2Math",
                methodName: "noop",
                sender,
                args: [],
                boxes: boxChunk,
                foreignApps: ownerForeignApps,
                flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
                manifest,
            }));
        }
    }
    return carriers;
}
function mergeV2RouteActionRecallResources(call, input, marketAssetPairs, coveredResourceCalls) {
    if (Number(v2YieldRecallMode(input)) !== 1 || marketAssetPairs.length === 0)
        return call;
    const registry = (input.marketYieldRegistry ?? input.market_yield_registry);
    if (!registry)
        throw new Error("marketYieldRegistry is required when yieldRecallMode is 1");
    const foreignApps = [];
    const foreignAssets = [];
    const accounts = [];
    const boxes = [];
    const requiredResourceBundles = [];
    const seen = new Set();
    const uniquePairs = marketAssetPairs.filter((pair) => {
        const key = `${bigint(pair.marketId)}:${bigint(pair.assetId)}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    for (const pair of uniquePairs) {
        const closure = marketYieldResourceClosureFromRegistry({
            registry,
            marketId: pair.marketId,
            assetId: pair.assetId,
            includeVirtualInventory: false,
        });
        foreignApps.push(...closure.foreignApps);
        foreignAssets.push(...closure.foreignAssets);
        accounts.push(...closure.accounts);
        boxes.push(...closure.boxes);
        requiredResourceBundles.push(...closure.requiredResourceBundles);
    }
    const actionRecallCarriers = buildV2ActionRecallResourceCarriers(input, call.sender, { foreignApps, foreignAssets, accounts, boxes, requiredResourceBundles }, [call, ...coveredResourceCalls]);
    return {
        ...call,
        flatFeeMicroAlgo: (call.flatFeeMicroAlgo ?? 1000n)
            + BigInt(uniquePairs.length * MARKET_YIELD_ACTION_RECALL_FLAT_FEE_MICRO_ALGO)
            + BigInt(uniquePairs.length
                * (MARKET_YIELD_ACTION_HOT_CHECK_FLAT_FEE_MICRO_ALGO
                    + MARKET_YIELD_ACTION_MARK_FLAT_FEE_MICRO_ALGO))
            + BigInt(Math.max(0, uniquePairs.length - 1)
                * MARKET_YIELD_ACTION_REFRESH_ROUTER_FLAT_FEE_MICRO_ALGO),
        ...(actionRecallCarriers.length ? { resourceCarriers: actionRecallCarriers } : {}),
    };
}
function v2SwapOutputAsset(input, tokenInAssetId) {
    const tokenIn = bigint(tokenInAssetId);
    if (tokenIn === bigint(input.longAssetId))
        return input.shortAssetId;
    if (tokenIn === bigint(input.shortAssetId))
        return input.longAssetId;
    throw new Error("tokenInAssetId must match the V2 market long or short asset");
}
function v2WithdrawOutputMode(input) {
    if (input.outputMode !== undefined && input.outputMode !== null)
        return Number(input.outputMode);
    const outputToken = BigInt(input.outputTokenAssetId ?? 0);
    if (outputToken === 0n)
        return 0;
    if (outputToken === bigint(input.longAssetId))
        return 1;
    if (outputToken === bigint(input.shortAssetId))
        return 2;
    throw new Error("outputTokenAssetId must match the V2 market long or short asset");
}
function v2WithdrawOutputAssets(input, outputMode) {
    if (outputMode === 1)
        return Number(input.longAssetId) > 0 ? [Number(input.longAssetId)] : [];
    if (outputMode === 2)
        return Number(input.shortAssetId) > 0 ? [Number(input.shortAssetId)] : [];
    return v2PoolAssets(input);
}
function foreignAsset(assetId) {
    const value = Number(assetId);
    return value > 0 ? [value] : [];
}
function makeTokenTransferTxn(sender, receiver, assetId, amount, suggestedParams, note, allowZero = false) {
    if (bigint(amount) < 0n || (bigint(amount) === 0n && !allowZero)) {
        throw new Error(allowZero ? "amount must be non-negative" : "amount must be positive");
    }
    if (bigint(assetId) < 0n)
        throw new Error("assetId must be non-negative");
    if (bigint(assetId) === BigInt(NATIVE_ALGO_ASSET_ID)) {
        return makePaymentTxnWithSuggestedParamsFromObject({
            sender: addressString(sender),
            receiver: addressString(receiver),
            amount: bigint(amount),
            suggestedParams,
            note,
        });
    }
    return makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: addressString(sender),
        receiver: addressString(receiver),
        amount: bigint(amount),
        assetIndex: Number(assetId),
        suggestedParams,
        note,
    });
}
function encodeArg(type, value) {
    if (type === "uint64")
        return uint64Bytes(bigint(value));
    if (type === "address")
        return accountBytes(value);
    if (type === "byte[]") {
        const raw = bytes(value);
        return concat([new Uint8Array([raw.byteLength >> 8, raw.byteLength & 0xff]), raw]);
    }
    if (type === "bytes")
        return bytes(value);
    if (type.startsWith("("))
        return encodeTuple(splitTupleTypes(type), value);
    throw new Error(`unsupported arg type: ${type}`);
}
function encodeTuple(types, values) {
    if (types.length !== values.length)
        throw new Error(`tuple expects ${types.length} values`);
    const headSize = types.reduce((size, type, index) => size + (isDynamicAbiType(type) ? 2 : encodeArg(type, values[index]).byteLength), 0);
    let tailOffset = headSize;
    const head = [];
    const tail = [];
    types.forEach((type, index) => {
        const encoded = encodeArg(type, values[index]);
        if (!isDynamicAbiType(type)) {
            head.push(encoded);
            return;
        }
        if (tailOffset > 0xffff)
            throw new Error("tuple tail offset too large");
        head.push(new Uint8Array([tailOffset >> 8, tailOffset & 0xff]));
        tail.push(encoded);
        tailOffset += encoded.byteLength;
    });
    return concat([...head, ...tail]);
}
function isDynamicAbiType(type) {
    return type === "byte[]" || (type.startsWith("(") && splitTupleTypes(type).some(isDynamicAbiType));
}
function splitTupleTypes(type) {
    const trimmed = type.trim();
    if (!trimmed.startsWith("(") || !trimmed.endsWith(")"))
        throw new Error(`bad tuple type: ${type}`);
    const inner = trimmed.slice(1, -1);
    const parts = [];
    let start = 0;
    let depth = 0;
    for (let index = 0; index < inner.length; index += 1) {
        const char = inner[index];
        if (char === "(")
            depth += 1;
        if (char === ")")
            depth -= 1;
        if (char === "," && depth === 0) {
            parts.push(inner.slice(start, index).trim());
            start = index + 1;
        }
    }
    if (inner.length)
        parts.push(inner.slice(start).trim());
    return parts.filter(Boolean);
}
export function v2LargeProgramRoles(appName, methodName) {
    const roles = [];
    if (appName === "PDexV2Markets"
        || V2_MARKETS_CALLER_METHODS[appName]?.has(methodName)) {
        roles.push("markets");
    }
    if (appName === "PDexV2CvaVault") {
        roles.push("cva_vault");
    }
    if (appName === "PDexV2Trading"
        || V2_TRADING_CALLER_METHODS[appName]?.has(methodName)) {
        roles.push("trading");
    }
    if (appName === "PDexV2SingleTokenTrading"
        || (appName === "PDexV2OrderOps" && V2_TRADING_CALLER_METHODS.PDexV2OrderOps.has(methodName)))
        roles.push("single_token_trading");
    if (appName === "PDexV2OrderOps")
        roles.push("order_ops");
    return roles;
}
function v2LargeProgramBudgetedBoxes(call, allowPartial) {
    const roles = new Set(call.largeProgramRoles ?? []);
    const required = [...roles].reduce((total, role) => total + V2_LARGE_PROGRAM_READ_BUDGET_REFS[role], 0);
    // Named box references fund their box values. Only empty references can
    // safely offset the dedicated large-program requirement.
    const descriptors = v2DescriptorCalls(call);
    const existingEmpty = descriptors.reduce((total, descriptor) => total + descriptor.boxes.filter((box) => box.name.length === 0).length, 0);
    const missing = Math.max(0, required - existingEmpty);
    if (!missing)
        return call.boxes;
    const used = call.foreignApps.length
        + call.foreignAssets.length
        + call.accounts.length
        + call.boxes.length;
    const localCapacity = Math.max(0, 8 - used);
    const nestedCapacity = descriptors.slice(1).reduce((total, descriptor) => total + Math.max(0, 8
        - descriptor.foreignApps.length
        - descriptor.foreignAssets.length
        - descriptor.accounts.length
        - descriptor.boxes.length), 0);
    if (!allowPartial && localCapacity + nestedCapacity < missing) {
        throw new Error("insufficient_large_program_read_budget_capacity");
    }
    return [
        ...call.boxes,
        ...Array.from({ length: Math.min(missing, localCapacity) }, () => ({ appIndex: 0, name: new Uint8Array() })),
    ];
}
function fundV2LargeProgramBudgetWithMathCarriers(call, roles, rawMathAppId, sender, manifest) {
    const required = [...new Set(roles)].reduce((total, role) => total + V2_LARGE_PROGRAM_READ_BUDGET_REFS[role], 0);
    const carriers = (call.resourceCarriers ?? []).map((carrier) => ({
        ...carrier,
        boxes: [...carrier.boxes],
        boxesB64: [...carrier.boxesB64],
    }));
    const descriptors = [call, ...carriers];
    const existingEmpty = descriptors.reduce((total, descriptor) => total + descriptor.boxes.filter((box) => box.name.length === 0).length, 0);
    let missing = Math.max(0, required - existingEmpty);
    if (!missing)
        return call;
    for (const carrier of carriers) {
        const used = carrier.foreignApps.length
            + carrier.foreignAssets.length
            + carrier.accounts.length
            + carrier.boxes.length;
        const count = Math.min(missing, Math.max(0, 8 - used));
        for (let index = 0; index < count; index += 1) {
            carrier.boxes.push({ appIndex: 0, name: new Uint8Array() });
            carrier.boxesB64.push("");
        }
        missing -= count;
        if (!missing)
            return { ...call, resourceCarriers: carriers };
    }
    const mathAppId = Number(rawMathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for AVM 13 program read budget");
    while (missing) {
        const count = Math.min(missing, 8);
        carriers.push(buildAppCall({
            appId: mathAppId,
            appName: "PDexV2Math",
            methodName: "noop",
            sender,
            args: [],
            boxes: Array.from({ length: count }, () => new Uint8Array()),
            flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
            manifest: manifest ?? loadManifest(undefined, 2),
        }));
        missing -= count;
    }
    return { ...call, resourceCarriers: carriers };
}
function fundV2LargeProgramBudgetAcrossCalls(call, activeMarkCalls, roles, rawMathAppId, sender, manifest) {
    const marks = activeMarkCalls.map((descriptor) => ({
        ...descriptor,
        boxes: [...descriptor.boxes],
        boxesB64: [...descriptor.boxesB64],
    }));
    const primary = {
        ...call,
        boxes: [...call.boxes],
        boxesB64: [...call.boxesB64],
        resourceCarriers: (call.resourceCarriers ?? []).map((descriptor) => ({
            ...descriptor,
            boxes: [...descriptor.boxes],
            boxesB64: [...descriptor.boxesB64],
        })),
    };
    const calls = [primary, ...marks, ...(primary.resourceCarriers ?? [])];
    const required = [...new Set(roles)].reduce((total, role) => total + V2_LARGE_PROGRAM_READ_BUDGET_REFS[role], 0);
    const existingEmpty = calls.reduce((total, descriptor) => total + descriptor.boxes.filter((box) => box.name.length === 0).length, 0);
    let missing = Math.max(0, required - existingEmpty);
    for (const descriptor of calls) {
        const used = descriptor.foreignApps.length
            + descriptor.foreignAssets.length
            + descriptor.accounts.length
            + descriptor.boxes.length;
        const count = Math.min(missing, Math.max(0, 8 - used));
        for (let index = 0; index < count; index += 1) {
            descriptor.boxes.push({ appIndex: 0, name: new Uint8Array() });
            descriptor.boxesB64.push("");
        }
        missing -= count;
        if (!missing)
            break;
    }
    const resourceCarriers = [...(primary.resourceCarriers ?? [])];
    if (missing) {
        const mathAppId = Number(rawMathAppId ?? 0);
        if (mathAppId <= 0)
            throw new Error("v2MathAppId is required for AVM 13 program read budget");
        while (missing) {
            const count = Math.min(missing, 8);
            resourceCarriers.push(buildAppCall({
                appId: mathAppId,
                appName: "PDexV2Math",
                methodName: "noop",
                sender,
                args: [],
                boxes: Array.from({ length: count }, () => new Uint8Array()),
                flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
                manifest: manifest ?? loadManifest(undefined, 2),
            }));
            missing -= count;
        }
    }
    return {
        ...primary,
        ...(activeMarkCalls.length ? { activeMarkCalls: marks } : {}),
        ...(resourceCarriers.length ? { resourceCarriers } : {}),
    };
}
function v2DescriptorCalls(call) {
    return [
        call,
        ...(call.prerequisiteCalls ?? []).flatMap(v2DescriptorCalls),
        ...(call.activeMarkCalls ?? []).flatMap(v2DescriptorCalls),
        ...(call.resourceCarrier ? v2DescriptorCalls(call.resourceCarrier) : []),
        ...(call.resourceCarriers ?? []).flatMap(v2DescriptorCalls),
        ...(call.settlementMaintenanceCalls ?? []).flatMap(v2DescriptorCalls),
    ];
}
function boxRef(box) {
    if (Array.isArray(box))
        return { appIndex: box[0], name: box[1] };
    return { appIndex: 0, name: box };
}
function paramsWithFee(params, fee) {
    if (fee === undefined)
        return params;
    return { ...params, flatFee: true, fee: bigint(fee) };
}
function grouped(txns, primaryIndex = txns.length - 1, primaryAppName = "") {
    applyV2LargeProgramReadBudgetToTransactions(txns, primaryIndex);
    validateAbiTransactionArguments(txns);
    for (const txn of txns)
        txn.group = undefined;
    distinguishRepeatedMathCarriers(txns);
    const transactions = assignGroupID(txns);
    return attachV2TransactionGroupMetadata(transactions, primaryIndex, primaryAppName);
}
function distinguishRepeatedMathCarriers(transactions) {
    // Independently built refresh/action groups can carry the same Math resource
    // call. Both calls are needed, but Algorand forbids repeated transaction IDs.
    // A note distinguishes the helper without changing ordering, resources or fees.
    const reserved = new Set(transactions.map((transaction) => transaction.txID()));
    const seen = new Set();
    for (const [index, transaction] of transactions.entries()) {
        let id = transaction.txID();
        if (seen.has(id)) {
            const metadata = transaction[V2_APPLICATION_CALL_METADATA];
            if (metadata?.appName !== "PDexV2Math" || metadata.method !== "noop") {
                throw new Error("duplicate_non_carrier_transaction");
            }
            const originalNote = transaction.note;
            let nonce = 0;
            do {
                const suffix = new TextEncoder().encode(`pdex-v2-carrier:${index}:${nonce++}`);
                const note = concat([originalNote, suffix]);
                if (note.length > 1_024)
                    throw new Error("duplicate_carrier_note_too_long");
                transaction.note = note;
                id = transaction.txID();
            } while (reserved.has(id) || seen.has(id));
        }
        seen.add(id);
    }
    // Reusing the very same mutable Transaction object cannot be disambiguated.
    if (new Set(transactions.map((transaction) => transaction.txID())).size !== transactions.length) {
        throw new Error("duplicate_transaction_object");
    }
}
function applyV2LargeProgramReadBudgetToTransactions(transactions, primaryIndex) {
    const roles = new Set();
    for (const transaction of transactions) {
        const metadata = transaction[V2_APPLICATION_CALL_METADATA];
        for (const role of metadata?.largeProgramRoles ?? [])
            roles.add(role);
    }
    const required = [...roles].reduce((total, role) => total + V2_LARGE_PROGRAM_READ_BUDGET_REFS[role], 0);
    const existingEmpty = transactions.reduce((total, transaction) => (total + (transaction.applicationCall?.boxes ?? []).filter((box) => box.name.length === 0).length), 0);
    let missing = Math.max(0, required - existingEmpty);
    if (!missing)
        return;
    const candidates = transactions
        .map((transaction, index) => {
        const call = transaction.applicationCall;
        if (!call)
            return undefined;
        const metadata = transaction[V2_APPLICATION_CALL_METADATA];
        const used = call.foreignApps.length
            + call.foreignAssets.length
            + call.accounts.length
            + call.boxes.length;
        const priority = metadata?.appName === "PDexV2Math" ? 0 : index === primaryIndex ? 2 : 1;
        return { transaction, index, priority, capacity: Math.max(0, 8 - used) };
    })
        .filter((candidate) => Boolean(candidate?.capacity))
        .sort((left, right) => (left.priority - right.priority
        || right.capacity - left.capacity
        || left.index - right.index));
    for (const candidate of candidates) {
        const count = Math.min(missing, candidate.capacity);
        const call = candidate.transaction.applicationCall;
        const boxes = [
            ...call.boxes,
            ...Array.from({ length: count }, () => ({ appIndex: 0n, name: new Uint8Array() })),
        ];
        call.boxes = boxes;
        missing -= count;
        if (!missing)
            return;
    }
    throw new Error("insufficient_large_program_read_budget_capacity");
}
function attachV2TransactionGroupMetadata(transactions, primaryIndex, primaryAppName) {
    if (primaryIndex < 0 || primaryIndex >= transactions.length)
        throw new Error("primary_index_out_of_range");
    const primary = transactions[primaryIndex];
    if (!primary.applicationCall)
        throw new Error("primary_transaction_must_be_application_call");
    Object.defineProperty(transactions, V2_TRANSACTION_GROUP_METADATA, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: {
            primaryIndex,
            primaryAppId: Number(primary.applicationCall.appIndex),
            primaryAppName,
        },
    });
    return transactions;
}
function validateAbiTransactionArguments(transactions) {
    for (const [primaryIndex, transaction] of transactions.entries()) {
        const metadata = transaction[V2_APPLICATION_CALL_METADATA];
        if (!metadata?.argumentNames.length)
            continue;
        if (metadata.argumentNames.length !== metadata.argumentTypes.length) {
            throw new Error(`invalid_abi_transaction_metadata:${metadata.appName}.${metadata.method}`);
        }
        const start = primaryIndex - metadata.argumentTypes.length;
        if (start < 0)
            throw new Error(`missing_abi_transaction_arguments:${metadata.appName}.${metadata.method}`);
        for (const [offset, expectedType] of metadata.argumentTypes.entries()) {
            const actualType = String(transactions[start + offset]?.type ?? "");
            if (!abiTransactionTypeMatches(expectedType, actualType)) {
                throw new Error(`invalid_abi_transaction_argument:${metadata.appName}.${metadata.method}:${metadata.argumentNames[offset]}:${expectedType}:${actualType}`);
            }
        }
    }
}
function abiTransactionTypeMatches(expected, actual) {
    // V2 generic transaction arguments are native or ASA transfers.
    if (expected === "txn")
        return actual === "pay" || actual === "axfer";
    return expected === actual;
}
export function v2TransactionGroupResult(transactions) {
    const metadata = transactions[V2_TRANSACTION_GROUP_METADATA];
    if (!metadata)
        throw new Error("missing_sdk_primary_transaction_metadata");
    const primary = transactions[metadata.primaryIndex];
    if (!primary?.applicationCall || Number(primary.applicationCall.appIndex) !== metadata.primaryAppId) {
        throw new Error("invalid_sdk_primary_transaction_metadata");
    }
    return { transactions, ...metadata };
}
export function prependV2TransactionGroupTransactions(group, prefix) {
    if (!prefix.length)
        return v2TransactionGroupResult(group.transactions);
    return v2TransactionGroupResult(grouped([...prefix, ...group.transactions], prefix.length + group.primaryIndex, group.primaryAppName));
}
export function appendV2TransactionGroupTransactions(group, suffix) {
    if (!suffix.length)
        return v2TransactionGroupResult(group.transactions);
    return v2TransactionGroupResult(grouped([...group.transactions, ...suffix], group.primaryIndex, group.primaryAppName));
}
export function insertV2TransactionGroupTransactions(group, index, insertions) {
    if (!Number.isInteger(index) || index < 0 || index > group.transactions.length) {
        throw new Error("invalid_v2_transaction_group_insertion_index");
    }
    if (!insertions.length)
        return v2TransactionGroupResult(group.transactions);
    return v2TransactionGroupResult(grouped([
        ...group.transactions.slice(0, index),
        ...insertions,
        ...group.transactions.slice(index),
    ], group.primaryIndex + (index <= group.primaryIndex ? insertions.length : 0), group.primaryAppName));
}
function settlementMaintenanceTransactions(call, suggestedParams) {
    return (call.settlementMaintenanceCalls ?? []).map((maintenance) => toApplicationNoOpTxn(maintenance, suggestedParams, { deferLargeProgramReadBudget: true }));
}
function transactionsNotAlreadyPresent(existing, candidates) {
    const seen = new Set(existing.map((txn) => txn.txID().toString()));
    return candidates.filter((txn) => {
        const txId = txn.txID().toString();
        if (seen.has(txId))
            return false;
        seen.add(txId);
        return true;
    });
}
function requireResourceCarrier(call) {
    if (!call.resourceCarrier)
        throw new Error(`${call.method} requires a resource carrier`);
    return call.resourceCarrier;
}
function buildV2OpenOrIncreaseTransactionParts(input, suggestedParams) {
    const appCall = buildV2OpenOrIncreaseCall(input);
    const carrier = requireResourceCarrier(appCall);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    if (input.storagePaymentMicroAlgo !== undefined) {
        const storageInput = input;
        const fundingCall = buildV2FundStorageCall({ ...storageInput, paymentMicroAlgo: storageInput.storagePaymentMicroAlgo });
        const transactions = [
            ...maintenance,
            makePaymentTxnWithSuggestedParamsFromObject({
                sender: addressString(storageInput.sender),
                receiver: getApplicationAddress(storageInput.v2TradingAppId),
                amount: bigint(storageInput.storagePaymentMicroAlgo),
                suggestedParams,
            }),
            toApplicationNoOpTxn(fundingCall, suggestedParams),
            makeTokenTransferTxn(storageInput.sender, getApplicationAddress(storageInput.v2TradingAppId), storageInput.collateralAssetId, storageInput.collateralAmount, suggestedParams),
            toApplicationNoOpTxn(appCall, suggestedParams),
            toApplicationNoOpTxn(carrier, suggestedParams),
            ...(appCall.resourceCarriers ?? []).map((resourceCarrier) => toApplicationNoOpTxn(resourceCarrier, suggestedParams)),
        ];
        return {
            transactions,
            primaryIndex: maintenance.length + 3,
            primaryAppName: appCall.appName,
        };
    }
    const transactions = [
        ...maintenance,
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2TradingAppId), input.collateralAssetId, input.collateralAmount, suggestedParams),
        toApplicationNoOpTxn(appCall, suggestedParams),
        toApplicationNoOpTxn(carrier, suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((resourceCarrier) => toApplicationNoOpTxn(resourceCarrier, suggestedParams)),
    ];
    return {
        transactions,
        primaryIndex: maintenance.length + 1,
        primaryAppName: appCall.appName,
    };
}
function buildV2SingleTokenOpenOrIncreaseTransactionParts(input, suggestedParams) {
    const appCall = buildV2SingleTokenOpenOrIncreaseCall(input);
    const carrier = requireResourceCarrier(appCall);
    const maintenance = settlementMaintenanceTransactions(appCall, suggestedParams);
    const actionCarriers = transactionsNotAlreadyPresent(maintenance, [
        toApplicationNoOpTxn(carrier, suggestedParams),
        ...(appCall.resourceCarriers ?? []).map((resourceCarrier) => toApplicationNoOpTxn(resourceCarrier, suggestedParams)),
    ]);
    if (input.storagePaymentMicroAlgo !== undefined) {
        const storageInput = input;
        const fundingCall = buildV2SingleTokenFundStorageCall({ ...storageInput, paymentMicroAlgo: storageInput.storagePaymentMicroAlgo });
        const transactions = [
            ...maintenance,
            makePaymentTxnWithSuggestedParamsFromObject({
                sender: addressString(storageInput.sender),
                receiver: getApplicationAddress(storageInput.v2SingleTokenTradingAppId),
                amount: bigint(storageInput.storagePaymentMicroAlgo),
                suggestedParams,
            }),
            toApplicationNoOpTxn(fundingCall, suggestedParams),
            makeTokenTransferTxn(storageInput.sender, getApplicationAddress(storageInput.v2SingleTokenTradingAppId), storageInput.backingAssetId, storageInput.collateralAmount, suggestedParams),
            toApplicationNoOpTxn(appCall, suggestedParams),
            ...actionCarriers,
        ];
        return {
            transactions,
            primaryIndex: maintenance.length + 3,
            primaryAppName: appCall.appName,
        };
    }
    const transactions = [
        ...maintenance,
        makeTokenTransferTxn(input.sender, getApplicationAddress(input.v2SingleTokenTradingAppId), input.backingAssetId, input.collateralAmount, suggestedParams),
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...actionCarriers,
    ];
    return {
        transactions,
        primaryIndex: maintenance.length + 1,
        primaryAppName: appCall.appName,
    };
}
function buildV2SubmitLinkedOrderTransactionParts(input, suggestedParams, includeYieldFreshnessCarrier = true, sharedCarrierOrderIds) {
    const orderKind = Number(input.orderKind);
    const requiredStoragePayment = orderKind === V2_ORDER_KIND.OPEN_LIMIT
        ? BigInt(V2_OPEN_ORDER_EXECUTION_STORAGE_ESCROW_MICRO_ALGO)
        : BigInt(V2_ORDER_BOX_MBR_MICRO_ALGO);
    const orderOpsAddress = v2OrderOpsAppAddress(input);
    const appCall = buildV2SubmitLinkedOrderCall(input);
    const carrierOrderIds = sharedCarrierOrderIds ?? [input.ownerOrderId];
    const carriers = carrierOrderIds.length
        ? buildV2LinkedOrderMarketResourceCarrierCalls(input, carrierOrderIds)
        : [];
    return [
        makeTokenTransferTxn(input.sender, orderOpsAddress, input.collateralAssetId, v2OrderEscrowAmount(input), suggestedParams, linkedOrderNote("pdex-v2-linked-escrow", input.ownerOrderId)),
        makePaymentTxnWithSuggestedParamsFromObject({
            sender: addressString(input.sender),
            receiver: orderOpsAddress,
            amount: bigint(input.storagePaymentMicroAlgo ?? requiredStoragePayment),
            suggestedParams,
            note: linkedOrderNote("pdex-v2-linked-storage", input.ownerOrderId),
        }),
        toApplicationNoOpTxn(appCall, suggestedParams),
        ...carriers.map((carrier) => toApplicationNoOpTxn(carrier, suggestedParams)),
        ...(includeYieldFreshnessCarrier
            ? (appCall.resourceCarriers ?? []).map((resourceCarrier) => (toApplicationNoOpTxn(resourceCarrier, suggestedParams)))
            : []),
    ];
}
function appendAttachedOrderLegTransactions(transactions, parent, leg, options) {
    if (!leg)
        return false;
    const entryGroupOffset = options.entryTransactionIndex === undefined
        ? 0
        : transactions.length + 2 - options.entryTransactionIndex;
    if (entryGroupOffset > 15)
        throw new Error("group_too_large");
    transactions.push(...buildV2SubmitLinkedOrderTransactionParts({
        ...v2AttachedChildInput(parent, leg, options),
        ...(options.entryTransactionIndex === undefined ? {} : {
            expectedPositionId: 0n,
            entryGroupOffset,
        }),
    }, options.suggestedParams, 
    // A standalone attachment has no entry-group program-budget carriers.
    transactions.length === 0, options.sharedCarrierOrderIds));
    return true;
}
function v2AttachedOrderIds(parent, baseOrderId) {
    const orderIds = [];
    if (parent.takeProfit) {
        orderIds.push(v2ExpectedLinkedChildOrderId(baseOrderId, V2_ORDER_KIND.DECREASE_TAKE_PROFIT));
    }
    if (parent.stopLoss) {
        orderIds.push(v2ExpectedLinkedChildOrderId(baseOrderId, V2_ORDER_KIND.DECREASE_STOP_LOSS));
    }
    return orderIds;
}
function v2AttachedChildInput(parent, leg, options) {
    const rawParent = parent;
    const collateralAssetId = rawParent.collateralAssetId ?? rawParent.backingAssetId ?? rawParent.longAssetId;
    if (collateralAssetId === undefined || collateralAssetId === null)
        throw new Error("collateralAssetId is required");
    return {
        ...parent,
        ...leg,
        ownerOrderId: v2ExpectedLinkedChildOrderId(options.baseOrderId, options.orderKind),
        orderKind: options.orderKind,
        targetKind: options.targetKind,
        collateralAssetId: collateralAssetId,
        collateralAmount: leg.collateralAmount ?? 0,
        sizeUsdDelta: leg.sizeUsdDelta ?? rawParent.sizeUsdDelta,
        keeperFeeAssetId: leg.keeperFeeAssetId ?? rawParent.keeperFeeAssetId ?? collateralAssetId,
        keeperFeeAmount: leg.keeperFeeAmount ?? rawParent.childKeeperFeeAmount ?? rawParent.keeperFeeAmount ?? 0,
        outputSwapMode: leg.outputSwapMode ?? rawParent.outputSwapMode ?? V2_OUTPUT_SWAP.NONE,
        minPrimaryOutputAmount: leg.minPrimaryOutputAmount ?? rawParent.minPrimaryOutputAmount ?? 0,
        minSecondaryOutputAmount: leg.minSecondaryOutputAmount ?? rawParent.minSecondaryOutputAmount ?? 0,
        timeInForce: leg.timeInForce ?? rawParent.childTimeInForce ?? TIME_IN_FORCE.GTC,
        expiryTime: leg.expiryTime ?? rawParent.childExpiryTime ?? 0,
        linkMode: options.linkMode,
        linkBaseOrderId: options.baseOrderId,
        expectedPositionId: Number(options.linkMode) === V2_ORDER_LINK_MODE.CHILD_WAIT_PARENT ? 0n : parent.expectedPositionId,
        entryGroupOffset: 0,
        oracleMessage: leg.oracleMessage ?? parent.oracleMessage,
        oracleSignature: leg.oracleSignature ?? parent.oracleSignature,
        storagePaymentMicroAlgo: leg.storagePaymentMicroAlgo ?? rawParent.childStoragePaymentMicroAlgo ?? V2_ORDER_BOX_MBR_MICRO_ALGO,
        flatFeeMicroAlgo: leg.flatFeeMicroAlgo,
    };
}
function v2OrderEscrowAmount(input) {
    const orderKind = Number(input.orderKind);
    if (orderKind === V2_ORDER_KIND.OPEN_LIMIT)
        return bigint(input.collateralAmount) + bigint(input.keeperFeeAmount);
    if (orderKind === V2_ORDER_KIND.DECREASE_TAKE_PROFIT || orderKind === V2_ORDER_KIND.DECREASE_STOP_LOSS) {
        return bigint(input.keeperFeeAmount);
    }
    throw new Error("bad V2 order kind");
}
function linkedOrderNote(prefix, ownerOrderId) {
    return new TextEncoder().encode(`${prefix}-${bigint(ownerOrderId).toString()}`);
}
function v2CancelOrderBoxRefs(owner, ownerOrderId, linkedChildren = {}) {
    const refs = [v2OrderBoxKey(owner, ownerOrderId)];
    for (const childId of [linkedChildren.attachedTakeProfitOrderId, linkedChildren.attachedStopLossOrderId]) {
        if (childId === undefined || childId === null)
            continue;
        const normalized = bigint(childId);
        if (normalized <= 0n)
            continue;
        refs.push(v2OrderBoxKey(owner, normalized));
    }
    return uniqueBoxRefs(refs);
}
function buildV2LinkedOrderCancelBudgetCarrier(input) {
    const hasAttachedChild = [input.attachedTakeProfitOrderId, input.attachedStopLossOrderId]
        .some((orderId) => orderId !== undefined && orderId !== null && bigint(orderId) > 0n);
    if (!hasAttachedChild)
        return undefined;
    const mathAppId = Number(input.v2MathAppId ?? 0);
    if (mathAppId <= 0)
        throw new Error("v2MathAppId is required for linked order cancellation budget");
    return buildAppCall({
        appId: mathAppId,
        appName: "PDexV2Math",
        methodName: "noop",
        sender: input.sender,
        args: [],
        flatFeeMicroAlgo: V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO,
        manifest: input.manifest ?? loadManifest(undefined, 2),
    });
}
function uniqueBoxRefs(refs) {
    const result = [];
    const seen = new Set();
    for (const ref of refs) {
        const boxed = boxRef(ref);
        const key = `${Number(boxed.appIndex)}:${bytesToBase64(boxed.name)}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(ref);
    }
    return result;
}
function validateLinkBaseOrderId(baseOrderId) {
    const base = bigint(baseOrderId);
    if (base <= 0n || base > V2_ORDER_LINK_ID_MASK - 2n)
        throw new Error("bad link base");
}
function validateGroupTransactionCount(transactions) {
    if (transactions.length > 16)
        throw new Error("group_too_large");
}
function addressString(value) {
    if (typeof value === "string")
        return value;
    if (value instanceof Uint8Array)
        return encodeAddress(value);
    return String(value);
}
export const V2_ZERO_BUILDER_ADDRESS = encodeAddress(new Uint8Array(32));
export const MAX_POSITION_BUILDER_FEE_BPS = 10n;
export const MAX_SWAP_BUILDER_FEE_BPS = 100n;
export function normalizeBuilderFee(value, maxFeeBps = MAX_POSITION_BUILDER_FEE_BPS) {
    const feeBps = value === undefined ? 0n : strictBigInt(value.builderFeeBps, "builderFeeBps");
    const builderAddress = value === undefined
        ? V2_ZERO_BUILDER_ADDRESS
        : encodeAddress(accountBytes(value.builderAddress));
    if (feeBps < 0n)
        throw new Error("builder fee bps must be non-negative");
    if (feeBps > strictBigInt(maxFeeBps, "maxFeeBps")) {
        throw new Error("builder fee bps exceeds action cap");
    }
    if ((builderAddress === V2_ZERO_BUILDER_ADDRESS) !== (feeBps === 0n)) {
        throw new Error("builder address/rate mismatch");
    }
    return [builderAddress, feeBps];
}
function builderFeeAmount(amount, feeBps) {
    const base = strictBigInt(amount, "builder fee base");
    if (base < 0n)
        throw new Error("builder fee base must be non-negative");
    return base * feeBps / 10000n;
}
function strictBigInt(value, name) {
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number" && Number.isSafeInteger(value))
        return BigInt(value);
    if (typeof value === "string" && /^-?\d+$/.test(value))
        return BigInt(value);
    throw new Error(`${name} must be an exact integer`);
}
function bigint(value) {
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number")
        return BigInt(value);
    if (typeof value === "string")
        return BigInt(value);
    throw new Error(`cannot convert value to bigint: ${String(value)}`);
}
function bytes(value) {
    if (value instanceof Uint8Array)
        return value;
    if (Array.isArray(value))
        return new Uint8Array(value);
    if (/^[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0)
        return hexToBytes(value);
    return base64ToBytes(value);
}
function hexToBytes(value) {
    const out = new Uint8Array(value.length / 2);
    for (let index = 0; index < out.length; index += 1) {
        out[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    }
    return out;
}
function bytesToBase64(value) {
    const maybeBuffer = globalThis.Buffer;
    if (maybeBuffer)
        return maybeBuffer.from(value).toString("base64");
    let binary = "";
    for (const byte of value)
        binary += String.fromCharCode(byte);
    return btoa(binary);
}
function base64ToBytes(value) {
    const maybeBuffer = globalThis.Buffer;
    if (maybeBuffer)
        return new Uint8Array(maybeBuffer.from(value, "base64"));
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
        out[index] = binary.charCodeAt(index);
    return out;
}
//# sourceMappingURL=transactions.js.map