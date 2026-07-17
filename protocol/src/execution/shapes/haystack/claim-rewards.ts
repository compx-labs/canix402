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
import { DEFAULT_HAYSTACK_APP_CALL_MAX_FEE, MIN_ALGO_FEE } from "./constants.js";
import { parseAddress } from "./parse-input.js";
import { type HaystackStakingState, resolveHaystackStakingState } from "./staking-state.js";
import { CLAIM_METHOD, CLAIM_METHOD_SELECTOR_HEX } from "./staking-spec.js";
import {
  addAssetOptInToComposer,
  assertGroupedTransactions,
  finalizeComposerGroup,
  getSuggestedParams,
  hasStakerBoxReference,
  readAppCallSelectorHex,
  stakingBoxReference
} from "./shared.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "haystack",
  protocolVersion: "v1",
  action: "claim",
  variant: "rewards"
};

export interface HaystackClaimRewardsInput {
  userAddress: string;
}

export interface HaystackClaimRewardsDependencies {
  resolveState: typeof resolveHaystackStakingState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeComposerGroup;
}

let dependencyOverrides: Partial<HaystackClaimRewardsDependencies> | undefined;

export function setHaystackClaimRewardsDependenciesForTests(
  overrides?: Partial<HaystackClaimRewardsDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HaystackClaimRewardsDependencies {
  return {
    resolveState: resolveHaystackStakingState,
    getSuggestedParams,
    finalizeComposerGroup,
    ...dependencyOverrides
  };
}

export const haystackClaimRewardsShape: TransactionShapeSpec<
  HaystackClaimRewardsInput,
  HaystackStakingState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Haystack v1 staking reward claim",
  description:
    "Claims accrued USDC and HAY staking rewards via claim()(uint64,uint64). Prefixes a USDC " +
    "opt-in transfer when the user is not yet opted into USDC.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "manage",
  requiredInputs: ["userAddress"],
  sources: [
    {
      kind: "arc56",
      description: "protocol/src/haystack-staking.arc56.json claim()(uint64,uint64)"
    }
  ],

  parseInput(raw: unknown): HaystackClaimRewardsInput {
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
    input: HaystackClaimRewardsInput
  ): Promise<HaystackStakingState> {
    const dependencies = resolveDependencies();
    const state = await dependencies.resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });

    if (!state.staker.hasBox) {
      throw new ShapeStateError("User has no staker box for the Haystack staking pool.", {
        details: { appId: state.appId, userAddress: input.userAddress }
      });
    }

    return state;
  },

  async build(
    context: ShapeBuildContext,
    input: HaystackClaimRewardsInput,
    state: HaystackStakingState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Haystack claim.", {
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

    atc.addMethodCall({
      appID: state.appId,
      method: CLAIM_METHOD,
      methodArgs: [],
      sender: input.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams: {
        ...suggestedParams,
        fee: DEFAULT_HAYSTACK_APP_CALL_MAX_FEE,
        flatFee: true
      },
      boxes: [stakingBoxReference(state.appId, state.stakerBoxName)],
      appForeignAssets: [BigInt(state.usdcAssetId), BigInt(state.hayAssetId)]
    });

    let rawTxns: Transaction[];
    try {
      rawTxns = await dependencies.finalizeComposerGroup({
        algod: context.algod,
        atc
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Haystack claim transactions.", {
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
        hayAssetId: state.hayAssetId,
        usdcAssetId: state.usdcAssetId,
        usdcOptInIncluded: !state.userOptedIntoUsdc,
        appCallMaxFee: DEFAULT_HAYSTACK_APP_CALL_MAX_FEE.toString()
      }
    };
  },

  validate(
    group,
    input: HaystackClaimRewardsInput,
    state: HaystackStakingState
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
      hayAssetId: state.hayAssetId,
      stakerBoxNameBase64: Buffer.from(state.stakerBoxName).toString("base64"),
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
  hayAssetId: number;
  stakerBoxNameBase64: string;
  errors: string[];
}): void {
  const { txn, userAddress, appId, usdcAssetId, hayAssetId, stakerBoxNameBase64, errors } = params;
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
    errors.push("Claim app call must call claim()(uint64,uint64).");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(usdcAssetId))) {
    errors.push("Claim app call foreign assets must include USDC.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(hayAssetId))) {
    errors.push("Claim app call foreign assets must include HAY.");
  }
  if (
    !hasStakerBoxReference({
      boxes: txn.applicationCall.boxes,
      appId,
      stakerBoxNameBase64
    })
  ) {
    errors.push("Claim app call must reference the staker box.");
  }
  if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`Claim app call fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

export function buildMockClaimGroup(params: {
  user: algosdk.Account;
  appId: number;
  usdcAssetId: number;
  hayAssetId: number;
  stakerBoxName: Uint8Array;
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
      foreignAssets: [BigInt(params.usdcAssetId), BigInt(params.hayAssetId)],
      boxes: [{ appIndex: BigInt(params.appId), name: params.stakerBoxName }],
      suggestedParams: {
        ...params.suggestedParams,
        fee: DEFAULT_HAYSTACK_APP_CALL_MAX_FEE,
        flatFee: true
      }
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}
