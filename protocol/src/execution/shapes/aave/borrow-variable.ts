import {
  BASE_CHAIN_ID,
  encodeBorrowCall,
  parseAavePoolActionInput,
  resolveAaveBorrowState,
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
  action: "borrow",
  variant: "variable"
};

export const aaveBorrowShape: TransactionShapeSpec<AavePoolActionInput, AavePoolActionState> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Aave V3 variable borrow",
  description:
    "Unsigned Pool.borrow at variable rate (interestRateMode 2) on Aave V3 Base. onBehalfOf is the quoting wallet. No eMode or stable rate.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "manage",
  requiredInputs: ["userAddress", "assetAddress", "amount"],
  sources: [
    {
      kind: "docs",
      description: "Pool.borrow(asset, amount, interestRateMode, referralCode, onBehalfOf)",
      url: "https://aave.com/docs/aave-v3/smart-contracts/pool"
    }
  ],
  parseInput: (raw) => parseAavePoolActionInput(raw, "borrow"),
  resolveState: resolveAaveBorrowState,
  async build(
    _context: ShapeBuildContext,
    input: AavePoolActionInput,
    state: AavePoolActionState
  ): Promise<ShapeBuildResult> {
    const calls = [
      {
        to: state.poolAddress,
        data: encodeBorrowCall(state.assetAddress, input.amount, input.userAddress),
        value: "0",
        chainId: BASE_CHAIN_ID,
        from: input.userAddress
      }
    ];
    return {
      transactions: [],
      evmCalls: calls,
      metadata: actionMetadata(state, calls),
      warnings: [
        "Borrow uses variable rate mode 2. Quote-time flags do not model eMode or isolation debt ceilings."
      ]
    };
  },
  validate(group, input, state) {
    return validatePoolCall(group, input, state, {
      expectedLength: 1,
      selector: "0xa415bcad",
      selectorLabel: "borrow(address,uint256,uint256,uint16,address)"
    });
  }
};
