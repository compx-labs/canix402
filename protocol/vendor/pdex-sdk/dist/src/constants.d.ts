export type BigNumberish = number | bigint | string;
export type BytesLike = Uint8Array | number[] | string;
/** Explicitly opt out of lifetime checking on a direct close or margin withdrawal. */
export declare const UNCHECKED_CLOSE_POSITION_ID: bigint;
export declare const SIDE: {
    readonly LONG: 1;
    readonly SHORT: 2;
};
export declare const TIME_IN_FORCE: {
    readonly GTC: 1;
    readonly GTD: 2;
    readonly IOC: 3;
};
export declare const V2_ORDER_KIND: {
    readonly OPEN_LIMIT: 1;
    readonly DECREASE_TAKE_PROFIT: 2;
    readonly DECREASE_STOP_LOSS: 3;
};
export declare const V2_ORDER_BAD_PRICE_REASON = "bad_order_price";
export declare const V2_ORDER_TARGET: {
    readonly PAIR: 1;
    readonly SINGLE_TOKEN: 2;
};
export declare const V2_ORDER_LINK_MODE_FACTOR: bigint;
export declare const V2_ORDER_LINK_ID_MASK: bigint;
export declare const V2_ORDER_LINK_MODE: {
    readonly STANDALONE: 0;
    readonly BRACKET_PARENT: 1;
    readonly CHILD_WAIT_PARENT: 2;
    readonly CHILD_ACTIVE: 3;
};
export declare const V2_OUTPUT_SWAP: {
    readonly NONE: 0;
    readonly PNL_TO_COLLATERAL: 1;
    readonly COLLATERAL_TO_PNL: 2;
};
export declare const HEAVY_METHOD_EXTRA_FEE_MICRO_ALGO = 49000;
export declare const HEAVY_METHOD_FLAT_FEE_MICRO_ALGO: number;
export declare const V2_FUNDING_BORROWING_METHOD_FLAT_FEE_MICRO_ALGO = 14000;
export declare const V2_ADMIN_OPS_METHOD_FLAT_FEE_MICRO_ALGO = 10000;
export declare const V2_WITHDRAW_LIQUIDITY_METHOD_FLAT_FEE_MICRO_ALGO: number;
export declare const V2_ROUTE_SWAP_METHOD_FLAT_FEE_MICRO_ALGO = 30000;
export declare const V2_SWAP_EXACT_IN_METHOD_FLAT_FEE_MICRO_ALGO = 17000;
export declare const V2_TRADING_METHOD_FLAT_FEE_MICRO_ALGO = 29000;
export declare const V2_DECREASE_OR_CLOSE_METHOD_FLAT_FEE_MICRO_ALGO = 37000;
export declare const V2_SINGLE_TOKEN_DECREASE_METHOD_FLAT_FEE_MICRO_ALGO = 37000;
export declare const V2_WITHDRAW_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO = 21000;
export declare const V2_DECREASE_WITH_SWAP_METHOD_FLAT_FEE_MICRO_ALGO = 37000;
export declare const V2_MARKETS_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO = 3000;
export declare const V2_MATH_RESOURCE_CARRIER_FLAT_FEE_MICRO_ALGO = 1000;
export declare const V2_LIQUIDATION_METHOD_FLAT_FEE_MICRO_ALGO = 28000;
export declare const V2_ADL_METHOD_FLAT_FEE_MICRO_ALGO = 32000;
export declare const V2_LP_BOX_MBR_MICRO_ALGO = 26500;
export declare const V2_TRADER_BOX_MBR_MICRO_ALGO = 29300;
export declare const V2_POSITION_BOX_MBR_MICRO_ALGO = 70900;
export declare const V2_CVA_USER_BOX_MBR_MICRO_ALGO = 32900;
export declare const V2_CVA_MARKET_BOX_MBR_MICRO_ALGO = 42500;
export declare const V2_LEGACY_ORDER_BOX_MBR_MICRO_ALGO = 96500;
export declare const V2_ORDER_BOX_MBR_MICRO_ALGO = 99700;
export declare const V2_MARKET_BASE_BOX_MBR_MICRO_ALGO = 347400;
export declare const V2_DYNAMIC_OI_MARGIN_BOX_MBR_MICRO_ALGO = 20100;
export declare const V2_OPEN_ORDER_EXECUTION_STORAGE_ESCROW_MICRO_ALGO = 100200;
export declare const V2_ORDER_OPS_METHOD_FLAT_FEE_MICRO_ALGO = 14000;
export declare const V2_ORDER_OPS_INLINE_EXECUTION_METHOD_FLAT_FEE_MICRO_ALGO: number;
export declare const V2_ORDER_OPS_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO: number;
export declare const V2_ORDER_OPS_DECREASE_EXECUTE_METHOD_FLAT_FEE_MICRO_ALGO: number;
export declare const V2_CVA_METHOD_FLAT_FEE_MICRO_ALGO = 23000;
export declare const V2_CVA_MARKET_WITHDRAW_METHOD_FLAT_FEE_MICRO_ALGO: number;
export declare const V2_YIELD_PDEX_BASE_FLAT_FEE_MICRO_ALGO = 13000;
export declare const V2_YIELD_MAX_EXTERNAL_PROTOCOL_FEE_MICRO_ALGO = 10000;
export declare const V2_YIELD_MAX_POOL_CALL_FEE_MICRO_ALGO = 10000;
export declare const PDEX_FOLKS_EXTERNAL_PROTOCOL_FEE_MICRO_ALGO = 0;
export declare const MARKET_YIELD_ACTION_RECALL_PDEX_BASE_FLAT_FEE_MICRO_ALGO = 12000;
export declare const MARKET_YIELD_ACTION_RECALL_FLAT_FEE_MICRO_ALGO: number;
export declare const MARKET_YIELD_ACTION_REFRESH_ROUTER_FLAT_FEE_MICRO_ALGO = 1000;
export declare const MARKET_YIELD_ACTION_HOT_CHECK_FLAT_FEE_MICRO_ALGO = 1000;
export declare const MARKET_YIELD_ACTION_MARK_FLAT_FEE_MICRO_ALGO = 5000;
export declare const MARKET_YIELD_ACTION_FINALIZATION_FLAT_FEE_MICRO_ALGO = 2000;
export declare const V2_SINGLE_TOKEN_INLINE_RECALL_METHOD_FLAT_FEE_MICRO_ALGO = 38000;
export declare const XALGO_RESOURCE_ACCOUNT_LIMIT = 4;
export declare const NATIVE_ALGO_ASSET_ID = 0;
export declare const V2_SIGNED_QTY_BIAS = 1000000000000000000n;
export declare function decodeV2PendingImpactQty(encoded: bigint): Record<string, bigint>;
//# sourceMappingURL=constants.d.ts.map