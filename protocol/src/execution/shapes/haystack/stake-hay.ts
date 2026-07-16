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
import { DEFAULT_HAYSTACK_APP_CALL_MAX_FEE, MIN_ALGO_FEE } from "./constants.js";
import { parseAddress, parsePositiveBaseUnitAmount } from "./parse-input.js";
import {
  type HaystackStakingState,
  resolveHaystackStakingState
} from "./staking-state.js";
import {
  STAKE_HAY_METHOD,
  STAKE_HAY_METHOD_SELECTOR_HEX
} from "./staking-spec.js";
import {
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
  action: "stake",
  variant: "hay"
};

export interface HaystackStakeHayInput {
  userAddress: string;
  amount: bigint;
}

export interface HaystackStakeHayDependencies {
  resolveState: typeof resolveHaystackStakingState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeComposerGroup;
}

let dependencyOverrides: Partial<HaystackStakeHayDependencies> | undefined;

export function setHaystackStakeHayDependenciesForTests(
  overrides?: Partial<HaystackStakeHayDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HaystackStakeHayDependencies {
  return {
    resolveState: resolveHaystackStakingState,
    getSuggestedParams,
    finalizeComposerGroup,
    ...dependencyOverrides
  };
}

export const haystackStakeHayShape: TransactionShapeSpec<
  HaystackStakeHayInput,
  HaystackStakingState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Haystack v1 HAY staking deposit",
  description:
    "Stakes HAY into the Haystack staking pool. Builds stakeHay(axfer)void from the ARC-56 spec: " +
    "an optional staker-box MBR payment (first stake only), the HAY asset transfer (the ABI arg), " +
    "and the stakeHay app call.",
  supportedOpportunityTypes: ["staking"],
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "arc56",
      description: "protocol/src/haystack-staking.arc56.json stakeHay(axfer)void"
    }
  ],

  parseInput(raw: unknown): HaystackStakeHayInput {
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
    input: HaystackStakeHayInput
  ): Promise<HaystackStakingState> {
    const dependencies = resolveDependencies();
    return dependencies.resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: HaystackStakeHayInput,
    state: HaystackStakingState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userHayBalance) {
      warnings.push(
        `User HAY balance (${state.userHayBalance.toString()}) is below the requested stake amount.`
      );
    }

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Haystack stake.", {
        cause: error
      });
    }

    const includesMbrPayment = state.mbrMicroAlgos > 0n;
    const atc = new AtomicTransactionComposer();

    if (includesMbrPayment) {
      const mbrPaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: input.userAddress,
        receiver: state.appAddress,
        amount: state.mbrMicroAlgos,
        suggestedParams
      });
      atc.addTransaction({ txn: mbrPaymentTxn, signer: makeEmptyTransactionSigner() });
    }

    const hayTransferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: input.userAddress,
      receiver: state.appAddress,
      assetIndex: state.hayAssetId,
      amount: input.amount,
      suggestedParams
    });

    atc.addMethodCall({
      appID: state.appId,
      method: STAKE_HAY_METHOD,
      methodArgs: [{ txn: hayTransferTxn, signer: makeEmptyTransactionSigner() }],
      sender: input.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams: {
        ...suggestedParams,
        fee: DEFAULT_HAYSTACK_APP_CALL_MAX_FEE,
        flatFee: true
      },
      boxes: [stakingBoxReference(state.appId, state.stakerBoxName)],
      appForeignAssets: [BigInt(state.usdcAssetId)]
    });

    let rawTxns: Transaction[];
    try {
      rawTxns = await dependencies.finalizeComposerGroup({
        algod: context.algod,
        atc
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Haystack stake transactions.", {
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
        stakerBoxMbr: state.mbrMicroAlgos.toString(),
        existingStaker: state.staker.hasBox,
        appCallMaxFee: DEFAULT_HAYSTACK_APP_CALL_MAX_FEE.toString()
      }
    };
  },

  validate(
    group,
    input: HaystackStakeHayInput,
    state: HaystackStakingState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const includesMbrPayment = state.mbrMicroAlgos > 0n;
    const expectedLength = includesMbrPayment ? 3 : 2;
    if (group.length !== expectedLength) {
      errors.push(`Expected exactly ${expectedLength} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    let cursor = 0;
    if (includesMbrPayment) {
      validateMbrPaymentTxn({
        txn: group[cursor],
        userAddress: input.userAddress,
        receiver: state.appAddress,
        amount: state.mbrMicroAlgos,
        errors
      });
      cursor += 1;
    }

    validateHayTransferTxn({
      txn: group[cursor],
      userAddress: input.userAddress,
      receiver: state.appAddress,
      assetId: state.hayAssetId,
      amount: input.amount,
      errors
    });
    cursor += 1;

    validateStakeAppCallTxn({
      txn: group[cursor],
      userAddress: input.userAddress,
      appId: state.appId,
      usdcAssetId: state.usdcAssetId,
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

function validateMbrPaymentTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  receiver: string;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, userAddress, receiver, amount, errors } = params;
  if (txn === undefined || txn.type !== "pay" || !txn.payment) {
    errors.push("First transaction must be the staker box MBR payment.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("MBR payment sender must be the user address.");
  }
  if (txn.payment.receiver !== receiver) {
    errors.push("MBR payment receiver must be the staking application address.");
  }
  if (txn.payment.amount !== amount.toString()) {
    errors.push("MBR payment amount must equal the required staker box MBR.");
  }
}

function validateHayTransferTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  receiver: string;
  assetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, userAddress, receiver, assetId, amount, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push("HAY transfer transaction must precede the stake app call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("HAY transfer sender must be the user address.");
  }
  if (txn.assetTransfer.receiver !== receiver) {
    errors.push("HAY transfer receiver must be the staking application address.");
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push("HAY transfer asset must be the HAY asset id.");
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push("HAY transfer amount must equal the requested stake amount.");
  }
}

function validateStakeAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  appId: number;
  usdcAssetId: number;
  stakerBoxNameBase64: string;
  errors: string[];
}): void {
  const { txn, userAddress, appId, usdcAssetId, stakerBoxNameBase64, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("Final transaction must be the stakeHay application call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Stake app call sender must be the user address.");
  }
  if (txn.applicationCall.appIndex !== String(appId)) {
    errors.push("Stake app call must target the staking application.");
  }
  if (readAppCallSelectorHex(txn) !== STAKE_HAY_METHOD_SELECTOR_HEX) {
    errors.push("Stake app call must call stakeHay(axfer)void.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(usdcAssetId))) {
    errors.push("Stake app call foreign assets must include USDC.");
  }
  if (
    !hasStakerBoxReference({
      boxes: txn.applicationCall.boxes,
      appId,
      stakerBoxNameBase64
    })
  ) {
    errors.push("Stake app call must reference the staker box.");
  }
  if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`Stake app call fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

export function buildMockStakeGroup(params: {
  user: algosdk.Account;
  appId: number;
  appAddress: string;
  hayAssetId: number;
  usdcAssetId: number;
  amount: bigint;
  mbrAmount: bigint;
  stakerBoxName: Uint8Array;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const txns: Transaction[] = [];
  if (params.mbrAmount > 0n) {
    txns.push(
      algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: params.user.addr,
        receiver: params.appAddress,
        amount: params.mbrAmount,
        suggestedParams: params.suggestedParams
      })
    );
  }
  txns.push(
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: params.user.addr,
      receiver: params.appAddress,
      assetIndex: params.hayAssetId,
      amount: params.amount,
      suggestedParams: params.suggestedParams
    })
  );
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.appId),
      appArgs: [Buffer.from(STAKE_HAY_METHOD_SELECTOR_HEX, "hex")],
      foreignAssets: [BigInt(params.usdcAssetId)],
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
