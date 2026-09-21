import {
  BASE_CHAIN_ID,
  encodeApproveCall,
  encodeDepositCall,
  parseMorphoDepositInput,
  resolveMorphoDepositState,
  type MorphoVaultDepositInput,
  type MorphoVaultPreviewState
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
  action: "deposit",
  variant: "erc4626"
};

export const morphoVaultDepositShape: TransactionShapeSpec<
  MorphoVaultDepositInput,
  MorphoVaultPreviewState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Morpho Vault ERC-4626 deposit",
  description:
    "Unsigned ERC-20 approve (when allowance is insufficient) plus MetaMorpho vault deposit(assets, receiver) on Base. No Permit2, Bundler3, or wallet signatures.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "vaultAddress", "amount"],
  sources: [
    {
      kind: "docs",
      description: "ERC-4626 deposit(assets, receiver) plus ERC-20 approve",
      url: "https://docs.morpho.org/morpho-vaults/"
    }
  ],
  parseInput: parseMorphoDepositInput,
  resolveState: resolveMorphoDepositState,
  async build(
    _context: ShapeBuildContext,
    input: MorphoVaultDepositInput,
    state: MorphoVaultPreviewState
  ): Promise<ShapeBuildResult> {
    const calls = [];
    if (state.needsApprove) {
      calls.push({
        to: state.assetAddress,
        data: encodeApproveCall(state.assetAddress, state.vaultAddress, input.amount),
        value: "0",
        chainId: BASE_CHAIN_ID,
        from: input.userAddress
      });
    }
    calls.push({
      to: state.vaultAddress,
      data: encodeDepositCall(input.amount, state.receiver),
      value: "0",
      chainId: BASE_CHAIN_ID,
      from: input.userAddress
    });

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
        needsApprove: state.needsApprove,
        evmCalls: calls
      },
      warnings: [
        "Share preview is a quote-time snapshot. Re-quote if the vault share price moves before broadcast.",
        ...(state.needsApprove
          ? ["First call is ERC-20 approve; broadcast approve before or with the vault deposit."]
          : [])
      ]
    };
  },
  validate(
    group: readonly SerializedTransaction[],
    input: MorphoVaultDepositInput,
    state: MorphoVaultPreviewState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const expectedLength = state.needsApprove ? 2 : 1;
    if (group.length !== expectedLength) {
      errors.push(`Expected ${expectedLength} EVM call(s), got ${group.length}.`);
    }
    const deposit = group[group.length - 1];
    if (deposit?.type !== "evm" || deposit.evmCall?.to !== state.vaultAddress) {
      errors.push("Deposit call must target the Morpho vault.");
    }
    if (!deposit?.evmCall?.data.startsWith("0x6e553f65")) {
      errors.push("Deposit calldata must use ERC-4626 deposit(uint256,address).");
    }
    if (state.needsApprove) {
      const approve = group[0];
      if (approve?.evmCall?.to !== state.assetAddress) {
        errors.push("Approve call must target the vault underlying ERC-20.");
      }
      if (!approve?.evmCall?.data.startsWith("0x095ea7b3")) {
        errors.push("Approve calldata must use ERC-20 approve(address,uint256).");
      }
    }
    if (input.amount <= 0n) {
      errors.push("Deposit amount must be positive.");
    }
    if (group.some((txn) => txn.type !== "evm")) {
      errors.push("Morpho quotes must not include Algorand transactions.");
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  }
};

export type { MorphoVaultDepositInput };
