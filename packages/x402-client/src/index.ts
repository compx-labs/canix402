export {
  MCP_SERVER_INSTALL_URL,
  MCP_SERVER_REMOTE_URL,
  MCP_SERVER_TRANSPORT,
  MCP_TOOL_NAMES,
  type McpToolName
} from "./manifest.js";

export {
  decodePaymentRequiredHeader,
  getAlgorandAccept,
  microUsdcToUsdc,
  tryGetAlgorandAccept,
  type PaymentRequest,
  type PaymentRequestAccept
} from "./protocol.js";

export {
  buildPaymentSignature,
  type BuildPaymentSignatureInput
} from "./payment.js";

export function buildStrategyPaymentNote(strategyId: number): string {
  return `x402:v2:strategy:${strategyId}`;
}

export function buildStrategyPayoutNote(week: string, strategyId: number): string {
  return `x402:v2:strategy-payout:${week}:${strategyId}`;
}
