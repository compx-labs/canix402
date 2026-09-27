import { AERODROME_ROUTER } from "../../../adapters/aerodrome.js";
import {
  BASE_CHAIN_ID,
  encodeApproveCall,
  encodeGaugeWithdrawCall,
  encodeRemoveLiquidityCall,
  parseAerodromeWithdrawInput,
  resolveAerodromeWithdrawState,
  type AerodromeWithdrawInput,
  type AerodromeWithdrawState
} from "./shared.js";
import type {
  SerializedTransaction,
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec
} from "../../types.js";
import { buildShapeKey } from "../../types.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "base",
  protocol: "aerodrome",
  protocolVersion: "v2",
  action: "withdraw",
  variant: "gauge"
};

const ORDER_WARNING =
  "Broadcast these calls in order. The LP approve and removeLiquidity must follow gauge withdraw in the same ordered batch, or after it confirms.";

export const aerodromeWithdrawShape: TransactionShapeSpec<
  AerodromeWithdrawInput,
  AerodromeWithdrawState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Aerodrome unstake and remove liquidity",
  description:
    "Unsigned Gauge.withdraw then Router.removeLiquidity for a basic Aerodrome pool on Base. Tokens are sent to the quoting wallet. No reward claim.",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "poolId", "liquidity"],
  sources: [
    {
      kind: "docs",
      description: "Gauge.withdraw then Router.removeLiquidity",
      url: "https://github.com/aerodrome-finance/contracts"
    }
  ],
  parseInput: parseAerodromeWithdrawInput,
  resolveState: resolveAerodromeWithdrawState,
  async build(
    _context: ShapeBuildContext,
    input: AerodromeWithdrawInput,
    state: AerodromeWithdrawState
  ): Promise<ShapeBuildResult> {
    const calls = [
      evmCall(state.gaugeAddress, encodeGaugeWithdrawCall(state.liquidity), input)
    ];
    if (state.needsApproveLp) {
      calls.push(
        evmCall(state.poolAddress, encodeApproveCall(AERODROME_ROUTER, state.liquidity), input)
      );
    }
    calls.push(evmCall(state.routerAddress, encodeRemoveLiquidityCall(state), input));
    return {
      transactions: [],
      evmCalls: calls,
      metadata: withdrawMetadata(state, calls),
      warnings: [ORDER_WARNING]
    };
  },
  validate(group, input, state) {
    return validateWithdraw(group, input, state);
  }
};

function evmCall(
  to: string,
  data: string,
  input: AerodromeWithdrawInput
): { to: string; data: string; value: string; chainId: number; from: string } {
  return {
    to,
    data,
    value: "0",
    chainId: BASE_CHAIN_ID,
    from: input.userAddress
  };
}

function withdrawMetadata(
  state: AerodromeWithdrawState,
  calls: readonly unknown[]
): Record<string, unknown> {
  return {
    chain: "base",
    chainId: BASE_CHAIN_ID,
    poolAddress: state.poolAddress,
    gaugeAddress: state.gaugeAddress,
    stable: state.stable,
    liquidity: state.liquidity.toString(),
    amountAMin: state.amountAMin.toString(),
    amountBMin: state.amountBMin.toString(),
    slippageBps: state.slippageBps,
    deadline: state.deadline.toString(),
    evmCalls: calls
  };
}

function validateWithdraw(
  group: readonly SerializedTransaction[],
  input: AerodromeWithdrawInput,
  state: AerodromeWithdrawState
): ShapeValidationResult {
  const errors: string[] = [];
  if (group.some((txn) => txn.type !== "evm")) {
    errors.push("Aerodrome quotes must not include Algorand transactions.");
  }
  const withdraw = group[0];
  const remove = group[group.length - 1];
  if (withdraw?.evmCall?.to !== state.gaugeAddress || !withdraw.evmCall?.data.startsWith("0x2e1a7d4d")) {
    errors.push("Aerodrome withdraw must start with Gauge.withdraw(uint256).");
  }
  if (
    remove?.evmCall?.to !== state.routerAddress ||
    !remove.evmCall?.data.startsWith("0x0dede6c4")
  ) {
    errors.push(
      "Aerodrome removeLiquidity calldata must use removeLiquidity(address,address,bool,uint256,uint256,uint256,address,uint256)."
    );
  }
  if (input.liquidity <= 0n) {
    errors.push("Liquidity must be positive.");
  }
  const expected = state.needsApproveLp ? 3 : 2;
  if (group.length !== expected) {
    errors.push(`Expected ${expected} EVM call(s), got ${group.length}.`);
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}
