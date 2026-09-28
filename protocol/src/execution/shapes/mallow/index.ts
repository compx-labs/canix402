import type { TransactionShapeSpec } from "../../types.js";
import { mallowCancelOrderShape } from "./cancel-order.js";
import { mallowCloseMarketShape } from "./close.js";
import { mallowOpenLimitShape } from "./open-limit.js";
import { mallowUsdcOptInShape } from "./opt-in.js";

export {
  MALLOW_BUILDER_FEE_BPS,
  MALLOW_CANCEL_ORDER_SHAPE_KEY,
  MALLOW_CLOSE_MARKET_SHAPE_KEY,
  MALLOW_MARKETS,
  MALLOW_OPEN_LIMIT_SHAPE_KEY,
  MALLOW_USDC_ASSET_ID,
  MALLOW_USDC_OPT_IN_SHAPE_KEY
} from "./constants.js";
export type { MallowMarketSymbol, MallowSide } from "./constants.js";
export { mallowBuilderFee, mallowPdexConfig, quoteBuilderFields } from "./config.js";
export type { MallowBuilderFee } from "./config.js";
export {
  loadMallowBook,
  loadMallowBookForRequest,
  prepareMallowBook,
  readyMarket,
  selectMallowOrders,
  selectMallowPositions,
  setMallowBookLoaderForTests,
  MallowUpstreamError
} from "./book.js";
export type {
  MallowAccountOrder,
  MallowAccountPosition,
  MallowBook,
  MallowMarketRow,
  MallowPreparedMarket
} from "./book.js";
export { selectMallowMarket } from "./markets.js";
export {
  numberToPrice12,
  openLimitCrossed,
  price12ToDecimal,
  protectLegsFromRoi,
  protectPriceFromRoi,
  validateProtectLegs
} from "./math.js";
export {
  assertMallowOrderEncodes,
  mallowOpenLimitShape,
  setMallowOpenLimitDependenciesForTests
} from "./open-limit.js";
export type { MallowOpenLimitInput, MallowOpenLimitState } from "./open-limit.js";
export { mallowCloseMarketShape, setMallowCloseMarketDependenciesForTests } from "./close.js";
export {
  assertMallowCancelEncodes,
  mallowCancelAttachments,
  mallowCancelOrderShape,
  setMallowCancelOrderDependenciesForTests
} from "./cancel-order.js";
export type { MallowCancelOrderInput, MallowCancelOrderState } from "./cancel-order.js";
export type { MallowCloseMarketInput, MallowCloseMarketState } from "./close.js";
export { mallowUsdcOptInShape, setMallowUsdcOptInDependenciesForTests } from "./opt-in.js";
export type { MallowUsdcOptInInput } from "./opt-in.js";

export const mallowShapes: readonly TransactionShapeSpec[] = [
  mallowOpenLimitShape,
  mallowCloseMarketShape,
  mallowCancelOrderShape,
  mallowUsdcOptInShape
];
