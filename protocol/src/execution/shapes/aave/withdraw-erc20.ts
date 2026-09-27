import {
  BASE_CHAIN_ID,
  encodeWithdrawCall,
  parseAavePoolActionInput,
  resolveAaveWithdrawState,
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
  action: "withdraw",
  variant: "erc20"
};

export const aaveWithdrawShape: TransactionShapeSpec<AavePoolActionInput, AavePoolActionState> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Aave V3 withdraw",
  description:
    "Unsigned Pool.withdraw on Aave V3 Base. The receiver is the quoting wallet. No native unwrap.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "assetAddress", "amount"],
  sources: [
    {
      kind: "docs",
      description: "Pool.withdraw(asset, amount, to)",
      url: "https://aave.com/docs/aave-v3/smart-contracts/pool"
    }
  ],
  parseInput: (raw) => parseAavePoolActionInput(raw, "withdraw"),
  resolveState: resolveAaveWithdrawState,
  async build(
    _context: ShapeBuildContext,
    input: AavePoolActionInput,
    state: AavePoolActionState
  ): Promise<ShapeBuildResult> {
    const calls = [
      {
        to: state.poolAddress,
        data: encodeWithdrawCall(state.assetAddress, input.amount, input.userAddress),
        value: "0",
        chainId: BASE_CHAIN_ID,
        from: input.userAddress
      }
    ];
    return {
      transactions: [],
      evmCalls: calls,
      metadata: actionMetadata(state, calls),
      warnings: []
    };
  },
  validate(group, input, state) {
    return validatePoolCall(group, input, state, {
      expectedLength: 1,
      selector: "0x69328dec",
      selectorLabel: "withdraw(address,uint256,address)"
    });
  }
};
