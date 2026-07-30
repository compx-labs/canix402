import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";

import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey,
  type SerializedTransaction
} from "../../types.js";
import { ALPHA_ARCADE_INNER_TXN_FLAT_FEE, MIN_ALGO_FEE } from "./constants.js";
import { parseAddress } from "./parse-input.js";
import {
  type AlphaArcadeStakingState,
  resolveAlphaArcadeStakingState
} from "./staking-state.js";
import { CLAIM_METHOD, CLAIM_METHOD_SELECTOR_HEX } from "./staking-spec.js";
import {
  addAssetOptInToComposer,
  assertGroupedTransactions,
  buildComposerGroup,
  getSuggestedParams,
  readAppCallSelectorHex
} from "./shared.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "alpha-arcade",
  protocolVersion: "v1",
  action: "claimRewards",
  variant: "usdc"
};

export interface AlphaArcadeClaimRewardsInput {
  userAddress: string;
}

export interface AlphaArcadeClaimRewardsDependencies {
  resolveState: typeof resolveAlphaArcadeStakingState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  buildComposerGroup: typeof buildComposerGroup;
}

let dependencyOverrides: Partial<AlphaArcadeClaimRewardsDependencies> | undefined;

export function setAlphaArcadeClaimRewardsDependenciesForTests(
  overrides?: Partial<AlphaArcadeClaimRewardsDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): AlphaArcadeClaimRewardsDependencies {
  return {
    resolveState: resolveAlphaArcadeStakingState,
    getSuggestedParams,
    buildComposerGroup,
    ...dependencyOverrides
  };
}

export const alphaArcadeClaimRewardsShape: TransactionShapeSpec<
  AlphaArcadeClaimRewardsInput,
  AlphaArcadeStakingState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Alpha Arcade v1 staking USDC reward claim",
  description:
    "Claims accrued USDC trading-fee rewards via claim(). Prefixes a USDC ASA opt-in " +
    "when the user is not yet opted into USDC. Flat 2000 microAlgo fee on the claim call.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "manage",
  requiredInputs: ["userAddress"],
  sources: [
    {
      kind: "sdk",
      description: "@alpha-arcade/sdk claimStakingRewards — USDC opt-in? + claim()"
    }
  ],

  parseInput(raw: unknown): AlphaArcadeClaimRewardsInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseAddress(value.userAddress)
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: AlphaArcadeClaimRewardsInput
  ): Promise<AlphaArcadeStakingState> {
    const dependencies = resolveDependencies();
    const state = await dependencies.resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });

    if (!state.local.optedIn) {
      throw new ShapeStateError("User is not opted into the Alpha Arcade staking pool.", {
        details: { appId: state.appId, userAddress: input.userAddress }
      });
    }

    return state;
  },

  async build(
    context: ShapeBuildContext,
    input: AlphaArcadeClaimRewardsInput,
    state: AlphaArcadeStakingState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Alpha Arcade claim.", {
        cause: error
      });
    }

    const atc = new AtomicTransactionComposer();
    if (!state.userOptedIntoUsdc) {
      addAssetOptInToComposer({
        atc,
        sender: input.userAddress,
        assetId: state.usdcAssetId,
        suggestedParams
      });
      warnings.push("USDC opt-in is included; user must sign the opt-in transaction.");
    }

    const feeSp: algosdk.SuggestedParams = {
      ...suggestedParams,
      fee: ALPHA_ARCADE_INNER_TXN_FLAT_FEE,
      flatFee: true
    };

    atc.addMethodCall({
      appID: state.appId,
      method: CLAIM_METHOD,
      methodArgs: [],
      sender: input.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams: feeSp,
      appForeignAssets: [state.usdcAssetId]
    });

    let rawTxns: Transaction[];
    try {
      rawTxns = dependencies.buildComposerGroup(atc);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Alpha Arcade claim transactions.", {
        cause: error
      });
    }

    const transactions = normalizeTransactions(rawTxns);

    return {
      transactions,
      warnings,
      metadata: {
        appId: state.appId,
        appAddress: state.appAddress,
        alphaAssetId: state.alphaAssetId,
        usdcAssetId: state.usdcAssetId,
        usdcOptInIncluded: !state.userOptedIntoUsdc,
        appCallFlatFee: ALPHA_ARCADE_INNER_TXN_FLAT_FEE.toString()
      }
    };
  },

  validate(
    group,
    input: AlphaArcadeClaimRewardsInput,
    state: AlphaArcadeStakingState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const includesUsdcOptIn = !state.userOptedIntoUsdc;
    const expectedLength = includesUsdcOptIn ? 2 : 1;
    if (group.length !== expectedLength) {
      errors.push(`Expected exactly ${expectedLength} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    let appIndex = 0;
    if (includesUsdcOptIn) {
      validateUsdcOptInTxn({
        txn: group[0],
        userAddress: input.userAddress,
        usdcAssetId: state.usdcAssetId,
        errors
      });
      appIndex = 1;
    }

    validateClaimAppCallTxn({
      txn: group[appIndex],
      userAddress: input.userAddress,
      appId: state.appId,
      usdcAssetId: state.usdcAssetId,
      errors
    });

    assertGroupedTransactions(group, errors);

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateUsdcOptInTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  usdcAssetId: number;
  errors: string[];
}): void {
  const { txn, userAddress, usdcAssetId, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push("Transaction 1 must be a USDC opt-in transfer.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Transaction 1 sender must be the user address.");
  }
  if (txn.assetTransfer.receiver !== userAddress) {
    errors.push("Transaction 1 receiver must be the user address for opt-in.");
  }
  if (txn.assetTransfer.assetIndex !== String(usdcAssetId)) {
    errors.push("Transaction 1 must opt into USDC.");
  }
  if (txn.assetTransfer.amount !== "0") {
    errors.push("Transaction 1 opt-in amount must be zero.");
  }
}

function validateClaimAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  appId: number;
  usdcAssetId: number;
  errors: string[];
}): void {
  const { txn, userAddress, appId, usdcAssetId, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("Final transaction must be the claim application call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Claim app call sender must be the user address.");
  }
  if (txn.applicationCall.appIndex !== String(appId)) {
    errors.push("Claim app call must target the staking application.");
  }
  if (readAppCallSelectorHex(txn) !== CLAIM_METHOD_SELECTOR_HEX) {
    errors.push("Claim app call must call claim()uint64.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(usdcAssetId))) {
    errors.push("Claim app call foreign assets must include USDC.");
  }
  if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`Claim app call fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

export function buildMockClaimGroup(params: {
  user: algosdk.Account;
  appId: number;
  usdcAssetId: number;
  includeUsdcOptIn: boolean;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const txns: Transaction[] = [];
  if (params.includeUsdcOptIn) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: params.user.addr,
        receiver: params.user.addr,
        assetIndex: params.usdcAssetId,
        amount: 0n,
        suggestedParams: params.suggestedParams
      })
    );
  }
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.appId),
      appArgs: [Buffer.from(CLAIM_METHOD_SELECTOR_HEX, "hex")],
      foreignAssets: [BigInt(params.usdcAssetId)],
      suggestedParams: {
        ...params.suggestedParams,
        fee: ALPHA_ARCADE_INNER_TXN_FLAT_FEE,
        flatFee: true
      }
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}
