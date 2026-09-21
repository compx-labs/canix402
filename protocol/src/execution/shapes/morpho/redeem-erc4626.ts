import {
  BASE_CHAIN_ID,
  encodeRedeemCall,
  parseMorphoRedeemInput,
  resolveMorphoRedeemState,
  type MorphoVaultPreviewState,
  type MorphoVaultRedeemInput
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
  action: "redeem",
  variant: "erc4626"
};

export const morphoVaultRedeemShape: TransactionShapeSpec<
  MorphoVaultRedeemInput,
  MorphoVaultPreviewState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Morpho Vault ERC-4626 redeem",
  description:
    "Unsigned MetaMorpho vault redeem(shares, receiver, owner) on Base. Owner must be the quoting wallet. No force-withdraw.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "vaultAddress", "shares"],
  sources: [
    {
      kind: "docs",
      description: "ERC-4626 redeem(shares, receiver, owner)",
      url: "https://docs.morpho.org/morpho-vaults/"
    }
  ],
  parseInput: parseMorphoRedeemInput,
  resolveState: resolveMorphoRedeemState,
  async build(
    _context: ShapeBuildContext,
    input: MorphoVaultRedeemInput,
    state: MorphoVaultPreviewState
  ): Promise<ShapeBuildResult> {
    const calls = [
      {
        to: state.vaultAddress,
        data: encodeRedeemCall(input.shares, state.receiver, state.owner),
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
        shares: input.shares.toString(),
        previewAssets: state.previewAssets?.toString(),
        receiver: state.receiver,
        owner: state.owner,
        evmCalls: calls
      },
      warnings: [
        "Asset preview is a quote-time snapshot. Re-quote if the vault share price moves before broadcast."
      ]
    };
  },
  validate(
    group: readonly SerializedTransaction[],
    _input: MorphoVaultRedeemInput,
    state: MorphoVaultPreviewState
  ): ShapeValidationResult {
    const errors: string[] = [];
    if (group.length !== 1) {
      errors.push(`Expected 1 EVM call, got ${group.length}.`);
    }
    const call = group[0];
    if (call?.type !== "evm" || call.evmCall?.to !== state.vaultAddress) {
      errors.push("Redeem call must target the Morpho vault.");
    }
    if (!call?.evmCall?.data.startsWith("0xba087652")) {
      errors.push("Redeem calldata must use ERC-4626 redeem(uint256,address,address).");
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  }
};

export type { MorphoVaultRedeemInput };
