import {
  BASE_CHAIN_ID,
  encodeApprovePoolCall,
  encodeSupplyCall,
  parseAavePoolActionInput,
  resolveAaveSupplyState,
  type AavePoolActionInput,
  type AavePoolActionState
} from "./shared.js";
import type {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  SerializedTransaction
} from "../../types.js";
import { buildShapeKey } from "../../types.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "base",
  protocol: "aave",
  protocolVersion: "v3",
  action: "supply",
  variant: "erc20"
};

export const aaveSupplyShape: TransactionShapeSpec<AavePoolActionInput, AavePoolActionState> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Aave V3 supply",
  description:
    "Unsigned ERC-20 approve (when allowance is insufficient) plus Pool.supply on Aave V3 Base. onBehalfOf is the quoting wallet. No Permit.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "assetAddress", "amount"],
  sources: [
    {
      kind: "docs",
      description: "Pool.supply(asset, amount, onBehalfOf, referralCode)",
      url: "https://aave.com/docs/aave-v3/smart-contracts/pool"
    }
  ],
  parseInput: (raw) => parseAavePoolActionInput(raw, "supply"),
  resolveState: resolveAaveSupplyState,
  async build(
    _context: ShapeBuildContext,
    input: AavePoolActionInput,
    state: AavePoolActionState
  ): Promise<ShapeBuildResult> {
    const calls = [];
    if (state.needsApprove) {
      calls.push({
        to: state.assetAddress,
        data: encodeApprovePoolCall(state.assetAddress, input.amount),
        value: "0",
        chainId: BASE_CHAIN_ID,
        from: input.userAddress
      });
    }
    calls.push({
      to: state.poolAddress,
      data: encodeSupplyCall(state.assetAddress, input.amount, input.userAddress),
      value: "0",
      chainId: BASE_CHAIN_ID,
      from: input.userAddress
    });
    return {
      transactions: [],
      evmCalls: calls,
      metadata: actionMetadata(state, calls),
      warnings: state.needsApprove
        ? ["First call is ERC-20 approve to the Aave Pool; broadcast it before or with supply."]
        : []
    };
  },
  validate(group, input, state) {
    return validatePoolCall(group, input, state, {
      expectedLength: state.needsApprove ? 2 : 1,
      selector: "0x617ba037",
      selectorLabel: "supply(address,uint256,address,uint16)"
    });
  }
};

export function actionMetadata(
  state: AavePoolActionState,
  calls: readonly unknown[]
): Record<string, unknown> {
  return {
    chain: "base",
    chainId: BASE_CHAIN_ID,
    poolAddress: state.poolAddress,
    assetAddress: state.assetAddress,
    amount: state.amount.toString(),
    needsApprove: state.needsApprove,
    evmCalls: calls
  };
}

export function validatePoolCall(
  group: readonly SerializedTransaction[],
  input: AavePoolActionInput,
  state: AavePoolActionState,
  expected: { expectedLength: number; selector: string; selectorLabel: string }
): ShapeValidationResult {
  const errors: string[] = [];
  if (group.length !== expected.expectedLength) {
    errors.push(`Expected ${expected.expectedLength} EVM call(s), got ${group.length}.`);
  }
  const action = group[group.length - 1];
  if (action?.type !== "evm" || action.evmCall?.to !== state.poolAddress) {
    errors.push("Aave call must target the Base V3 Pool.");
  }
  if (!action?.evmCall?.data.startsWith(expected.selector)) {
    errors.push(`Aave calldata must use ${expected.selectorLabel}.`);
  }
  if (state.needsApprove) {
    const approve = group[0];
    if (approve?.evmCall?.to !== state.assetAddress) {
      errors.push("Approve call must target the reserve underlying ERC-20.");
    }
    if (!approve?.evmCall?.data.startsWith("0x095ea7b3")) {
      errors.push("Approve calldata must use ERC-20 approve(address,uint256).");
    }
  }
  if (input.amount <= 0n) {
    errors.push("Amount must be positive.");
  }
  if (group.some((txn) => txn.type !== "evm")) {
    errors.push("Aave quotes must not include Algorand transactions.");
  }
  return { valid: errors.length === 0, errors, warnings: [] };
}
