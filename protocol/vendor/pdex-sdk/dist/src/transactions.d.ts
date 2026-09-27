import { type BoxReference, type SuggestedParams, type Transaction } from "algosdk";
import { type ProtocolManifest } from "./manifest.js";
import { type AddressLike } from "./boxes.js";
import { type BigNumberish, type BytesLike } from "./constants.js";
export { UNCHECKED_CLOSE_POSITION_ID, HEAVY_METHOD_EXTRA_FEE_MICRO_ALGO, HEAVY_METHOD_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_FINALIZATION_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_HOT_CHECK_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_MARK_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_REFRESH_ROUTER_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_RECALL_PDEX_BASE_FLAT_FEE_MICRO_ALGO, MARKET_YIELD_ACTION_RECALL_FLAT_FEE_MICRO_ALGO, NATIVE_ALGO_ASSET_ID, SIDE, TIME_IN_FORCE, V2_ADMIN_OPS_METHOD_FLAT_FEE_MICRO_ALGO, V2_DECREASE_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_DECREASE_OR_CLOSE_METHOD_FLAT_FEE_MICRO_ALGO, V2_FUNDING_BORROWING_METHOD_FLAT_FEE_MICRO_ALGO, V2_CVA_MARKET_BOX_MBR_MICRO_ALGO, V2_CVA_MARKET_WITHDRAW_METHOD_FLAT_FEE_MICRO_ALGO, V2_CVA_METHOD_FLAT_FEE_MICRO_ALGO, V2_CVA_USER_BOX_MBR_MICRO_ALGO, V2_LIQUIDATION_METHOD_FLAT_FEE_MICRO_ALGO, V2_LP_BOX_MBR_MICRO_ALGO, V2_MARKET_BASE_BOX_MBR_MICRO_ALGO, V2_MARKETS_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO, V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO, V2_OPEN_ORDER_EXECUTION_STORAGE_ESCROW_MICRO_ALGO, V2_ORDER_BOX_MBR_MICRO_ALGO, V2_ORDER_BAD_PRICE_REASON, V2_ORDER_KIND, V2_ORDER_LINK_ID_MASK, V2_ORDER_LINK_MODE, V2_ORDER_LINK_MODE_FACTOR, V2_ORDER_OPS_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_DECREASE_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_INLINE_EXECUTION_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_OPS_METHOD_FLAT_FEE_MICRO_ALGO, V2_ORDER_TARGET, V2_OUTPUT_SWAP, V2_POSITION_BOX_MBR_MICRO_ALGO, V2_ROUTE_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_SINGLE_TOKEN_DECREASE_METHOD_FLAT_FEE_MICRO_ALGO, V2_SINGLE_TOKEN_INLINE_RECALL_METHOD_FLAT_FEE_MICRO_ALGO, V2_SWAP_EXACT_IN_METHOD_FLAT_FEE_MICRO_ALGO, V2_TRADER_BOX_MBR_MICRO_ALGO, V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO, V2_WITHDRAW_LIQUIDITY_METHOD_FLAT_FEE_MICRO_ALGO, V2_WITHDRAW_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO, V2_YIELD_MAX_EXTERNAL_PROTOCOL_FEE_MICRO_ALGO, V2_YIELD_PDEX_BASE_FLAT_FEE_MICRO_ALGO, XALGO_RESOURCE_ACCOUNT_LIMIT, } from "./constants.js";
export type { BigNumberish, BytesLike } from "./constants.js";
export interface PdexV2AppRefs {
    v2MarketsAppId: number;
    v2AdminControlAppId?: number;
    v2AdminAppId?: number;
    v2AdminOpsAppId?: number;
    v2TradingAppId: number;
    v2TradingRiskOpsAppId?: number;
    v2MarketXalgoYieldVaultAppId?: number;
    v2MathAppId?: number;
    manifest?: ProtocolManifest;
}
export interface PdexV2SingleTokenOpsRefs {
    v2MarketsAppId: number;
    v2AdminControlAppId?: number;
    v2AdminAppId?: number;
    v2MathAppId?: number;
    v2SingleTokenOpsAppId: number;
    manifest?: ProtocolManifest;
}
export interface PdexV2SingleTokenTradingRefs {
    v2MarketsAppId: number;
    v2AdminControlAppId?: number;
    v2AdminAppId?: number;
    v2SingleTokenTradingAppId: number;
    v2TradingRiskOpsAppId?: number;
    v2MarketXalgoYieldVaultAppId?: number;
    v2MathAppId?: number;
    manifest?: ProtocolManifest;
}
export interface PdexV2CvaVaultRefs {
    v2CvaVaultAppId?: number;
    cvaVaultAppId?: number;
    v2AdminControlAppId?: number;
    v2AdminAppId?: number;
    appId?: number;
    v2MarketsAppId: number;
    v2MathAppId?: number;
    manifest?: ProtocolManifest;
}
export interface V2MarketAssetRefs {
    indexAssetId: BigNumberish;
    longAssetId: BigNumberish;
    shortAssetId: BigNumberish;
}
export interface V2CvaAssetRefs {
    indexAssetId?: BigNumberish;
    longAssetId: BigNumberish;
    shortAssetId: BigNumberish;
}
export interface V2CvaActiveMarketRefs {
    activeMarketIds?: BigNumberish[];
    active_market_ids?: BigNumberish[];
    activeAllocationMarketIds?: BigNumberish[];
    active_allocation_market_ids?: BigNumberish[];
    activeMarket0?: BigNumberish;
    activeMarket1?: BigNumberish;
    activeMarket2?: BigNumberish;
    activeMarket3?: BigNumberish;
    active_market_0?: BigNumberish;
    active_market_1?: BigNumberish;
    active_market_2?: BigNumberish;
    active_market_3?: BigNumberish;
}
export interface V2CvaActiveMarkOraclePayload extends Partial<OracleCallArgs>, Partial<V2CvaAssetRefs> {
    marketId?: BigNumberish;
    market_id?: BigNumberish;
    appId?: BigNumberish;
    app_id?: BigNumberish;
    index_asset_id?: BigNumberish;
    long_asset_id?: BigNumberish;
    short_asset_id?: BigNumberish;
    message?: BytesLike;
    message_hex?: string;
    signature?: BytesLike;
    signature_hex?: string;
}
export type V2SettlementMaintenanceOracleMap = Record<string, V2CvaActiveMarkOraclePayload> | {
    payloads?: Record<string, V2CvaActiveMarkOraclePayload>;
};
export interface V2SettlementMaintenanceOracleRefs {
    v2SingleTokenOpsAppId?: number;
    settlementMaintenanceOracles?: V2SettlementMaintenanceOracleMap;
    settlement_maintenance_oracles?: V2SettlementMaintenanceOracleMap;
    maintenanceOracles?: V2SettlementMaintenanceOracleMap;
    maintenance_oracles?: V2SettlementMaintenanceOracleMap;
    oraclePayloads?: V2SettlementMaintenanceOracleMap;
    oracle_payloads?: V2SettlementMaintenanceOracleMap;
    oraclePayload?: V2SettlementMaintenanceOracleMap;
    oracle_payload?: V2SettlementMaintenanceOracleMap;
    adminOpsOracleMessage?: BytesLike;
    adminOpsOracleSignature?: BytesLike;
    admin_ops_oracle_message?: BytesLike;
    admin_ops_oracle_signature?: BytesLike;
    singleTokenOpsOracleMessage?: BytesLike;
    singleTokenOpsOracleSignature?: BytesLike;
    single_token_ops_oracle_message?: BytesLike;
    single_token_ops_oracle_signature?: BytesLike;
    settlementMaintenanceOracleMessage?: BytesLike;
    settlementMaintenanceOracleSignature?: BytesLike;
    settlement_maintenance_oracle_message?: BytesLike;
    settlement_maintenance_oracle_signature?: BytesLike;
    maintenanceOracleMessage?: BytesLike;
    maintenanceOracleSignature?: BytesLike;
    maintenance_oracle_message?: BytesLike;
    maintenance_oracle_signature?: BytesLike;
    settlementMaintenance?: boolean;
    settlement_maintenance?: boolean;
    settlementMaintenanceDue?: boolean;
    settlement_maintenance_due?: boolean;
    settlementMaintenanceState?: Record<string, unknown>;
    settlement_maintenance_state?: Record<string, unknown>;
}
export interface V2CvaActiveMarkOracleRefs {
    activeMarketOracles?: Record<string, V2CvaActiveMarkOraclePayload> | V2CvaActiveMarkOraclePayload[];
    active_market_oracles?: Record<string, V2CvaActiveMarkOraclePayload> | V2CvaActiveMarkOraclePayload[];
    activeMarkOracles?: Record<string, V2CvaActiveMarkOraclePayload> | V2CvaActiveMarkOraclePayload[];
    active_mark_oracles?: Record<string, V2CvaActiveMarkOraclePayload> | V2CvaActiveMarkOraclePayload[];
}
export interface OracleCallArgs {
    oracleMessage: BytesLike;
    oracleSignature: BytesLike;
}
export interface SenderInput {
    sender: AddressLike;
}
export interface MarketPoolInput {
    marketId: BigNumberish;
    poolId: BigNumberish;
}
export interface PositionSideInput {
    side: BigNumberish;
}
export interface BuilderFeeInput {
    /** Account that receives the user-authorized additional fee. */
    builderAddress: AddressLike;
    /** Fee rate in basis points of the action-specific fee base. */
    builderFeeBps: BigNumberish;
}
export interface AppCallDescriptor {
    type: "appl";
    appId: number;
    appName: string;
    method: string;
    sender: string;
    appArgs: Uint8Array[];
    appArgsB64: string[];
    boxes: BoxReference[];
    boxesB64: string[];
    foreignApps: number[];
    foreignAssets: number[];
    accounts: string[];
    flatFeeMicroAlgo?: bigint;
    prerequisiteCalls?: AppCallDescriptor[];
    resourceCarrier?: AppCallDescriptor;
    resourceCarriers?: AppCallDescriptor[];
    settlementMaintenanceCalls?: AppCallDescriptor[];
    activeMarkCalls?: AppCallDescriptor[];
    abiTransactionArgs?: string[];
    abiTransactionArgTypes?: string[];
    largeProgramRoles?: V2LargeProgramRole[];
}
export type V2LargeProgramRole = "markets" | "cva_vault" | "trading" | "single_token_trading" | "order_ops";
export declare const V2_LARGE_PROGRAM_READ_BUDGET_REFS: Readonly<Record<V2LargeProgramRole, number>>;
export interface V2TransactionGroupResult {
    transactions: Transaction[];
    primaryIndex: number;
    primaryAppId: number;
    primaryAppName: string;
}
export interface PaymentDescriptor {
    type: "pay";
    sender: string;
    receiver: string;
    amount: bigint;
    purpose?: string;
    flatFeeMicroAlgo?: bigint;
}
export interface V2FundStorageGroupInput extends PdexV2AppRefs, SenderInput {
    paymentMicroAlgo: BigNumberish;
}
export interface V2DepositLiquidityGroupInput extends PdexV2AppRefs, SenderInput, V2MarketAssetRefs, OracleCallArgs {
    v2AdminAppId?: number;
    v2AdminOpsAppId?: number;
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    longAmount: BigNumberish;
    shortAmount: BigNumberish;
    storagePaymentMicroAlgo: BigNumberish;
    minMarketShares: BigNumberish;
}
export interface V2WithdrawLiquidityInput extends PdexV2AppRefs, SenderInput, V2MarketAssetRefs, OracleCallArgs {
    v2AdminAppId?: number;
    v2AdminOpsAppId?: number;
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    shareAmount: BigNumberish;
    minLongAmount: BigNumberish;
    minShortAmount: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxLongReceiptAmount?: BigNumberish;
    maxShortReceiptAmount?: BigNumberish;
}
export interface V2WithdrawLiquidityWithSwapInput extends PdexV2AppRefs, SenderInput, V2MarketAssetRefs, OracleCallArgs {
    v2AdminAppId?: number;
    v2AdminOpsAppId?: number;
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    shareAmount: BigNumberish;
    outputMode?: BigNumberish;
    outputTokenAssetId?: BigNumberish;
    minPrimaryAmount?: BigNumberish;
    minOutputAmount?: BigNumberish;
    minSecondaryAmount?: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxLongReceiptAmount?: BigNumberish;
    maxShortReceiptAmount?: BigNumberish;
}
export interface V2SwapExactInInput extends PdexV2AppRefs, SenderInput, V2MarketAssetRefs, OracleCallArgs {
    v2AdminAppId?: number;
    v2AdminOpsAppId?: number;
    v2SwapOpsAppId?: number;
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    tokenInAssetId: BigNumberish;
    amountIn: BigNumberish;
    minAmountOut: BigNumberish;
    receiver?: AddressLike;
    yieldRecallMode?: BigNumberish;
    maxOutputReceiptAmount?: BigNumberish;
    builderFee?: BuilderFeeInput;
}
export interface V2SwapRouteHopInput extends V2MarketAssetRefs, Partial<OracleCallArgs> {
    marketId: BigNumberish;
    market_id?: BigNumberish;
    tokenInAssetId?: BigNumberish;
    token_in_asset_id?: BigNumberish;
}
export interface V2SwapRouteExactInInput extends PdexV2AppRefs, SenderInput {
    v2AdminAppId?: number;
    v2AdminOpsAppId?: number;
    v2SwapOpsAppId?: number;
    tokenInAssetId: BigNumberish;
    amountIn: BigNumberish;
    minFinalAmountOut: BigNumberish;
    receiver?: AddressLike;
    hops: V2SwapRouteHopInput[];
    oracleMessage?: BytesLike;
    oracleSignature?: BytesLike;
    marketYieldRegistry?: Record<string, unknown>;
    yieldRecallMode?: BigNumberish;
    maxOutputReceiptAmount?: BigNumberish;
    maxOutputReceiptAmount0?: BigNumberish;
    maxOutputReceiptAmount1?: BigNumberish;
    builderFee?: BuilderFeeInput;
}
export interface V2OpenOrIncreaseGroupInput extends PdexV2AppRefs, SenderInput, V2MarketAssetRefs, PositionSideInput, OracleCallArgs, V2SettlementMaintenanceOracleRefs {
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    collateralAssetId: BigNumberish;
    collateralAmount: BigNumberish;
    sizeUsdDelta: BigNumberish;
    acceptablePrice: BigNumberish;
    builderFee?: BuilderFeeInput;
}
export interface V2OpenOrIncreaseWithStorageGroupInput extends V2OpenOrIncreaseGroupInput {
    storagePaymentMicroAlgo: BigNumberish;
}
export interface V2AddPositionMarginInput extends Omit<V2OpenOrIncreaseGroupInput, "sizeUsdDelta"> {
    collateralAmount: BigNumberish;
}
export interface V2DecreaseOrCloseInput extends PdexV2AppRefs, SenderInput, V2MarketAssetRefs, PositionSideInput, OracleCallArgs, V2SettlementMaintenanceOracleRefs {
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    collateralAssetId: BigNumberish;
    sizeUsdDelta: BigNumberish;
    acceptablePrice: BigNumberish;
    minPrimaryOutput: BigNumberish;
    outputSwapMode?: BigNumberish;
    minPrimaryOutputAmount?: BigNumberish;
    minSecondaryOutputAmount?: BigNumberish;
    minSecondaryOutput?: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxLongReceiptAmount?: BigNumberish;
    maxShortReceiptAmount?: BigNumberish;
    marketYieldRecallCount?: BigNumberish;
    flatFeeMicroAlgo?: BigNumberish;
    builderFee?: BuilderFeeInput;
    /** Current position ID (including verified zero), or explicit UNCHECKED_CLOSE_POSITION_ID. */
    expectedPositionId: BigNumberish;
}
export interface V2DecreaseOrCloseWithSwapInput extends Omit<V2DecreaseOrCloseInput, "minPrimaryOutput"> {
    outputSwapMode?: BigNumberish;
    minPrimaryOutputAmount?: BigNumberish;
    minPrimaryOutput?: BigNumberish;
    minSecondaryOutputAmount?: BigNumberish;
    minSecondaryOutput?: BigNumberish;
}
export interface V2WithdrawPositionMarginInput extends Omit<V2DecreaseOrCloseInput, "sizeUsdDelta" | "minPrimaryOutput" | "outputSwapMode" | "minPrimaryOutputAmount" | "minPrimaryOutput" | "minSecondaryOutputAmount" | "minSecondaryOutput"> {
    collateralAmount: BigNumberish;
}
export interface V2LiquidationInput extends PdexV2AppRefs, SenderInput, V2MarketAssetRefs, PositionSideInput, OracleCallArgs, V2SettlementMaintenanceOracleRefs {
    marketYieldRegistry?: Record<string, unknown>;
    target: AddressLike;
    marketId: BigNumberish;
    collateralAssetId: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxLongReceiptAmount?: BigNumberish;
    maxShortReceiptAmount?: BigNumberish;
    marketYieldRecallCount?: BigNumberish;
}
export interface PdexV2OrderOpsRefs extends PdexV2AppRefs {
    v2OrderOpsAppId?: number;
    orderOpsAppId?: number;
    v2OrderOpsAppAddress?: AddressLike;
    orderOpsAppAddress?: AddressLike;
    v2SingleTokenOpsAppId?: number;
    v2SingleTokenTradingAppId?: number;
}
export interface V2SubmitOrderInput extends PdexV2OrderOpsRefs, SenderInput, PositionSideInput, OracleCallArgs {
    /** Required for protection on an existing position, including verified legacy ID zero. */
    expectedPositionId?: BigNumberish;
    /** Distance back from this submission to its entry app call in the same group. */
    entryGroupOffset?: BigNumberish;
    marketYieldRegistry?: Record<string, unknown>;
    backingAssetId?: BigNumberish;
    longAssetId?: BigNumberish;
    shortAssetId?: BigNumberish;
    ownerOrderId: BigNumberish;
    orderKind: BigNumberish;
    targetKind: BigNumberish;
    marketId: BigNumberish;
    collateralAssetId: BigNumberish;
    collateralAmount: BigNumberish;
    sizeUsdDelta: BigNumberish;
    triggerPrice: BigNumberish;
    acceptablePrice: BigNumberish;
    keeperFeeAssetId: BigNumberish;
    keeperFeeAmount: BigNumberish;
    outputSwapMode?: BigNumberish;
    minPrimaryOutputAmount?: BigNumberish;
    minSecondaryOutputAmount?: BigNumberish;
    timeInForce: BigNumberish;
    expiryTime?: BigNumberish;
    storagePaymentMicroAlgo?: BigNumberish;
    flatFeeMicroAlgo?: BigNumberish;
    indexAssetId?: BigNumberish;
    builderFee?: BuilderFeeInput;
}
export interface V2SubmitLinkedOrderInput extends V2SubmitOrderInput {
    linkMode: BigNumberish;
    linkBaseOrderId: BigNumberish;
}
export interface V2AttachedOrderLegInput {
    triggerPrice: BigNumberish;
    acceptablePrice: BigNumberish;
    sizeUsdDelta?: BigNumberish;
    collateralAmount?: BigNumberish;
    keeperFeeAssetId?: BigNumberish;
    keeperFeeAmount?: BigNumberish;
    outputSwapMode?: BigNumberish;
    minPrimaryOutputAmount?: BigNumberish;
    minSecondaryOutputAmount?: BigNumberish;
    timeInForce?: BigNumberish;
    expiryTime?: BigNumberish;
    oracleMessage?: BytesLike;
    oracleSignature?: BytesLike;
    storagePaymentMicroAlgo?: BigNumberish;
    flatFeeMicroAlgo?: BigNumberish;
    builderFee?: BuilderFeeInput;
}
export interface V2MarketOpenWithAttachedOrdersInput extends V2OpenOrIncreaseGroupInput, PdexV2OrderOpsRefs {
    /** Required by the active-only attachment builder; entry builders bind their actual result. */
    expectedPositionId?: BigNumberish;
    baseOrderId: BigNumberish;
    targetKind?: BigNumberish;
    backingAssetId?: BigNumberish;
    storagePaymentMicroAlgo?: BigNumberish;
    childKeeperFeeAmount?: BigNumberish;
    childTimeInForce?: BigNumberish;
    childExpiryTime?: BigNumberish;
    childStoragePaymentMicroAlgo?: BigNumberish;
    takeProfit?: V2AttachedOrderLegInput;
    stopLoss?: V2AttachedOrderLegInput;
}
export interface V2OpenLimitWithAttachedOrdersInput extends V2SubmitOrderInput {
    baseOrderId?: BigNumberish;
    childKeeperFeeAmount?: BigNumberish;
    childTimeInForce?: BigNumberish;
    childExpiryTime?: BigNumberish;
    childStoragePaymentMicroAlgo?: BigNumberish;
    takeProfit?: V2AttachedOrderLegInput;
    stopLoss?: V2AttachedOrderLegInput;
}
export interface V2ExecuteOrderInput extends PdexV2OrderOpsRefs, SenderInput, PositionSideInput, OracleCallArgs, V2SettlementMaintenanceOracleRefs {
    /** Preparation only. The contract independently verifies eligibility and never trusts this hint. */
    cleanup?: "orphan" | "legacy";
    /** Stored order schema; V3 children become active once their parent is absent. */
    schemaVersion?: number;
    keeperFeeAssetId?: BigNumberish;
    owner: AddressLike;
    ownerOrderId: BigNumberish;
    orderKind?: BigNumberish;
    linkMode?: BigNumberish;
    linkBaseOrderId?: BigNumberish;
    sizeUsdDelta?: BigNumberish;
    targetTradingAppId: number;
    marketId: BigNumberish;
    collateralAssetId: BigNumberish;
    longAssetId?: BigNumberish;
    shortAssetId?: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxLongReceiptAmount?: BigNumberish;
    maxShortReceiptAmount?: BigNumberish;
    maxBackingReceiptAmount?: BigNumberish;
    marketYieldRegistry?: Record<string, unknown>;
    marketYieldRecallCount?: BigNumberish;
    indexAssetId?: BigNumberish;
    flatFeeMicroAlgo?: BigNumberish;
    builderFee?: BuilderFeeInput;
}
export interface V2CancelOrderInput extends PdexV2OrderOpsRefs, SenderInput {
    ownerOrderId: BigNumberish;
    attachedTakeProfitOrderId?: BigNumberish;
    attachedStopLossOrderId?: BigNumberish;
    collateralAssetId?: BigNumberish;
    keeperFeeAssetId?: BigNumberish;
}
export interface V2CancelExpiredOrderInput extends PdexV2OrderOpsRefs, SenderInput {
    owner: AddressLike;
    ownerOrderId: BigNumberish;
    attachedTakeProfitOrderId?: BigNumberish;
    attachedStopLossOrderId?: BigNumberish;
    keeperFeeAssetId?: BigNumberish;
}
export interface V2CvaMarketOracleInput extends PdexV2CvaVaultRefs, SenderInput, V2CvaAssetRefs, V2CvaActiveMarketRefs, V2CvaActiveMarkOracleRefs, OracleCallArgs {
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
}
export interface V2CvaDepositInput extends PdexV2CvaVaultRefs, SenderInput, V2CvaAssetRefs, V2CvaActiveMarketRefs, V2CvaActiveMarkOracleRefs, OracleCallArgs {
    longAmount: BigNumberish;
    shortAmount: BigNumberish;
    storagePaymentMicroAlgo?: BigNumberish;
    minCvaShares?: BigNumberish;
}
export interface V2CvaWithdrawInput extends PdexV2CvaVaultRefs, SenderInput, V2MarketAssetRefs, V2CvaActiveMarketRefs, V2CvaActiveMarkOracleRefs, OracleCallArgs {
    shareAmount: BigNumberish;
    minLongAmount?: BigNumberish;
    minShortAmount?: BigNumberish;
}
export interface V2CvaWithdrawFromMarketInput extends V2CvaMarketOracleInput {
    shareAmount: BigNumberish;
    minLongAmount?: BigNumberish;
    minShortAmount?: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxLongReceiptAmount?: BigNumberish;
    maxShortReceiptAmount?: BigNumberish;
    marketYieldRegistry?: Record<string, unknown>;
    marketYieldRecallCount?: BigNumberish;
}
export interface PdexV2MarketYieldVaultRefs {
    v2MarketYieldVaultAppId?: number;
    marketYieldVaultAppId?: number;
    marketFolksYieldVaultAppId?: number;
    appId?: number;
    marketsAppId: number;
    v2AdminControlAppId?: number;
    v2AdminAppId?: number;
    v2MathAppId?: number;
    manifest?: ProtocolManifest;
}
export interface V2MarketYieldVaultFolksRefs extends PdexV2MarketYieldVaultRefs {
    folksPoolAppId: number;
    folksPoolManagerAppId: number;
    updateFolksPoolInterestIndexes?: boolean;
}
export interface PdexV2MarketXalgoYieldVaultRefs {
    v2MarketXalgoYieldVaultAppId?: number;
    marketXalgoYieldVaultAppId?: number;
    marketYieldVaultAppId?: number;
    appId?: number;
    marketsAppId: number;
    v2AdminControlAppId?: number;
    v2AdminAppId?: number;
    v2MathAppId?: number;
    manifest?: ProtocolManifest;
}
export interface V2MarketXalgoYieldVaultRefs extends PdexV2MarketXalgoYieldVaultRefs {
    v2MathAppId?: number;
    xalgoConsensusAppId: number;
    xalgoAssetId: number;
    proposerAddresses: AddressLike[];
    marketXalgoVaultAppAddress?: AddressLike;
}
export interface V2SingleTokenDepositLiquidityInput extends PdexV2SingleTokenOpsRefs, SenderInput, OracleCallArgs {
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    backingAssetId: BigNumberish;
    backingAmount: BigNumberish;
    storagePaymentMicroAlgo: BigNumberish;
    minMarketShares?: BigNumberish;
}
export interface V2SingleTokenWithdrawLiquidityInput extends PdexV2SingleTokenOpsRefs, SenderInput, OracleCallArgs {
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    backingAssetId: BigNumberish;
    shareAmount: BigNumberish;
    minBackingAmount: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxBackingReceiptAmount?: BigNumberish;
    marketYieldRecallCount?: BigNumberish;
}
export interface V2SingleTokenMaintenanceInput extends PdexV2SingleTokenOpsRefs, SenderInput, OracleCallArgs {
    marketId: BigNumberish;
    indexAssetId?: BigNumberish;
    backingAssetId: BigNumberish;
    periods?: BigNumberish;
}
export interface V2SingleTokenFundStorageInput extends PdexV2SingleTokenTradingRefs, SenderInput {
    paymentMicroAlgo: BigNumberish;
}
export interface V2SingleTokenOpenOrIncreaseInput extends PdexV2SingleTokenTradingRefs, SenderInput, PositionSideInput, OracleCallArgs, V2SettlementMaintenanceOracleRefs {
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    indexAssetId?: BigNumberish;
    backingAssetId: BigNumberish;
    collateralAmount: BigNumberish;
    sizeUsdDelta: BigNumberish;
    acceptablePrice: BigNumberish;
}
export interface V2SingleTokenOpenOrIncreaseWithStorageInput extends V2SingleTokenOpenOrIncreaseInput {
    storagePaymentMicroAlgo: BigNumberish;
}
export interface V2SingleTokenAddPositionMarginInput extends Omit<V2SingleTokenOpenOrIncreaseInput, "sizeUsdDelta"> {
    collateralAmount: BigNumberish;
}
export interface V2SingleTokenDecreaseOrCloseInput extends PdexV2SingleTokenTradingRefs, SenderInput, PositionSideInput, OracleCallArgs, V2SettlementMaintenanceOracleRefs {
    marketYieldRegistry?: Record<string, unknown>;
    marketId: BigNumberish;
    indexAssetId?: BigNumberish;
    backingAssetId: BigNumberish;
    sizeUsdDelta: BigNumberish;
    acceptablePrice: BigNumberish;
    minPrimaryOutput: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxBackingReceiptAmount?: BigNumberish;
    marketYieldRecallCount?: BigNumberish;
    flatFeeMicroAlgo?: BigNumberish;
    /** Current position ID (including verified zero), or explicit UNCHECKED_CLOSE_POSITION_ID. */
    expectedPositionId: BigNumberish;
}
export interface V2SingleTokenWithdrawPositionMarginInput extends Omit<V2SingleTokenDecreaseOrCloseInput, "sizeUsdDelta" | "minPrimaryOutput"> {
    collateralAmount: BigNumberish;
}
export interface V2SingleTokenLiquidationInput extends PdexV2SingleTokenTradingRefs, SenderInput, PositionSideInput, OracleCallArgs, V2SettlementMaintenanceOracleRefs {
    marketYieldRegistry?: Record<string, unknown>;
    target: AddressLike;
    marketId: BigNumberish;
    indexAssetId?: BigNumberish;
    backingAssetId: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxBackingReceiptAmount?: BigNumberish;
    marketYieldRecallCount?: BigNumberish;
}
export declare function v2OrderPriceCoherenceFailure(input: {
    orderKind: BigNumberish;
    side: BigNumberish;
    triggerPrice: BigNumberish;
    acceptablePrice: BigNumberish;
}): string | undefined;
export declare function assertV2OrderPriceCoherent(input: {
    orderKind: BigNumberish;
    side: BigNumberish;
    triggerPrice: BigNumberish;
    acceptablePrice: BigNumberish;
}): void;
export declare function buildV2WithdrawLiquidityCall(input: V2WithdrawLiquidityInput): AppCallDescriptor;
export declare function buildV2WithdrawLiquidityWithSwapCall(input: V2WithdrawLiquidityWithSwapInput): AppCallDescriptor;
export declare function buildV2SwapExactInCall(input: V2SwapExactInInput): AppCallDescriptor;
export declare function buildV2SwapRouteExactInCall(input: V2SwapRouteExactInInput): AppCallDescriptor;
export declare function buildV2FundStorageCall(input: V2FundStorageGroupInput): AppCallDescriptor;
export declare function buildV2OpenOrIncreaseCall(input: V2OpenOrIncreaseGroupInput): AppCallDescriptor;
export declare function buildV2AddPositionMarginCall(input: V2AddPositionMarginInput): AppCallDescriptor;
export declare function buildV2DecreaseOrCloseCall(input: V2DecreaseOrCloseInput): AppCallDescriptor;
/** Prepare every possible pair-close payout asset before building or signing.
 * The contract decides whether a provider withdrawal is needed at execution.
 */
export declare function prepareV2DecreaseOrCloseInput(client: import("./marketYield.js").MarketYieldActionRecallClient, input: V2DecreaseOrCloseInput, outputs?: import("./marketYield.js").PrepareV2ActionRecallInput["outputs"]): Promise<V2DecreaseOrCloseInput>;
export declare function prepareV2DecreaseOrCloseTransactions(client: import("./marketYield.js").MarketYieldActionRecallClient, input: V2DecreaseOrCloseInput, suggestedParams: SuggestedParams, outputs?: import("./marketYield.js").PrepareV2ActionRecallInput["outputs"]): Promise<Transaction[]>;
export declare function buildV2WithdrawPositionMarginCall(input: V2WithdrawPositionMarginInput): AppCallDescriptor;
export declare function buildV2DecreaseOrCloseWithSwapCall(input: V2DecreaseOrCloseWithSwapInput): AppCallDescriptor;
export declare function buildV2LiquidateCall(input: V2LiquidationInput): AppCallDescriptor;
export declare function v2OrderLinkMode(flags: BigNumberish): number;
export declare function v2OrderLinkBase(flags: BigNumberish): bigint;
export declare function v2PackOrderLink(mode: BigNumberish, baseOrderId: BigNumberish): bigint;
export declare function v2ExpectedLinkedChildOrderId(baseOrderId: BigNumberish, orderKind: BigNumberish): bigint;
export declare function v2SiblingLinkedChildOrderId(baseOrderId: BigNumberish, orderKind: BigNumberish): bigint;
export declare function v2OrderSubmitBoxRefs(input: {
    owner: AddressLike;
    ownerOrderId: BigNumberish;
    orderKind?: BigNumberish;
    targetKind: BigNumberish;
    targetTradingAppId: number;
    v2MarketsAppId: number;
    v2TradingRiskOpsAppId?: number;
    marketId: BigNumberish;
    collateralAssetId: BigNumberish;
    side: BigNumberish;
    indexAssetId?: BigNumberish;
}): Array<Uint8Array | [number, Uint8Array]>;
export declare function v2LinkedOrderSubmitBoxRefs(input: {
    owner: AddressLike;
    ownerOrderId: BigNumberish;
    orderKind: BigNumberish;
    targetKind: BigNumberish;
    targetTradingAppId: number;
    v2MarketsAppId: number;
    v2TradingRiskOpsAppId?: number;
    marketId: BigNumberish;
    collateralAssetId: BigNumberish;
    side: BigNumberish;
    indexAssetId?: BigNumberish;
    linkMode: BigNumberish;
    linkBaseOrderId: BigNumberish;
}): Array<Uint8Array | [number, Uint8Array]>;
export declare function buildV2SubmitOrderCall(input: V2SubmitOrderInput): AppCallDescriptor;
export declare function buildV2SubmitLinkedOrderCall(input: V2SubmitLinkedOrderInput): AppCallDescriptor;
export declare function buildV2ExecuteOrderCall(input: V2ExecuteOrderInput): AppCallDescriptor;
export declare function buildV2CancelOrderCall(input: V2CancelOrderInput): AppCallDescriptor;
export declare function buildV2CancelExpiredOrderCall(input: V2CancelExpiredOrderInput): AppCallDescriptor;
export declare function v2SettlementMaintenanceDue(input: V2SettlementMaintenanceOracleRefs & {
    oracleMessage?: BytesLike;
}): boolean | undefined;
export declare function v2OrderExecutionFlatFeeMicroAlgo(orderKind: BigNumberish): number;
export declare function buildV2CvaDepositCall(input: V2CvaDepositInput): AppCallDescriptor;
export declare function buildV2CvaWithdrawCall(input: V2CvaWithdrawInput): AppCallDescriptor;
export declare function buildV2CvaWithdrawFromMarketCall(input: V2CvaWithdrawFromMarketInput): AppCallDescriptor;
export declare function v2MarketYieldStrategyBoxRefs(marketId: BigNumberish, assetId: BigNumberish, localAppIndex?: number): Array<[number, Uint8Array]>;
export declare function v2MarketXalgoStrategyBoxRefs(marketId: BigNumberish, localAppIndex?: number): Array<[number, Uint8Array]>;
export interface V2MarketYieldPublicMarkInput extends SenderInput {
    v2MarketsAppId: number;
    v2AdminControlAppId?: number;
    v2AdminAppId?: number;
    v2MathAppId?: number;
    v2MarketYieldVaultAppId?: number;
    marketYieldVaultAppId?: number;
    marketFolksYieldVaultAppId?: number;
    v2MarketXalgoYieldVaultAppId?: number;
    marketYieldRegistry?: Record<string, unknown>;
    marketYieldStrategies?: Array<Record<string, unknown>>;
    marketIds?: BigNumberish[];
    marketId?: BigNumberish;
    assetIds?: BigNumberish[];
    currentRound?: BigNumberish;
    nearStaleRounds?: BigNumberish;
    manifest?: ProtocolManifest;
}
export interface V2OraclePayloadLike {
    message?: BytesLike;
    signature?: BytesLike;
    messageHex?: string;
    signatureHex?: string;
    message_hex?: string;
    signature_hex?: string;
}
export declare function buildV2MarketYieldPublicMarkCalls(input: V2MarketYieldPublicMarkInput): AppCallDescriptor[];
export declare function buildV2SingleTokenDepositLiquidityCall(input: V2SingleTokenDepositLiquidityInput): AppCallDescriptor;
export declare function buildV2SingleTokenWithdrawLiquidityCall(input: V2SingleTokenWithdrawLiquidityInput): AppCallDescriptor;
export declare function buildV2SingleTokenFundStorageCall(input: V2SingleTokenFundStorageInput): AppCallDescriptor;
export declare function buildV2SingleTokenOpenOrIncreaseCall(input: V2SingleTokenOpenOrIncreaseInput): AppCallDescriptor;
export declare function buildV2SingleTokenAddPositionMarginCall(input: V2SingleTokenAddPositionMarginInput): AppCallDescriptor;
export declare function buildV2SingleTokenDecreaseOrCloseCall(input: V2SingleTokenDecreaseOrCloseInput): AppCallDescriptor;
export declare function buildV2SingleTokenWithdrawPositionMarginCall(input: V2SingleTokenWithdrawPositionMarginInput): AppCallDescriptor;
export declare function buildV2SingleTokenLiquidateCall(input: V2SingleTokenLiquidationInput): AppCallDescriptor;
export declare function buildAppCall(input: {
    appId: number;
    appName: string;
    methodName: string;
    sender: AddressLike;
    args: unknown[];
    boxes?: Array<Uint8Array | [number, Uint8Array]>;
    foreignApps?: number[];
    foreignAssets?: number[];
    accounts?: AddressLike[];
    manifest?: ProtocolManifest;
    flatFeeMicroAlgo?: BigNumberish;
}): AppCallDescriptor;
export declare function toApplicationNoOpTxn(call: AppCallDescriptor, suggestedParams: SuggestedParams, options?: {
    flatFeeMicroAlgo?: BigNumberish;
    deferLargeProgramReadBudget?: boolean;
}): Transaction;
export declare function buildV2FundStorageTransactions(input: V2FundStorageGroupInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2DepositLiquidityCall(input: V2DepositLiquidityGroupInput): AppCallDescriptor;
export declare function buildV2DepositLiquidityTransactions(input: V2DepositLiquidityGroupInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SwapExactInTransactions(input: V2SwapExactInInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SwapRouteExactInTransactions(input: V2SwapRouteExactInInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2WithdrawLiquidityTransactions(input: V2WithdrawLiquidityInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2WithdrawLiquidityWithSwapTransactions(input: V2WithdrawLiquidityWithSwapInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2OpenOrIncreaseTransactions(input: V2OpenOrIncreaseGroupInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2AddPositionMarginTransactions(input: V2AddPositionMarginInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2OpenOrIncreaseWithStorageTransactions(input: V2OpenOrIncreaseWithStorageGroupInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2DecreaseOrCloseTransactions(input: V2DecreaseOrCloseInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2WithdrawPositionMarginTransactions(input: V2WithdrawPositionMarginInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2DecreaseOrCloseWithSwapTransactions(input: V2DecreaseOrCloseWithSwapInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2LiquidateTransactions(input: V2LiquidationInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SubmitOrderTransactions(input: V2SubmitOrderInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SubmitLinkedOrderTransactions(input: V2SubmitLinkedOrderInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2MarketOpenWithAttachedOrdersTransactions(input: V2MarketOpenWithAttachedOrdersInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2ActiveAttachedOrdersTransactions(input: V2MarketOpenWithAttachedOrdersInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2OpenLimitWithAttachedOrdersTransactions(input: V2OpenLimitWithAttachedOrdersInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2ExecuteOrderTransactions(input: V2ExecuteOrderInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2CancelOrderTransactions(input: V2CancelOrderInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2CancelExpiredOrderTransactions(input: V2CancelExpiredOrderInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2UpdateFundingTransactions(input: PdexV2AppRefs & {
    v2AdminAppId?: number;
    v2AdminOpsAppId?: number;
} & SenderInput & V2MarketAssetRefs & OracleCallArgs & {
    marketId: BigNumberish;
    periods?: BigNumberish;
}, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2CvaDepositTransactions(input: V2CvaDepositInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2CvaWithdrawTransactions(input: V2CvaWithdrawInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2CvaWithdrawFromMarketTransactions(input: V2CvaWithdrawFromMarketInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenDepositLiquidityTransactions(input: V2SingleTokenDepositLiquidityInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenWithdrawLiquidityTransactions(input: V2SingleTokenWithdrawLiquidityInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenFundStorageTransactions(input: V2SingleTokenFundStorageInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenOpenOrIncreaseTransactions(input: V2SingleTokenOpenOrIncreaseInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenAddPositionMarginTransactions(input: V2SingleTokenAddPositionMarginInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenOpenOrIncreaseWithStorageTransactions(input: V2SingleTokenOpenOrIncreaseWithStorageInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenDecreaseOrCloseTransactions(input: V2SingleTokenDecreaseOrCloseInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenWithdrawPositionMarginTransactions(input: V2SingleTokenWithdrawPositionMarginInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildV2SingleTokenLiquidateTransactions(input: V2SingleTokenLiquidationInput, suggestedParams: SuggestedParams): Transaction[];
export declare function buildSingleAppCallTransaction(call: AppCallDescriptor, suggestedParams: SuggestedParams, options?: {
    flatFeeMicroAlgo?: BigNumberish;
}): Transaction[];
export declare function v2LargeProgramRoles(appName: string, methodName: string): V2LargeProgramRole[];
export declare function v2TransactionGroupResult(transactions: Transaction[]): V2TransactionGroupResult;
export declare function prependV2TransactionGroupTransactions(group: V2TransactionGroupResult, prefix: Transaction[]): V2TransactionGroupResult;
export declare function appendV2TransactionGroupTransactions(group: V2TransactionGroupResult, suffix: Transaction[]): V2TransactionGroupResult;
export declare function insertV2TransactionGroupTransactions(group: V2TransactionGroupResult, index: number, insertions: Transaction[]): V2TransactionGroupResult;
export declare const V2_ZERO_BUILDER_ADDRESS: string;
export declare const MAX_POSITION_BUILDER_FEE_BPS = 10n;
export declare const MAX_SWAP_BUILDER_FEE_BPS = 100n;
export declare function normalizeBuilderFee(value: BuilderFeeInput | undefined, maxFeeBps?: BigNumberish): readonly [string, bigint];
//# sourceMappingURL=transactions.d.ts.map