import { modelsv2, type SuggestedParams } from "algosdk";
import { type AddressLike, type Uint64Like } from "./boxes.js";
import { type ProtocolManifest } from "./manifest.js";
import { type AppCallDescriptor } from "./transactions.js";
export declare const V2_POSITION_COST_QUOTE_VERSION = 3n;
export declare const V2_POSITION_COST_MARKET_PAIR = 0n;
export declare const V2_POSITION_COST_MARKET_SINGLE = 1n;
export declare const V2_BORROWING_TRANSITION_SETTLED_CURRENT = 1n;
export declare const V2_BORROWING_TRANSITION_UNSETTLED_SLICE = 2n;
export declare const V2_BORROWING_TRANSITION_FULL_DELETE = 3n;
export declare const V2_POSITION_COST_PAY_DENOMINATOR = 10000000n;
export declare const V2_POSITION_COST_CLAIM_SCALE = 1000000000000n;
export declare const V2_POSITION_COST_REQUEST_FIELDS: readonly ["version", "market_kind", "position_size_usd", "close_size_usd", "collateral_amount", "collateral_asset_id", "long_asset_id", "short_asset_id", "collateral_price", "current_funding_pay_factor", "saved_funding_pay_factor", "current_borrowing_factor", "saved_borrowing_factor", "current_long_claim_factor", "saved_long_claim_factor", "current_short_claim_factor", "saved_short_claim_factor", "opposing_trader_share_bps"];
export declare const V2_POSITION_COST_RESULT_FIELDS: readonly ["version", "market_kind", "position_size_usd", "close_size_usd", "remaining_size_usd", "collateral_amount", "collateral_asset_id", "long_asset_id", "short_asset_id", "full_net_collateral_cost", "full_same_token_credit", "remaining_net_collateral_cost", "remaining_same_token_credit", "slice_net_collateral_cost", "slice_same_token_credit", "full_long_claim", "full_short_claim", "slice_long_claim", "slice_short_claim", "minimum_top_up", "borrowing_transition_mode"];
export type V2PositionCostRequest = {
    [Field in typeof V2_POSITION_COST_REQUEST_FIELDS[number]]: bigint;
};
export type V2PositionCostRawResult = {
    [Field in typeof V2_POSITION_COST_RESULT_FIELDS[number]]: bigint;
};
export interface V2PositionCostResolution extends V2PositionCostRawResult {
    normal_settlement_available: boolean;
    cost_deficit: boolean;
    requested_close_resolves: boolean;
    minimum_resolving_close_size: bigint | null;
    remaining_snapshot_mode: "FULL_DELETE" | "UNSETTLED_SLICE" | "SETTLED_CURRENT";
    expected_collateral_debit: bigint;
    expected_collateral_credit: bigint;
    expected_long_claim_output: bigint;
    expected_short_claim_output: bigint;
    other_claim_asset_id: bigint;
    full_other_token_claim: bigint;
    slice_other_token_claim: bigint;
    expected_voluntary_unpaid_amount: bigint;
    blocked_reason: "" | "top_up_required" | "close_size_insufficient";
}
export interface V2PositionCostAlgod {
    getTransactionParams(): {
        do(): Promise<SuggestedParams>;
    } | Promise<SuggestedParams>;
    getApplicationBoxByName(appId: number, name: Uint8Array): {
        do(): Promise<unknown>;
    } | Promise<unknown>;
    simulateTransactions(request: modelsv2.SimulateRequest): {
        do(): Promise<unknown>;
    } | Promise<unknown>;
}
export declare function quoteV2PositionCostSlice(request: Record<string, Uint64Like>): V2PositionCostResolution & Record<string, unknown>;
export declare function quoteV2PositionCostSpec(request: Record<string, Uint64Like>): V2PositionCostResolution & Record<string, unknown>;
export declare function quoteV2PositionResolution(costRequest: Record<string, Uint64Like>, actionRequest: Record<string, unknown>): Record<string, unknown>;
export declare function decodeV2ImpactSetting(input: Uint64Like): Record<string, bigint | boolean>;
export declare function quoteV2ImpactPolicy(request: Record<string, Uint64Like>): Record<string, unknown>;
export declare function quoteV2AdlBounds(input: {
    pre_factor_bps: Uint64Like;
    post_factor_bps: Uint64Like;
    max_factor_bps: Uint64Like;
    min_factor_after_bps: Uint64Like;
    target_profitable?: boolean;
}): Record<string, unknown>;
export declare function remainingV2SwapInput(amountInAfterFees: Uint64Like, maxNegativeBps: Uint64Like): bigint;
export declare function quoteV2ExecutionGuards(request: Record<string, unknown>): Record<string, unknown>;
export declare function enrichV2PositionCostQuote(input: Record<string, Uint64Like>): V2PositionCostResolution;
export declare function quoteV2PositionActionResolution(costQuote: Record<string, Uint64Like>, input: {
    action: "top_up" | "increase" | "voluntary_close" | "liquidation" | "adl";
    incomingCollateral?: Uint64Like;
    realizedPnlUsd?: bigint | number | string;
    impactUsd?: bigint | number | string;
    closeFeeUsd?: Uint64Like;
    collateralPrice: Uint64Like;
    minimumResolvingCloseSize?: Uint64Like | null;
}): V2PositionCostResolution & Record<string, unknown>;
export declare function minimumV2ResolvingCloseSize(positionSizeUsd: Uint64Like, resolvesAtSize: (sizeUsd: bigint) => boolean): bigint | null;
export declare function buildV2PositionCostResolutionCall(input: {
    sender: AddressLike;
    v2TradingRiskOpsAppId: number;
    request: Record<string, Uint64Like>;
    manifest?: ProtocolManifest;
}): AppCallDescriptor;
export declare function readV2PositionCostResolutionRequest(algod: V2PositionCostAlgod, input: {
    positionAppId: number;
    marketsAppId: number;
    owner: AddressLike;
    marketId: Uint64Like;
    collateralAssetId: Uint64Like;
    side: Uint64Like;
    closeSizeUsd: Uint64Like;
    oracleMessage: Uint8Array;
    manifest?: ProtocolManifest;
}): Promise<V2PositionCostRequest>;
export declare function simulateV2PositionCostResolution(algod: V2PositionCostAlgod, input: {
    sender: AddressLike;
    v2TradingRiskOpsAppId: number;
    request: Record<string, Uint64Like>;
    manifest?: ProtocolManifest;
}): Promise<V2PositionCostResolution & {
    simulation_round: bigint;
    preview_is_authorization: false;
    preview_may_expire: true;
}>;
export declare function readAndSimulateV2PositionCostResolution(algod: V2PositionCostAlgod, input: {
    sender: AddressLike;
    v2TradingRiskOpsAppId: number;
    positionAppId: number;
    marketsAppId: number;
    owner: AddressLike;
    marketId: Uint64Like;
    collateralAssetId: Uint64Like;
    side: Uint64Like;
    closeSizeUsd: Uint64Like;
    oracleMessage: Uint8Array;
    manifest?: ProtocolManifest;
}): Promise<V2PositionCostResolution & {
    simulation_round: bigint;
    preview_is_authorization: false;
    preview_may_expire: true;
}>;
export declare function decodeV2PositionCostSimulation(simulation: any, manifest?: ProtocolManifest): V2PositionCostRawResult;
//# sourceMappingURL=v2PositionResolution.d.ts.map