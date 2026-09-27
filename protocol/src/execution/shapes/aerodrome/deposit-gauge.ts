import { AERODROME_ROUTER } from "../../../adapters/aerodrome.js";
import {
  BASE_CHAIN_ID,
  encodeAddLiquidityCall,
  encodeApproveCall,
  encodeGaugeDepositCall,
  parseAerodromeDepositInput,
  resolveAerodromeDepositState,
  type AerodromeDepositInput,
  type AerodromeDepositState
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
  action: "deposit",
  variant: "gauge"
};

const ORDER_WARNING =
  "Broadcast these calls in order. The LP approve and gauge deposit must follow addLiquidity in the same ordered batch, or after it confirms.";

export const aerodromeDepositShape: TransactionShapeSpec<
  AerodromeDepositInput,
  AerodromeDepositState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Aerodrome add liquidity and stake",
  description:
    "Unsigned ERC-20 approves, Router.addLiquidity, then Gauge.deposit for a basic Aerodrome pool on Base. The LP receiver is the quoting wallet. No Slipstream, native ETH, or Permit.",
  supportedOpportunityTypes: ["farm"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "poolId", "amountA", "amountB"],
  sources: [
    {
      kind: "docs",
      description: "Router.addLiquidity then Gauge.deposit",
      url: "https://github.com/aerodrome-finance/contracts"
    }
  ],
  parseInput: parseAerodromeDepositInput,
  resolveState: resolveAerodromeDepositState,
  async build(
    _context: ShapeBuildContext,
    input: AerodromeDepositInput,
    state: AerodromeDepositState
  ): Promise<ShapeBuildResult> {
    const calls = [];
    if (state.needsApprove0) {
      calls.push(evmCall(state.token0, encodeApproveCall(AERODROME_ROUTER, input.amountA), input));
    }
    if (state.needsApprove1) {
      calls.push(evmCall(state.token1, encodeApproveCall(AERODROME_ROUTER, input.amountB), input));
    }
    calls.push(evmCall(state.routerAddress, encodeAddLiquidityCall(state), input));
    if (state.needsApproveLp) {
      calls.push(
        evmCall(state.poolAddress, encodeApproveCall(state.gaugeAddress, state.liquidity), input)
      );
    }
    calls.push(evmCall(state.gaugeAddress, encodeGaugeDepositCall(state.liquidity), input));
    return {
      transactions: [],
      evmCalls: calls,
      metadata: depositMetadata(state, calls),
      warnings: [ORDER_WARNING]
    };
  },
  validate(group, input, state) {
    return validateDeposit(group, input, state);
  }
};

function evmCall(
  to: string,
  data: string,
  input: AerodromeDepositInput
): { to: string; data: string; value: string; chainId: number; from: string } {
  return {
    to,
    data,
    value: "0",
    chainId: BASE_CHAIN_ID,
    from: input.userAddress
  };
}

function depositMetadata(
  state: AerodromeDepositState,
  calls: readonly unknown[]
): Record<string, unknown> {
  return {
    chain: "base",
    chainId: BASE_CHAIN_ID,
    poolAddress: state.poolAddress,
    gaugeAddress: state.gaugeAddress,
    stable: state.stable,
    amountADesired: state.amountADesired.toString(),
    amountBDesired: state.amountBDesired.toString(),
    amountAMin: state.amountAMin.toString(),
    amountBMin: state.amountBMin.toString(),
    liquidity: state.liquidity.toString(),
    slippageBps: state.slippageBps,
    deadline: state.deadline.toString(),
    evmCalls: calls
  };
}

function validateDeposit(
  group: readonly SerializedTransaction[],
  input: AerodromeDepositInput,
  state: AerodromeDepositState
): ShapeValidationResult {
  const errors: string[] = [];
  if (group.some((txn) => txn.type !== "evm")) {
    errors.push("Aerodrome quotes must not include Algorand transactions.");
  }
  const add = group.find((txn) => txn.evmCall?.to === state.routerAddress);
  const deposit = group[group.length - 1];
  if (!add?.evmCall?.data.startsWith("0x5a47ddc3")) {
    errors.push("Aerodrome addLiquidity calldata must use addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address,uint256).");
  }
  if (deposit?.evmCall?.to !== state.gaugeAddress || !deposit.evmCall?.data.startsWith("0xb6b55f25")) {
    errors.push("Aerodrome deposit must end with Gauge.deposit(uint256).");
  }
  if (input.amountA <= 0n || input.amountB <= 0n) {
    errors.push("Amounts must be positive.");
  }
  const expected =
    2 +
    (state.needsApprove0 ? 1 : 0) +
    (state.needsApprove1 ? 1 : 0) +
    (state.needsApproveLp ? 1 : 0);
  if (group.length !== expected) {
    errors.push(`Expected ${expected} EVM call(s), got ${group.length}.`);
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}
