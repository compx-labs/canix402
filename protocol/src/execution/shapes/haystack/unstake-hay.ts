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
import { parseAddress, parsePositiveBaseUnitAmount } from "./parse-input.js";
import { type HaystackStakingState, resolveHaystackStakingState } from "./staking-state.js";
import {
  UNSTAKE_HAY_AND_CLAIM_METHOD,
  UNSTAKE_HAY_AND_CLAIM_METHOD_SELECTOR_HEX
} from "./staking-spec.js";
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
  action: "unstake",
  variant: "hay"
};

export interface HaystackUnstakeHayInput {
  userAddress: string;
  amount: bigint;
}

export interface HaystackUnstakeHayDependencies {
  resolveState: typeof resolveHaystackStakingState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeComposerGroup;
}

let dependencyOverrides: Partial<HaystackUnstakeHayDependencies> | undefined;

export function setHaystackUnstakeHayDependenciesForTests(
  overrides?: Partial<HaystackUnstakeHayDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HaystackUnstakeHayDependencies {
  return {
    resolveState: resolveHaystackStakingState,
    getSuggestedParams,
    finalizeComposerGroup,
    ...dependencyOverrides
  };
}

export const haystackUnstakeHayShape: TransactionShapeSpec<
  HaystackUnstakeHayInput,
  HaystackStakingState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Haystack v1 HAY staking withdraw",
  description:
    "Unstakes HAY from the Haystack staking pool and claims pending USDC and HAY rewards via " +
    "unstakeHayAndClaim(uint64)(uint64,uint64). Prefixes a USDC opt-in when the user is not " +
    "yet opted into USDC.",
  supportedOpportunityTypes: ["staking"],
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "arc56",
      description:
        "protocol/src/haystack-staking.arc56.json unstakeHayAndClaim(uint64)(uint64,uint64)"
    }
  ],

  parseInput(raw: unknown): HaystackUnstakeHayInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseAddress(value.userAddress),
      amount: parsePositiveBaseUnitAmount(value.amount, "amount")
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: HaystackUnstakeHayInput
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

    if (input.amount > state.staker.stake) {
      throw new ShapeStateError("Requested unstake amount exceeds the resolved staked balance.", {
        details: {
          requested: input.amount.toString(),
          stakedBalance: state.staker.stake.toString()
        }
      });
    }

    return state;
  },

  async build(
    context: ShapeBuildContext,
    input: HaystackUnstakeHayInput,
    state: HaystackStakingState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Haystack unstake.", {
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
      method: UNSTAKE_HAY_AND_CLAIM_METHOD,
      methodArgs: [input.amount],
      sender: input.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams: {
        ...suggestedParams,
        fee: DEFAULT_HAYSTACK_APP_CALL_MAX_FEE,
        flatFee: true
      },
      boxes: [stakingBoxReference(state.appId, state.stakerBoxName)],
      appForeignAssets: [BigInt(state.hayAssetId), BigInt(state.usdcAssetId)]
    });

    let rawTxns: Transaction[];
    try {
      rawTxns = await dependencies.finalizeComposerGroup({
        algod: context.algod,
        atc
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Haystack unstake transactions.", {
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
        amount: input.amount.toString(),
        stakedBalance: state.staker.stake.toString(),
        usdcOptInIncluded: !state.userOptedIntoUsdc,
        claimsRewards: true,
        appCallMaxFee: DEFAULT_HAYSTACK_APP_CALL_MAX_FEE.toString()
      }
    };
  },

  validate(
    group,
    input: HaystackUnstakeHayInput,
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

    validateUnstakeAppCallTxn({
      txn: group[appIndex],
      userAddress: input.userAddress,
      appId: state.appId,
      hayAssetId: state.hayAssetId,
      usdcAssetId: state.usdcAssetId,
      amount: input.amount,
      stakerBoxNameBase64: Buffer.from(state.stakerBoxName).toString("base64"),
      errors
    });

    assertGroupedTransactions(group, errors);

    if (input.amount > state.staker.stake) {
      warnings.push("Requested unstake amount exceeds the resolved staked balance.");
    }

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

function validateUnstakeAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  appId: number;
  hayAssetId: number;
  usdcAssetId: number;
  amount: bigint;
  stakerBoxNameBase64: string;
  errors: string[];
}): void {
  const {
    txn,
    userAddress,
    appId,
    hayAssetId,
    usdcAssetId,
    amount,
    stakerBoxNameBase64,
    errors
  } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("Final transaction must be the unstakeHayAndClaim application call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Unstake app call sender must be the user address.");
  }
  if (txn.applicationCall.appIndex !== String(appId)) {
    errors.push("Unstake app call must target the staking application.");
  }
  if (readAppCallSelectorHex(txn) !== UNSTAKE_HAY_AND_CLAIM_METHOD_SELECTOR_HEX) {
    errors.push("Unstake app call must call unstakeHayAndClaim(uint64)(uint64,uint64).");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(hayAssetId))) {
    errors.push("Unstake app call foreign assets must include HAY.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(usdcAssetId))) {
    errors.push("Unstake app call foreign assets must include USDC.");
  }
  if (
    !hasStakerBoxReference({
      boxes: txn.applicationCall.boxes,
      appId,
      stakerBoxNameBase64
    })
  ) {
    errors.push("Unstake app call must reference the staker box.");
  }
  const amountArg = txn.applicationCall.appArgsBase64[1];
  if (amountArg === undefined) {
    errors.push("Unstake app call must include the amount argument.");
  } else if (Buffer.from(amountArg, "base64").readBigUInt64BE() !== amount) {
    errors.push("Unstake app call amount must equal the requested amount.");
  }
  if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`Unstake app call fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

export function buildMockUnstakeGroup(params: {
  user: algosdk.Account;
  appId: number;
  hayAssetId: number;
  usdcAssetId: number;
  amount: bigint;
  stakerBoxName: Uint8Array;
  includeUsdcOptIn?: boolean;
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
      appArgs: [
        Buffer.from(UNSTAKE_HAY_AND_CLAIM_METHOD_SELECTOR_HEX, "hex"),
        algosdk.encodeUint64(params.amount)
      ],
      foreignAssets: [BigInt(params.hayAssetId), BigInt(params.usdcAssetId)],
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
