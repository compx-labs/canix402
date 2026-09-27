import {
  BASE_CHAIN_ID,
  encodeApprovePoolCall,
  encodeRepayCall,
  parseAavePoolActionInput,
  resolveAaveRepayState,
  type AavePoolActionInput,
  type AavePoolActionState
} from "./shared.js";
import { actionMetadata, validatePoolCall } from "./supply-erc20.js";
import type {
  ShapeBuildContext,
  ShapeBuildResult,
  TransactionShapeIdentity,
  TransactionShapeSpec
} from "../../types.js";
import { buildShapeKey } from "../../types.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "base",
  protocol: "aave",
  protocolVersion: "v3",
  action: "repay",
  variant: "variable"
};

export const aaveRepayShape: TransactionShapeSpec<AavePoolActionInput, AavePoolActionState> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Aave V3 variable repay",
  description:
    "Unsigned ERC-20 approve (when allowance is insufficient) plus Pool.repay at variable rate (interestRateMode 2) on Aave V3 Base.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "assetAddress", "amount"],
  sources: [
    {
      kind: "docs",
      description: "Pool.repay(asset, amount, interestRateMode, onBehalfOf)",
      url: "https://aave.com/docs/aave-v3/smart-contracts/pool"
    }
  ],
  parseInput: (raw) => parseAavePoolActionInput(raw, "repay"),
  resolveState: resolveAaveRepayState,
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
      data: encodeRepayCall(state.assetAddress, input.amount, input.userAddress),
      value: "0",
      chainId: BASE_CHAIN_ID,
      from: input.userAddress
    });
    return {
      transactions: [],
      evmCalls: calls,
      metadata: actionMetadata(state, calls),
      warnings: state.needsApprove
        ? ["First call is ERC-20 approve to the Aave Pool; broadcast it before or with repay."]
        : []
    };
  },
  validate(group, input, state) {
    return validatePoolCall(group, input, state, {
      expectedLength: state.needsApprove ? 2 : 1,
      selector: "0x573ade81",
      selectorLabel: "repay(address,uint256,uint256,address)"
    });
  }
};
