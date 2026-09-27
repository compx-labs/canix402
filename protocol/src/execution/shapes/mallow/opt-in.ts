import algosdk, { Algodv2, type SuggestedParams, type Transaction } from "algosdk";

import { InvalidShapeInputError, ShapeStateError } from "../../errors.js";
import {
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import { MALLOW_USDC_ASSET_ID } from "./constants.js";
import { accountOptedIntoUsdc } from "./open-limit.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "mallow",
  protocolVersion: "v1",
  action: "optIn",
  variant: "usdc"
};

export interface MallowUsdcOptInInput {
  userAddress: string;
}

export interface MallowUsdcOptInDependencies {
  accountOptedIntoUsdc: (algod: Algodv2, address: string) => Promise<boolean>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
}

let dependencyOverrides: Partial<MallowUsdcOptInDependencies> | undefined;

export function setMallowUsdcOptInDependenciesForTests(
  overrides?: Partial<MallowUsdcOptInDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): MallowUsdcOptInDependencies {
  return {
    accountOptedIntoUsdc,
    getSuggestedParams: (algod) => algod.getTransactionParams().do(),
    ...dependencyOverrides
  };
}

function parseInput(raw: unknown): MallowUsdcOptInInput {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidShapeInputError("Shape input must be an object.");
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.userAddress !== "string" || !algosdk.isValidAddress(value.userAddress)) {
    throw new InvalidShapeInputError("userAddress must be a valid Algorand address.");
  }
  return { userAddress: value.userAddress };
}

export const mallowUsdcOptInShape: TransactionShapeSpec<MallowUsdcOptInInput, Record<string, never>> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Mallow USDC opt-in",
  description:
    "Compiles an unsigned 0-amount USDC opt-in so a wallet can post Mallow perps margin. " +
    "Rejected when the account is already opted in. Canix does not sign or submit.",
  supportedOpportunityTypes: ["perps"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress"],
  sources: [
    {
      kind: "docs",
      description: "Algorand ASA opt-in is a 0-amount transfer to the sender",
      url: "https://developer.algorand.org/docs/get-details/asa/"
    }
  ],

  parseInput,

  async resolveState(context, input): Promise<Record<string, never>> {
    const dependencies = resolveDependencies();
    const optedIn = await dependencies.accountOptedIntoUsdc(context.algod, input.userAddress);
    if (optedIn) {
      throw new ShapeStateError("Wallet is already opted into USDC.", {
        details: { reason: "already-opted-in", assetId: MALLOW_USDC_ASSET_ID }
      });
    }
    return {};
  },

  async build(context, input): Promise<ShapeBuildResult> {
    const suggestedParams = await resolveDependencies().getSuggestedParams(context.algod);
    const txn: Transaction = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: input.userAddress,
      receiver: input.userAddress,
      assetIndex: MALLOW_USDC_ASSET_ID,
      amount: 0n,
      suggestedParams
    });
    return {
      transactions: [txn],
      warnings: ["Submit this opt-in before compiling a Mallow order."],
      metadata: {
        protocol: "mallow",
        assetId: MALLOW_USDC_ASSET_ID,
        signed: false,
        submitted: false,
        executionSubmitted: false
      }
    };
  },

  validate(group, input): ShapeValidationResult {
    const errors: string[] = [];
    if (group.length !== 1) {
      errors.push("USDC opt-in must be a single transaction.");
    }
    const txn = group[0];
    if (!txn || txn.type !== "axfer") {
      errors.push("USDC opt-in must be an asset transfer.");
    }
    if (txn && txn.sender !== input.userAddress) {
      errors.push("USDC opt-in sender is not the user.");
    }
    if (txn?.assetTransfer?.assetIndex !== String(MALLOW_USDC_ASSET_ID)) {
      errors.push("USDC opt-in asset is not USDC.");
    }
    if (txn?.assetTransfer?.amount !== "0") {
      errors.push("USDC opt-in amount must be zero.");
    }
    if (txn?.assetTransfer?.receiver !== input.userAddress) {
      errors.push("USDC opt-in receiver must be the sender.");
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  }
};
