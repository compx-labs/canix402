import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  OnApplicationComplete,
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
  ALPHA_ARCADE_INNER_TXN_FLAT_FEE,
  FIRST_STAKE_ALGO_RESERVE_MICROALGOS,
  MIN_ALGO_FEE
} from "./constants.js";
import { parseAddress, parsePositiveBaseUnitAmount } from "./parse-input.js";
import {
  type AlphaArcadeStakingState,
  resolveAlphaArcadeStakingState
} from "./staking-state.js";
import {
  OPT_IN_METHOD,
  OPT_IN_METHOD_SELECTOR_HEX,
  STAKE_METHOD,
  STAKE_METHOD_SELECTOR_HEX
} from "./staking-spec.js";
import {
  assertGroupedTransactions,
  buildComposerGroup,
  getSuggestedParams,
  readAppCallSelectorHex
} from "./shared.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "alpha-arcade",
  protocolVersion: "v1",
  action: "stake",
  variant: "alpha"
};

export interface AlphaArcadeStakeAlphaInput {
  userAddress: string;
  amount: bigint;
}

export interface AlphaArcadeStakeAlphaDependencies {
  resolveState: typeof resolveAlphaArcadeStakingState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  buildComposerGroup: typeof buildComposerGroup;
}

let dependencyOverrides: Partial<AlphaArcadeStakeAlphaDependencies> | undefined;

export function setAlphaArcadeStakeAlphaDependenciesForTests(
  overrides?: Partial<AlphaArcadeStakeAlphaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): AlphaArcadeStakeAlphaDependencies {
  return {
    resolveState: resolveAlphaArcadeStakingState,
    getSuggestedParams,
    buildComposerGroup,
    ...dependencyOverrides
  };
}

export const alphaArcadeStakeAlphaShape: TransactionShapeSpec<
  AlphaArcadeStakeAlphaInput,
  AlphaArcadeStakingState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Alpha Arcade v1 ALPHA staking deposit",
  description:
    "Stakes ALPHA into the Alpha Arcade fee-sharing pool. Builds optional opt_in() " +
    "(first stake), ALPHA axfer into the pool, then stake(). The ALPHA transfer must " +
    "immediately precede the stake app call.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@alpha-arcade/sdk stakeAlpha — opt_in? + ALPHA axfer + stake()"
    }
  ],

  parseInput(raw: unknown): AlphaArcadeStakeAlphaInput {
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
    input: AlphaArcadeStakeAlphaInput
  ): Promise<AlphaArcadeStakingState> {
    const dependencies = resolveDependencies();
    return dependencies.resolveState({
      network: context.network,
      algod: context.algod,
      userAddress: input.userAddress
    });
  },

  async build(
    context: ShapeBuildContext,
    input: AlphaArcadeStakeAlphaInput,
    state: AlphaArcadeStakingState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings: string[] = [];

    if (input.amount > state.userAlphaBalance) {
      warnings.push(
        `User ALPHA balance (${state.userAlphaBalance.toString()}) is below the requested stake amount.`
      );
    }
    if (!state.local.optedIn) {
      warnings.push(
        `First-time stakers need ~${FIRST_STAKE_ALGO_RESERVE_MICROALGOS.toString()} microAlgos free for app local-state MBR + fees.`
      );
    }

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Alpha Arcade stake.", {
        cause: error
      });
    }

    const atc = new AtomicTransactionComposer();
    const includesOptIn = !state.local.optedIn;

    if (includesOptIn) {
      atc.addMethodCall({
        appID: state.appId,
        method: OPT_IN_METHOD,
        methodArgs: [],
        sender: input.userAddress,
        signer: makeEmptyTransactionSigner(),
        suggestedParams,
        onComplete: OnApplicationComplete.OptInOC
      });
    }

    const alphaTransferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: input.userAddress,
      receiver: state.appAddress,
      assetIndex: state.alphaAssetId,
      amount: input.amount,
      suggestedParams
    });
    atc.addTransaction({ txn: alphaTransferTxn, signer: makeEmptyTransactionSigner() });

    atc.addMethodCall({
      appID: state.appId,
      method: STAKE_METHOD,
      methodArgs: [],
      sender: input.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams,
      appForeignAssets: [state.usdcAssetId]
    });

    let rawTxns: Transaction[];
    try {
      rawTxns = dependencies.buildComposerGroup(atc);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Alpha Arcade stake transactions.", {
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
        amount: input.amount.toString(),
        includesOptIn,
        existingStaker: state.local.optedIn
      }
    };
  },

  validate(
    group,
    input: AlphaArcadeStakeAlphaInput,
    state: AlphaArcadeStakingState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const includesOptIn = !state.local.optedIn;
    const expectedLength = includesOptIn ? 3 : 2;
    if (group.length !== expectedLength) {
      errors.push(`Expected exactly ${expectedLength} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    let cursor = 0;
    if (includesOptIn) {
      validateOptInAppCallTxn({
        txn: group[cursor],
        userAddress: input.userAddress,
        appId: state.appId,
        errors
      });
      cursor += 1;
    }

    validateAlphaTransferTxn({
      txn: group[cursor],
      userAddress: input.userAddress,
      receiver: state.appAddress,
      assetId: state.alphaAssetId,
      amount: input.amount,
      errors
    });
    cursor += 1;

    validateStakeAppCallTxn({
      txn: group[cursor],
      userAddress: input.userAddress,
      appId: state.appId,
      usdcAssetId: state.usdcAssetId,
      errors
    });

    assertGroupedTransactions(group, errors);

    if (!state.local.optedIn) {
      warnings.push("First-time stakers must opt into the staking application.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateOptInAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  appId: number;
  errors: string[];
}): void {
  const { txn, userAddress, appId, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("First transaction must be the opt_in application call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Opt-in app call sender must be the user address.");
  }
  if (txn.applicationCall.appIndex !== String(appId)) {
    errors.push("Opt-in app call must target the staking application.");
  }
  if (readAppCallSelectorHex(txn) !== OPT_IN_METHOD_SELECTOR_HEX) {
    errors.push("Opt-in app call must call opt_in()uint8.");
  }
  if (txn.applicationCall.onComplete !== algosdk.OnApplicationComplete.OptInOC) {
    errors.push("Opt-in app call must use OptIn on-completion.");
  }
}

function validateAlphaTransferTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  receiver: string;
  assetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, userAddress, receiver, assetId, amount, errors } = params;
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push("ALPHA transfer transaction must precede the stake app call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("ALPHA transfer sender must be the user address.");
  }
  if (txn.assetTransfer.receiver !== receiver) {
    errors.push("ALPHA transfer receiver must be the staking application address.");
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push("ALPHA transfer asset must be the ALPHA asset id.");
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push("ALPHA transfer amount must equal the requested stake amount.");
  }
}

function validateStakeAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  appId: number;
  usdcAssetId: number;
  errors: string[];
}): void {
  const { txn, userAddress, appId, usdcAssetId, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("Final transaction must be the stake application call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Stake app call sender must be the user address.");
  }
  if (txn.applicationCall.appIndex !== String(appId)) {
    errors.push("Stake app call must target the staking application.");
  }
  if (readAppCallSelectorHex(txn) !== STAKE_METHOD_SELECTOR_HEX) {
    errors.push("Stake app call must call stake()uint64.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(usdcAssetId))) {
    errors.push("Stake app call foreign assets must include USDC.");
  }
  if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`Stake app call fee must be at least ${MIN_ALGO_FEE.toString()} microAlgos.`);
  }
}

export function buildMockStakeGroup(params: {
  user: algosdk.Account;
  appId: number;
  appAddress: string;
  alphaAssetId: number;
  usdcAssetId: number;
  amount: bigint;
  includeOptIn: boolean;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const txns: Transaction[] = [];
  if (params.includeOptIn) {
    txns.push(
      algosdk.makeApplicationOptInTxnFromObject({
        sender: params.user.addr,
        appIndex: BigInt(params.appId),
        appArgs: [Buffer.from(OPT_IN_METHOD_SELECTOR_HEX, "hex")],
        suggestedParams: params.suggestedParams
      })
    );
  }
  txns.push(
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: params.user.addr,
      receiver: params.appAddress,
      assetIndex: params.alphaAssetId,
      amount: params.amount,
      suggestedParams: params.suggestedParams
    })
  );
  txns.push(
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.appId),
      appArgs: [Buffer.from(STAKE_METHOD_SELECTOR_HEX, "hex")],
      foreignAssets: [BigInt(params.usdcAssetId)],
      suggestedParams: params.suggestedParams
    })
  );
  algosdk.assignGroupID(txns);
  return txns;
}
