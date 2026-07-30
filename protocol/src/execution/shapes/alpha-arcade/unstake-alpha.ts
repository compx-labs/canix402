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
import { parseAddress, parsePositiveBaseUnitAmount } from "./parse-input.js";
import {
  type AlphaArcadeStakingState,
  resolveAlphaArcadeStakingState
} from "./staking-state.js";
import { UNSTAKE_METHOD, UNSTAKE_METHOD_SELECTOR_HEX } from "./staking-spec.js";
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
  action: "unstake",
  variant: "alpha"
};

export interface AlphaArcadeUnstakeAlphaInput {
  userAddress: string;
  amount: bigint;
}

export interface AlphaArcadeUnstakeAlphaDependencies {
  resolveState: typeof resolveAlphaArcadeStakingState;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  buildComposerGroup: typeof buildComposerGroup;
}

let dependencyOverrides: Partial<AlphaArcadeUnstakeAlphaDependencies> | undefined;

export function setAlphaArcadeUnstakeAlphaDependenciesForTests(
  overrides?: Partial<AlphaArcadeUnstakeAlphaDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): AlphaArcadeUnstakeAlphaDependencies {
  return {
    resolveState: resolveAlphaArcadeStakingState,
    getSuggestedParams,
    buildComposerGroup,
    ...dependencyOverrides
  };
}

export const alphaArcadeUnstakeAlphaShape: TransactionShapeSpec<
  AlphaArcadeUnstakeAlphaInput,
  AlphaArcadeStakingState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Alpha Arcade v1 ALPHA staking withdraw",
  description:
    "Unstakes ALPHA from the Alpha Arcade fee-sharing pool via unstake(uint64). " +
    "The contract returns ALPHA via an inner transfer; flat 2000 microAlgo fee.",
  supportedOpportunityTypes: ["staking"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "amount"],
  sources: [
    {
      kind: "sdk",
      description: "@alpha-arcade/sdk unstakeAlpha — unstake(uint64)"
    }
  ],

  parseInput(raw: unknown): AlphaArcadeUnstakeAlphaInput {
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
    input: AlphaArcadeUnstakeAlphaInput
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

    if (input.amount > state.local.staked) {
      throw new ShapeStateError("Requested unstake amount exceeds the resolved staked balance.", {
        details: {
          requested: input.amount.toString(),
          stakedBalance: state.local.staked.toString()
        }
      });
    }

    return state;
  },

  async build(
    context: ShapeBuildContext,
    input: AlphaArcadeUnstakeAlphaInput,
    state: AlphaArcadeStakingState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();

    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Alpha Arcade unstake.", {
        cause: error
      });
    }

    const feeSp: algosdk.SuggestedParams = {
      ...suggestedParams,
      fee: ALPHA_ARCADE_INNER_TXN_FLAT_FEE,
      flatFee: true
    };

    const atc = new AtomicTransactionComposer();
    atc.addMethodCall({
      appID: state.appId,
      method: UNSTAKE_METHOD,
      methodArgs: [input.amount],
      sender: input.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams: feeSp,
      appForeignAssets: [state.usdcAssetId, state.alphaAssetId]
    });

    let rawTxns: Transaction[];
    try {
      rawTxns = dependencies.buildComposerGroup(atc);
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Alpha Arcade unstake transactions.", {
        cause: error
      });
    }

    const transactions = normalizeTransactions(rawTxns);

    return {
      transactions,
      warnings: [],
      metadata: {
        appId: state.appId,
        appAddress: state.appAddress,
        alphaAssetId: state.alphaAssetId,
        usdcAssetId: state.usdcAssetId,
        amount: input.amount.toString(),
        stakedBalance: state.local.staked.toString(),
        appCallFlatFee: ALPHA_ARCADE_INNER_TXN_FLAT_FEE.toString()
      }
    };
  },

  validate(
    group,
    input: AlphaArcadeUnstakeAlphaInput,
    state: AlphaArcadeStakingState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 1) {
      errors.push(`Expected exactly 1 transaction, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    validateUnstakeAppCallTxn({
      txn: group[0],
      userAddress: input.userAddress,
      appId: state.appId,
      alphaAssetId: state.alphaAssetId,
      usdcAssetId: state.usdcAssetId,
      amount: input.amount,
      errors
    });

    assertGroupedTransactions(group, errors);

    if (input.amount > state.local.staked) {
      warnings.push("Requested unstake amount exceeds the resolved staked balance.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateUnstakeAppCallTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  appId: number;
  alphaAssetId: number;
  usdcAssetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, userAddress, appId, alphaAssetId, usdcAssetId, amount, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall) {
    errors.push("Transaction must be the unstake application call.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Unstake app call sender must be the user address.");
  }
  if (txn.applicationCall.appIndex !== String(appId)) {
    errors.push("Unstake app call must target the staking application.");
  }
  if (readAppCallSelectorHex(txn) !== UNSTAKE_METHOD_SELECTOR_HEX) {
    errors.push("Unstake app call must call unstake(uint64)uint64.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(alphaAssetId))) {
    errors.push("Unstake app call foreign assets must include ALPHA.");
  }
  if (!txn.applicationCall.foreignAssets.includes(String(usdcAssetId))) {
    errors.push("Unstake app call foreign assets must include USDC.");
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
  alphaAssetId: number;
  usdcAssetId: number;
  amount: bigint;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const txns = [
    algosdk.makeApplicationNoOpTxnFromObject({
      sender: params.user.addr,
      appIndex: BigInt(params.appId),
      appArgs: [
        Buffer.from(UNSTAKE_METHOD_SELECTOR_HEX, "hex"),
        algosdk.encodeUint64(params.amount)
      ],
      foreignAssets: [BigInt(params.usdcAssetId), BigInt(params.alphaAssetId)],
      suggestedParams: {
        ...params.suggestedParams,
        fee: ALPHA_ARCADE_INNER_TXN_FLAT_FEE,
        flatFee: true
      }
    })
  ];
  algosdk.assignGroupID(txns);
  return txns;
}
