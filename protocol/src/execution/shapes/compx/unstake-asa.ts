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
import {
  parseAddress,
  parseOptionalPoolId,
  parsePoolSelector,
  parsePositiveBaseUnitAmount
} from "./parse-input.js";
import {
  type CompXStakingPoolState,
  resolveCompXStakingPoolState
} from "./pool-state.js";
import { UNSTAKE_METHOD, UNSTAKE_METHOD_SELECTOR_HEX } from "./staking-spec.js";
import {
  addAssetOptInToComposer,
  finalizeComposerGroup,
  stakingBoxReference
} from "./staking-build.js";
import {
  DEFAULT_COMPX_APP_CALL_MAX_FEE,
  MIN_ALGO_FEE,
  assertGroupedTransactions,
  getSuggestedParams,
  readAppCallSelectorHex,
  hasStakerBoxReference
} from "./shared.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "compx",
  protocolVersion: "v1",
  action: "unstake",
  variant: "asa"
};

export interface CompXUnstakeAsaInput {
  userAddress: string;
  poolAppId: number;
  amount: bigint;
  poolId?: string;
}

export interface CompXUnstakeAsaDependencies {
  resolvePoolState: typeof resolveCompXStakingPoolState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeComposerGroup;
}

let dependencyOverrides: Partial<CompXUnstakeAsaDependencies> | undefined;

export function setCompXUnstakeAsaDependenciesForTests(
  overrides?: Partial<CompXUnstakeAsaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): CompXUnstakeAsaDependencies {
  return {
    resolvePoolState: resolveCompXStakingPoolState,
    getSuggestedParams,
    finalizeComposerGroup,
    ...dependencyOverrides
  };
}

export const compxUnstakeAsaShape: TransactionShapeSpec<
  CompXUnstakeAsaInput,
  CompXStakingPoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "CompX v1 ASA staking withdraw",
  description:
    "Unstakes ASA from a CompX staking pool via unstake(uint64)void. Optionally prefixes " +
    "a reward-asset opt-in when the user is not yet opted in.",
  supportedOpportunityTypes: ["staking"],
  requiredInputs: ["userAddress", "poolAppId", "amount"],
  sources: [
    {
      kind: "arc56",
      description: "protocol/src/staking.arc56.json unstake(uint64)void"
    }
  ],

  parseInput(raw: unknown): CompXUnstakeAsaInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const poolId = parseOptionalPoolId(value.poolId);

    return {
      userAddress: parseAddress(value.userAddress),
      amount: parsePositiveBaseUnitAmount(value.amount, "amount"),
      ...parsePoolSelector(value),
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: CompXUnstakeAsaInput
  ): Promise<CompXStakingPoolState> {
    const dependencies = resolveDependencies();
    const state = await dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      poolAppId: input.poolAppId,
      userAddress: input.userAddress,
      ...(context.now === undefined ? {} : { now: context.now })
    });

    if (!state.staker.hasBox) {
      throw new ShapeStateError("User has no staker box for this CompX staking pool.", {
        details: { poolAppId: input.poolAppId, userAddress: input.userAddress }
      });
    }

    if (input.amount > state.staker.stake) {
      throw new ShapeStateError("Requested unstake amount exceeds the resolved staker balance.", {
        details: {
          requested: input.amount.toString(),
          stakerBalance: state.staker.stake.toString()
        }
      });
    }

    return state;
  },

  async build(
    context: ShapeBuildContext,
    input: CompXUnstakeAsaInput,
    state: CompXStakingPoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for CompX unstake.", {
        cause: error
      });
    }

    const atc = new AtomicTransactionComposer();
    if (!state.userOptedIntoRewardAsset) {
      addAssetOptInToComposer({
        atc,
        sender: input.userAddress,
        assetId: state.rewardAssetId,
        suggestedParams
      });
      warnings.push("Reward asset opt-in is included; user must sign the opt-in transaction.");
    }

    atc.addMethodCall({
      appID: state.poolAppId,
      method: UNSTAKE_METHOD,
      methodArgs: [input.amount],
      sender: input.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams: {
        ...suggestedParams,
        fee: DEFAULT_COMPX_APP_CALL_MAX_FEE,
        flatFee: true
      },
      boxes: [stakingBoxReference(state.poolAppId, state.stakerBoxName)],
      appForeignAssets: [BigInt(state.stakedAssetId), BigInt(state.rewardAssetId)]
    });

    let rawTxns: Transaction[];
    try {
      rawTxns = await dependencies.finalizeComposerGroup({
        algod: context.algod,
        atc
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate CompX unstake transactions.", {
        cause: error
      });
    }

    const transactions = normalizeTransactions(rawTxns);
    algosdk.assignGroupID(transactions);

    return {
      transactions,
      warnings,
      metadata: {
        poolAppId: state.poolAppId,
        poolAppAddress: state.poolAppAddress,
        stakedAssetId: state.stakedAssetId,
        rewardAssetId: state.rewardAssetId,
        amount: input.amount.toString(),
        stakerBalance: state.staker.stake.toString(),
        rewardOptInIncluded: !state.userOptedIntoRewardAsset,
        appCallMaxFee: DEFAULT_COMPX_APP_CALL_MAX_FEE.toString(),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: CompXUnstakeAsaInput,
    state: CompXStakingPoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const includesRewardOptIn = !state.userOptedIntoRewardAsset;
    const expectedLength = includesRewardOptIn ? 2 : 1;
    if (group.length !== expectedLength) {
      errors.push(`Expected exactly ${expectedLength} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    let appIndex = 0;
    if (includesRewardOptIn) {
      validateRewardOptInTxn({
        txn: group[0],
        userAddress: input.userAddress,
        rewardAssetId: state.rewardAssetId,
        errors
      });
      appIndex = 1;
    }

    validateUnstakeAppCallTxn({
      txn: group[appIndex],
      userAddress: input.userAddress,
      poolAppId: state.poolAppId,
      stakedAssetId: state.stakedAssetId,
      rewardAssetId: state.rewardAssetId,
      amount: input.amount,
      stakerBoxNameBase64: Buffer.from(state.stakerBoxName).toString("base64"),
      errors
    });

    assertGroupedTransactions(group, errors);

    if (input.amount > state.staker.stake) {
      warnings.push("Requested unstake amount exceeds the resolved staker balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateRewardOptInTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  rewardAssetId: number;
  errors: string[];
}): void {
  const { txn, userAddress, rewardAssetId, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push("Transaction 1 must be a reward asset opt-in transfer.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Transaction 1 sender must be the user address.");
  }
  if (txn.assetTransfer.receiver !== userAddress) {
    errors.push("Transaction 1 receiver must be the user address for opt-in.");
  }
  if (txn.assetTransfer.assetIndex !== String(rewardAssetId)) {
    errors.push("Transaction 1 must opt into the reward asset.");
  }
  if (txn.assetTransfer.amount !== "0") {
    errors.push("Transaction 1 opt-in amount must be zero.");
  }
}

function validateUnstakeAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  poolAppId: number;
  stakedAssetId: number;
  rewardAssetId: number;
  amount: bigint;
  stakerBoxNameBase64: string;
  errors: string[];
}): void {
  const {
    txn,
    userAddress,
    poolAppId,
    stakedAssetId,
    rewardAssetId,
    amount,
    stakerBoxNameBase64,
    errors
  } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("Final transaction must be the unstake application call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Unstake app call sender must be the user address.");
  }
  if (txn.applicationCall.appIndex !== String(poolAppId)) {
    errors.push("Unstake app call must target the staking pool application.");
  }
  if (readAppCallSelectorHex(txn) !== UNSTAKE_METHOD_SELECTOR_HEX) {
    errors.push("Unstake app call must call unstake(uint64)void.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(stakedAssetId))) {
    errors.push("Unstake app call foreign assets must include the staked asset.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(rewardAssetId))) {
    errors.push("Unstake app call foreign assets must include the reward asset.");
  }
  const hasStakerBox = hasStakerBoxReference({
    boxes: txn.applicationCall.boxes,
    poolAppId,
    stakerBoxNameBase64
  });
  if (!hasStakerBox) {
    errors.push("Unstake app call must reference the staker box.");
  }
  const quantityArg = txn.applicationCall.appArgsBase64[1];
  if (quantityArg === undefined) {
    errors.push("Unstake app call must include the quantity argument.");
  } else if (Buffer.from(quantityArg, "base64").readBigUInt64BE() !== amount) {
    errors.push("Unstake app call quantity must equal the requested amount.");
  }
  if (BigInt(txn.fee) < DEFAULT_COMPX_APP_CALL_MAX_FEE) {
    errors.push(
      `Unstake app call fee must be at least ${DEFAULT_COMPX_APP_CALL_MAX_FEE.toString()} microAlgos.`
    );
  } else if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`Unstake app call fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

export function buildMockUnstakeGroup(params: {
  user: algosdk.Account;
  poolAppId: number;
  stakedAssetId: number;
  rewardAssetId: number;
  amount: bigint;
  stakerBoxName: Uint8Array;
  includeRewardOptIn: boolean;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const txns: Transaction[] = [];
  if (params.includeRewardOptIn) {
    txns.push(
      algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: params.user.addr,
        receiver: params.user.addr,
        assetIndex: params.rewardAssetId,
        amount: 0n,
        suggestedParams: params.suggestedParams
      })
    );
  }
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.poolAppId),
      appArgs: [
        Buffer.from(UNSTAKE_METHOD_SELECTOR_HEX, "hex"),
        algosdk.encodeUint64(params.amount)
      ],
      foreignAssets: [BigInt(params.stakedAssetId), BigInt(params.rewardAssetId)],
      boxes: [{ appIndex: BigInt(params.poolAppId), name: params.stakerBoxName }],
      suggestedParams: {
        ...params.suggestedParams,
        fee: DEFAULT_COMPX_APP_CALL_MAX_FEE,
        flatFee: true
      }
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}
