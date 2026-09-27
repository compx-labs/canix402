import { V2_ORDER_KIND, type BigNumberish } from "./constants.js";
import { type BuilderFeeInput } from "./transactions.js";
import { type V2PriceInput, type V2QuoteResult, type V2StateRecord } from "./v2Quotes.js";
type TimeInForceInput = "GTC" | "GTD" | "IOC" | BigNumberish;
export interface V2OpenLimitOrderQuoteInput {
    market: V2StateRecord;
    pool: V2StateRecord;
    position?: V2StateRecord | null;
    positions?: V2StateRecord[];
    orders?: V2StateRecord[];
    owner: string;
    ownerOrderId?: BigNumberish;
    marketId?: BigNumberish;
    targetKind?: BigNumberish;
    collateralAssetId: BigNumberish;
    side: BigNumberish;
    sizeUsdDelta: BigNumberish;
    collateralAmount: BigNumberish;
    triggerPrice: BigNumberish;
    acceptablePrice?: BigNumberish;
    keeperFeeAssetId?: BigNumberish;
    keeperFeeAmount: BigNumberish;
    timeInForce?: TimeInForceInput;
    expiryTime?: BigNumberish;
    currentTime?: BigNumberish;
    prices?: V2PriceInput;
    builderFee?: BuilderFeeInput;
}
export interface V2DecreaseOrderQuoteInput {
    market: V2StateRecord;
    pool: V2StateRecord;
    position?: V2StateRecord | null;
    positions?: V2StateRecord[];
    orders?: V2StateRecord[];
    owner: string;
    ownerOrderId?: BigNumberish;
    marketId?: BigNumberish;
    targetKind?: BigNumberish;
    orderKind: typeof V2_ORDER_KIND.DECREASE_TAKE_PROFIT | typeof V2_ORDER_KIND.DECREASE_STOP_LOSS;
    collateralAssetId: BigNumberish;
    side: BigNumberish;
    sizeUsdDelta: BigNumberish;
    triggerPrice: BigNumberish;
    acceptablePrice?: BigNumberish;
    keeperFeeAssetId?: BigNumberish;
    keeperFeeAmount: BigNumberish;
    outputSwapMode?: BigNumberish;
    minPrimaryOutputAmount?: BigNumberish;
    minSecondaryOutputAmount?: BigNumberish;
    timeInForce?: TimeInForceInput;
    expiryTime?: BigNumberish;
    currentTime?: BigNumberish;
    prices?: V2PriceInput;
    builderFee?: BuilderFeeInput;
}
export interface V2ExecuteOrderQuoteInput {
    market: V2StateRecord;
    pool: V2StateRecord;
    order: V2StateRecord;
    position?: V2StateRecord | null;
    positions?: V2StateRecord[];
    orders?: V2StateRecord[];
    currentTime?: BigNumberish;
    prices?: V2PriceInput;
}
export declare function quoteV2OpenLimitOrder(input: V2OpenLimitOrderQuoteInput): V2QuoteResult;
export declare function quoteV2DecreaseOrder(input: V2DecreaseOrderQuoteInput): V2QuoteResult;
export declare function quoteV2ExecuteOrder(input: V2ExecuteOrderQuoteInput): V2QuoteResult;
export {};
//# sourceMappingURL=v2OrderQuotes.d.ts.map