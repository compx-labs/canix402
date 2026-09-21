import {
  BASE_CHAIN_ID,
  encodeWithdrawCall,
  parseMorphoWithdrawInput,
  resolveMorphoWithdrawState,
  type MorphoVaultPreviewState,
  type MorphoVaultWithdrawInput
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
  protocol: "morpho",
  protocolVersion: "vault",
  action: "withdraw",
  variant: "erc4626"
};

export const morphoVaultWithdrawShape: TransactionShapeSpec<
  MorphoVaultWithdrawInput,
  MorphoVaultPreviewState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Morpho Vault ERC-4626 withdraw",
  description:
    "Unsigned MetaMorpho vault withdraw(assets, receiver, owner) on Base. Owner must be the quoting wallet. No force-withdraw, Permit2, or Blue borrow.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "vaultAddress", "amount"],
  sources: [
    {
      kind: "docs",
      description: "ERC-4626 withdraw(assets, receiver, owner)",
      url: "https://docs.morpho.org/morpho-vaults/"
    }
  ],
  parseInput: parseMorphoWithdrawInput,
  resolveState: resolveMorphoWithdrawState,
  async build(
    _context: ShapeBuildContext,
    input: MorphoVaultWithdrawInput,
    state: MorphoVaultPreviewState
  ): Promise<ShapeBuildResult> {
    const calls = [
      {
        to: state.vaultAddress,
        data: encodeWithdrawCall(input.amount, state.receiver, state.owner),
        value: "0",
        chainId: BASE_CHAIN_ID,
        from: input.userAddress
      }
    ];
    return {
      transactions: [],
      evmCalls: calls,
      metadata: {
        chain: "base",
        chainId: BASE_CHAIN_ID,
        vaultAddress: state.vaultAddress,
        assetAddress: state.assetAddress,
        assets: input.amount.toString(),
        previewShares: state.previewShares?.toString(),
        receiver: state.receiver,
        owner: state.owner,
        evmCalls: calls
      },
      warnings: [
        "Share preview is a quote-time snapshot. Re-quote if the vault share price moves before broadcast."
      ]
    };
  },
  validate(
    group: readonly SerializedTransaction[],
    _input: MorphoVaultWithdrawInput,
    state: MorphoVaultPreviewState
  ): ShapeValidationResult {
    const errors: string[] = [];
    if (group.length !== 1) {
      errors.push(`Expected 1 EVM call, got ${group.length}.`);
    }
    const call = group[0];
    if (call?.type !== "evm" || call.evmCall?.to !== state.vaultAddress) {
      errors.push("Withdraw call must target the Morpho vault.");
    }
    if (!call?.evmCall?.data.startsWith("0xb460af94")) {
      errors.push("Withdraw calldata must use ERC-4626 withdraw(uint256,address,address).");
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  }
};

export type { MorphoVaultWithdrawInput };
