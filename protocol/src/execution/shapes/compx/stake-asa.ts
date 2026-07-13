import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
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
import {
  STAKE_METHOD,
  STAKE_METHOD_SELECTOR_HEX,
  STAKER_BOX_MBR_MICROALGOS
} from "./staking-spec.js";
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
  action: "stake",
  variant: "asa"
};

export interface CompXStakeAsaInput {
  userAddress: string;
  poolAppId: number;
  amount: bigint;
  poolId?: string;
}

export interface CompXStakeAsaDependencies {
  resolvePoolState: typeof resolveCompXStakingPoolState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeComposerGroup;
}

let dependencyOverrides: Partial<CompXStakeAsaDependencies> | undefined;

export function setCompXStakeAsaDependenciesForTests(
  overrides?: Partial<CompXStakeAsaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): CompXStakeAsaDependencies {
  return {
    resolvePoolState: resolveCompXStakingPoolState,
    getSuggestedParams,
    finalizeComposerGroup,
    ...dependencyOverrides
  };
}

export const compxStakeAsaShape: TransactionShapeSpec<
  CompXStakeAsaInput,
  CompXStakingPoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "CompX v1 ASA staking deposit",
  description:
    "Stakes an ASA into a CompX staking pool. Builds stake(axfer,uint64,pay)void from the " +
    "ARC-56 spec: staked-asset transfer, optional staker-box MBR payment, and stake app call.",
  supportedOpportunityTypes: ["staking"],
  requiredInputs: ["userAddress", "poolAppId", "amount"],
  sources: [
    {
      kind: "arc56",
      description: "protocol/src/staking.arc56.json stake(axfer,uint64,pay)void"
    }
  ],

  parseInput(raw: unknown): CompXStakeAsaInput {
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
    input: CompXStakeAsaInput
  ): Promise<CompXStakingPoolState> {
    const dependencies = resolveDependencies();
    return dependencies.resolvePoolState({
      network: context.network,
      algod: context.algod,
      poolAppId: input.poolAppId,
      userAddress: input.userAddress,
      ...(context.now === undefined ? {} : { now: context.now })
    });
  },

  async build(
    context: ShapeBuildContext,
    input: CompXStakeAsaInput,
    state: CompXStakingPoolState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userStakedBalance) {
      warnings.push(
        `User staked-asset balance (${state.userStakedBalance.toString()}) is below the requested stake amount.`
      );
    }

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for CompX stake.", {
        cause: error
      });
    }

    const mbrAmount = state.staker.hasBox ? 0n : STAKER_BOX_MBR_MICROALGOS;
    const atc = new AtomicTransactionComposer();

    const stakeTransferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: input.userAddress,
      receiver: state.poolAppAddress,
      assetIndex: state.stakedAssetId,
      amount: input.amount,
      suggestedParams
    });
    atc.addTransaction({ txn: stakeTransferTxn, signer: makeEmptyTransactionSigner() });

    const mbrPaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: input.userAddress,
      receiver: state.poolAppAddress,
      amount: mbrAmount,
      suggestedParams
    });
    atc.addTransaction({ txn: mbrPaymentTxn, signer: makeEmptyTransactionSigner() });

    atc.addMethodCall({
      appID: state.poolAppId,
      method: STAKE_METHOD,
      methodArgs: [
        { txn: stakeTransferTxn, signer: makeEmptyTransactionSigner() },
        input.amount,
        { txn: mbrPaymentTxn, signer: makeEmptyTransactionSigner() }
      ],
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
      throw new ShapeBuildError("Failed to generate CompX staking transactions.", {
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
        stakerBoxMbr: mbrAmount.toString(),
        existingStaker: state.staker.hasBox,
        appCallMaxFee: DEFAULT_COMPX_APP_CALL_MAX_FEE.toString(),
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(
    group,
    input: CompXStakeAsaInput,
    state: CompXStakingPoolState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 3) {
      errors.push(`Expected exactly 3 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [stakeTxn, mbrTxn, appTxn] = group;
    validateStakeTransferTxn({
      txn: stakeTxn,
      userAddress: input.userAddress,
      receiver: state.poolAppAddress,
      assetId: state.stakedAssetId,
      amount: input.amount,
      errors
    });
    validateMbrPaymentTxn({
      txn: mbrTxn,
      userAddress: input.userAddress,
      receiver: state.poolAppAddress,
      amount: state.staker.hasBox ? 0n : STAKER_BOX_MBR_MICROALGOS,
      errors
    });
    validateStakeAppCallTxn({
      txn: appTxn,
      userAddress: input.userAddress,
      poolAppId: state.poolAppId,
      stakedAssetId: state.stakedAssetId,
      rewardAssetId: state.rewardAssetId,
      stakerBoxNameBase64: Buffer.from(state.stakerBoxName).toString("base64"),
      errors
    });

    assertGroupedTransactions(group, errors);

    if (!state.staker.hasBox) {
      warnings.push("First-time stakers must fund the staker box MBR payment.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateStakeTransferTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  receiver: string;
  assetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, userAddress, receiver, assetId, amount, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push("Transaction 1 must be the staked asset transfer.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Transaction 1 sender must be the user address.");
  }
  if (txn.assetTransfer.receiver !== receiver) {
    errors.push("Transaction 1 receiver must be the staking pool application address.");
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push("Transaction 1 asset must be the staked asset id.");
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push("Transaction 1 amount must equal the requested stake amount.");
  }
}

function validateMbrPaymentTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  receiver: string;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, userAddress, receiver, amount, errors } = params;
  if (txn === undefined || txn.type !== "pay" || !txn.payment) {
    errors.push("Transaction 2 must be the staker box MBR payment.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Transaction 2 sender must be the user address.");
  }
  if (txn.payment.receiver !== receiver) {
    errors.push("Transaction 2 receiver must be the staking pool application address.");
  }
  if (txn.payment.amount !== amount.toString()) {
    errors.push("Transaction 2 amount must equal the required staker box MBR.");
  }
}

function validateStakeAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  poolAppId: number;
  stakedAssetId: number;
  rewardAssetId: number;
  stakerBoxNameBase64: string;
  errors: string[];
}): void {
  const { txn, userAddress, poolAppId, stakedAssetId, rewardAssetId, stakerBoxNameBase64, errors } =
    params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("Transaction 3 must be the stake application call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Transaction 3 sender must be the user address.");
  }
  if (txn.applicationCall.appIndex !== String(poolAppId)) {
    errors.push("Transaction 3 must call the staking pool app.");
  }
  if (readAppCallSelectorHex(txn) !== STAKE_METHOD_SELECTOR_HEX) {
    errors.push("Transaction 3 must call stake(axfer,uint64,pay)void.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(stakedAssetId))) {
    errors.push("Transaction 3 foreign assets must include the staked asset.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(rewardAssetId))) {
    errors.push("Transaction 3 foreign assets must include the reward asset.");
  }
  if (
    !hasStakerBoxReference({
      boxes: txn.applicationCall.boxes,
      poolAppId,
      stakerBoxNameBase64
    })
  ) {
    errors.push("Transaction 3 must reference the staker box.");
  }
  if (BigInt(txn.fee) < DEFAULT_COMPX_APP_CALL_MAX_FEE) {
    errors.push(
      `Transaction 3 fee must be at least ${DEFAULT_COMPX_APP_CALL_MAX_FEE.toString()} microAlgos.`
    );
  } else if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`Transaction 3 fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

export function buildMockStakeGroup(params: {
  user: algosdk.Account;
  poolAppId: number;
  poolAppAddress: string;
  stakedAssetId: number;
  rewardAssetId: number;
  amount: bigint;
  mbrAmount: bigint;
  stakerBoxName: Uint8Array;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const stakeTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.user.addr,
    receiver: params.poolAppAddress,
    assetIndex: params.stakedAssetId,
    amount: params.amount,
    suggestedParams: params.suggestedParams
  });
  const mbrTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: params.user.addr,
    receiver: params.poolAppAddress,
    amount: params.mbrAmount,
    suggestedParams: params.suggestedParams
  });
  const appTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender: params.user.addr,
    appIndex: BigInt(params.poolAppId),
    appArgs: [Buffer.from(STAKE_METHOD_SELECTOR_HEX, "hex")],
    foreignAssets: [BigInt(params.stakedAssetId), BigInt(params.rewardAssetId)],
    boxes: [{ appIndex: BigInt(params.poolAppId), name: params.stakerBoxName }],
    suggestedParams: {
      ...params.suggestedParams,
      fee: DEFAULT_COMPX_APP_CALL_MAX_FEE,
      flatFee: true
    }
  });
  const group = [stakeTxn, mbrTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}
