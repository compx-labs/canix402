import algosdk, { Algodv2 } from "algosdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import {
  PACT_V201_ADD_LIQUIDITY_SELECTOR,
  PACT_V201_APP_CALL_FEE,
  PactManagedWeightedPoolState,
  assetIdBoxName,
  assertDepositMatchesReserves,
  expectedProportionalMint,
  mapCallerAmountsToPoolAssets,
  nonAlgoForeignAssets,
  resolvePactManagedWeightedPoolState
} from "./managed-weighted-state.js";
import {
  ALGO_ASSET_ID,
  parseAddress,
  parseAssetId,
  parseBaseUnitAmount,
  parsePoolAppId,
  parsePoolId,
  parseSlippageBps
} from "./parse-input.js";

const HIGH_SLIPPAGE_BPS = 500;
const MIN_ALGO_FEE = 1000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "v201",
  action: "addLiquidity",
  variant: "twoSided"
};

export interface PactManagedWeightedAddLiquidityInput {
  userAddress: string;
  poolAppId: number;
  assetAId: number;
  assetAAmount: bigint;
  assetBId: number;
  assetBAmount: bigint;
  maxSlippageBps: number;
  poolId?: string;
}

export interface PactManagedWeightedAddLiquidityDependencies {
  resolvePoolState: typeof resolvePactManagedWeightedPoolState;
  isLpOptedIn: (algod: Algodv2, address: string, assetId: number) => Promise<boolean>;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
}

let dependencyOverrides: Partial<PactManagedWeightedAddLiquidityDependencies> | undefined;

export function setPactManagedWeightedAddLiquidityDependenciesForTests(
  overrides?: Partial<PactManagedWeightedAddLiquidityDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactManagedWeightedAddLiquidityDependencies {
  return {
    resolvePoolState: resolvePactManagedWeightedPoolState,
    isLpOptedIn: defaultIsLpOptedIn,
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    ...dependencyOverrides
  };
}

export const pactManagedWeightedAddLiquidityShape: TransactionShapeSpec<
  PactManagedWeightedAddLiquidityInput,
  PactManagedWeightedPoolState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact v201 two-sided add liquidity",
  description:
    "Adds two-sided liquidity to a Pact managed-weighted pool. Deposits both assets to the " +
    "shared vault, then calls the pool. Includes an LP opt-in when the wallet is not opted in. " +
    "The pool call has no minimum-LP argument; slippage is enforced against pool reserves at quote time.",
  supportedOpportunityTypes: ["lp"],
  opportunityRole: "enter",
  requiredInputs: [
    "userAddress",
    "poolAppId",
    "assetAId",
    "assetAAmount",
    "assetBId",
    "assetBAmount",
    "maxSlippageBps"
  ],
  sources: [
    {
      kind: "docs",
      description: "Mainnet managed-weighted add group (vault deposits + pool app call)"
    }
  ],

  parseInput(raw: unknown): PactManagedWeightedAddLiquidityInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const userAddress = parseAddress(value.userAddress);
    const poolAppId = parsePoolAppId(value.poolAppId);
    const assetAId = parseAssetId(value.assetAId, "assetAId");
    const assetBId = parseAssetId(value.assetBId, "assetBId");
    if (assetAId === assetBId) {
      throw new InvalidShapeInputError("assetAId and assetBId must be different assets.", {
        assetAId,
        assetBId
      });
    }
    const assetAAmount = parseBaseUnitAmount(value.assetAAmount, "assetAAmount");
    const assetBAmount = parseBaseUnitAmount(value.assetBAmount, "assetBAmount");
    const maxSlippageBps = parseSlippageBps(value.maxSlippageBps);
    const poolId = value.poolId === undefined ? undefined : parsePoolId(value.poolId);
    return {
      userAddress,
      poolAppId,
      assetAId,
      assetAAmount,
      assetBId,
      assetBAmount,
      maxSlippageBps,
      ...(poolId === undefined ? {} : { poolId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: PactManagedWeightedAddLiquidityInput
  ): Promise<PactManagedWeightedPoolState> {
    const dependencies = resolveDependencies();
    const state = await dependencies.resolvePoolState({
      algod: context.algod,
      poolAppId: input.poolAppId
    });
    mapCallerAmountsToPoolAssets({
      state,
      assetAId: input.assetAId,
      assetAAmount: input.assetAAmount,
      assetBId: input.assetBId,
      assetBAmount: input.assetBAmount
    });
    const userOptedIntoLp = await dependencies.isLpOptedIn(
      context.algod,
      input.userAddress,
      state.lpAssetId
    );
    return { ...state, userOptedIntoLp };
  },

  async build(
    context: ShapeBuildContext,
    input: PactManagedWeightedAddLiquidityInput,
    state: PactManagedWeightedPoolState
  ): Promise<ShapeBuildResult> {
    const { amountA, amountB } = mapCallerAmountsToPoolAssets({
      state,
      assetAId: input.assetAId,
      assetAAmount: input.assetAAmount,
      assetBId: input.assetBId,
      assetBAmount: input.assetBAmount
    });
    assertDepositMatchesReserves({
      amountA,
      amountB,
      reserveA: state.reserveA,
      reserveB: state.reserveB,
      maxSlippageBps: input.maxSlippageBps
    });

    const dependencies = resolveDependencies();
    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Pact add liquidity.", {
        cause: error
      });
    }

    const includeOptIn = state.userOptedIntoLp !== true;
    const txns: algosdk.Transaction[] = [];
    if (includeOptIn) {
      txns.push(
        algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: input.userAddress,
          receiver: input.userAddress,
          assetIndex: state.lpAssetId,
          amount: 0n,
          suggestedParams: withFlatFee(suggestedParams, MIN_ALGO_FEE)
        })
      );
    }
    txns.push(
      makeDepositTxn({
        sender: input.userAddress,
        receiver: state.vaultAddress,
        assetId: state.assetAId,
        amount: amountA,
        suggestedParams
      }),
      makeDepositTxn({
        sender: input.userAddress,
        receiver: state.vaultAddress,
        assetId: state.assetBId,
        amount: amountB,
        suggestedParams
      }),
      makeAddAppCall({
        sender: input.userAddress,
        state,
        suggestedParams
      })
    );
    algosdk.assignGroupID(txns);

    const expectedMint = expectedProportionalMint({
      amountA,
      amountB,
      reserveA: state.reserveA,
      reserveB: state.reserveB,
      issuedLp: state.issuedLp
    });
    const warnings: string[] = [
      "The managed-weighted add call does not take a minimum LP amount. Slippage is checked against reserves before the group is returned."
    ];
    if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
      warnings.push(
        `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
      );
    }
    if (includeOptIn) {
      warnings.push("Group includes a zero-amount LP opt-in. The wallet must cover the ASA minimum balance.");
    }

    return {
      transactions: normalizeTransactions(txns),
      warnings,
      metadata: {
        poolAppId: state.poolAppId,
        vaultAppId: state.vaultAppId,
        vaultAddress: state.vaultAddress,
        poolAddress: state.poolAddress,
        liquidityAssetId: state.lpAssetId,
        assetAId: state.assetAId,
        assetBId: state.assetBId,
        amountAIn: amountA.toString(),
        amountBIn: amountB.toString(),
        expectedMintedLiquidityTokens: expectedMint.toString(),
        weightA: state.weightA.toString(),
        swapFeeBps: state.swapFeeBps.toString(),
        addLiquidityAppFee: Number(PACT_V201_APP_CALL_FEE),
        includedLpOptIn: includeOptIn,
        slippageBps: input.maxSlippageBps,
        ...(input.poolId === undefined ? {} : { poolId: input.poolId })
      }
    };
  },

  validate(group, input, state): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const includeOptIn = state.userOptedIntoLp !== true;
    const expectedLength = includeOptIn ? 4 : 3;
    if (group.length !== expectedLength) {
      errors.push(`Expected exactly ${expectedLength} transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const { amountA, amountB } = mapCallerAmountsToPoolAssets({
      state,
      assetAId: input.assetAId,
      assetAAmount: input.assetAAmount,
      assetBId: input.assetBId,
      assetBAmount: input.assetBAmount
    });

    let index = 0;
    if (includeOptIn) {
      const optIn = group[index];
      index += 1;
      if (optIn === undefined || optIn.type !== "axfer" || !optIn.assetTransfer) {
        errors.push("Opt-in transaction must be a zero-amount LP asset transfer to the sender.");
      } else {
        if (optIn.sender !== input.userAddress || optIn.assetTransfer.receiver !== input.userAddress) {
          errors.push("LP opt-in sender and receiver must be the user address.");
        }
        if (optIn.assetTransfer.assetIndex !== String(state.lpAssetId)) {
          errors.push("LP opt-in asset must be the pool LP token.");
        }
        if (optIn.assetTransfer.amount !== "0") {
          errors.push("LP opt-in amount must be zero.");
        }
      }
    }

    validateDeposit({
      txn: group[index],
      label: "Asset A deposit",
      userAddress: input.userAddress,
      receiver: state.vaultAddress,
      assetId: state.assetAId,
      amount: amountA,
      errors
    });
    validateDeposit({
      txn: group[index + 1],
      label: "Asset B deposit",
      userAddress: input.userAddress,
      receiver: state.vaultAddress,
      assetId: state.assetBId,
      amount: amountB,
      errors
    });

    const appTxn = group[index + 2];
    if (appTxn === undefined || appTxn.type !== "appl" || !appTxn.applicationCall) {
      errors.push("Final transaction must be an application call.");
    } else {
      const call = appTxn.applicationCall;
      if (appTxn.sender !== input.userAddress) {
        errors.push("Add-liquidity app call sender must be the user address.");
      }
      if (call.appIndex !== String(state.poolAppId)) {
        errors.push(`Add-liquidity app call must target pool ${state.poolAppId}.`);
      }
      if (call.appArgsBase64[0] !== Buffer.from(PACT_V201_ADD_LIQUIDITY_SELECTOR).toString("base64")) {
        errors.push("Add-liquidity app call selector does not match the managed-weighted pool.");
      }
      if (call.appArgsBase64.length !== 1) {
        errors.push("Add-liquidity app call must have no arguments beyond the selector.");
      }
      if (!call.foreignApps.includes(String(state.vaultAppId))) {
        errors.push("Add-liquidity app call must include the vault foreign app.");
      }
      for (const assetId of [state.assetAId, state.assetBId]) {
        if (assetId === ALGO_ASSET_ID) {
          continue;
        }
        if (!call.foreignAssets.includes(String(assetId))) {
          errors.push(`Add-liquidity app call must include foreign asset ${assetId}.`);
        }
      }
      if (!call.foreignAssets.includes(String(state.lpAssetId))) {
        errors.push("Add-liquidity app call must include the LP asset.");
      }
      const expectedBoxes = [state.assetAId, state.assetBId].map((assetId) =>
        Buffer.from(assetIdBoxName(assetId)).toString("base64")
      );
      const boxNames = call.boxes.map((box) => box.nameBase64);
      if (boxNames.length !== expectedBoxes.length || expectedBoxes.some((name, i) => boxNames[i] !== name)) {
        errors.push("Add-liquidity box refs must be the pool asset ids on the vault app.");
      }
      if (call.boxes.some((box) => box.appIndex !== String(state.vaultAppId))) {
        errors.push("Add-liquidity box refs must target the vault app.");
      }
      if (BigInt(appTxn.fee) < PACT_V201_APP_CALL_FEE) {
        errors.push(
          `Add-liquidity app call fee must be at least ${PACT_V201_APP_CALL_FEE} microAlgos.`
        );
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function makeDepositTxn(params: {
  sender: string;
  receiver: string;
  assetId: number;
  amount: bigint;
  suggestedParams: algosdk.SuggestedParams;
}): algosdk.Transaction {
  const suggestedParams = withFlatFee(params.suggestedParams, MIN_ALGO_FEE);
  if (params.assetId === ALGO_ASSET_ID) {
    return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: params.sender,
      receiver: params.receiver,
      amount: params.amount,
      suggestedParams
    });
  }
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.sender,
    receiver: params.receiver,
    assetIndex: params.assetId,
    amount: params.amount,
    suggestedParams
  });
}

function makeAddAppCall(params: {
  sender: string;
  state: PactManagedWeightedPoolState;
  suggestedParams: algosdk.SuggestedParams;
}): algosdk.Transaction {
  const foreignAssets = [...nonAlgoForeignAssets(params.state), BigInt(params.state.lpAssetId)];
  return algosdk.makeApplicationCallTxnFromObject({
    sender: params.sender,
    appIndex: BigInt(params.state.poolAppId),
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [PACT_V201_ADD_LIQUIDITY_SELECTOR],
    foreignApps: [BigInt(params.state.vaultAppId)],
    foreignAssets,
    boxes: [params.state.assetAId, params.state.assetBId].map((assetId) => ({
      appIndex: BigInt(params.state.vaultAppId),
      name: assetIdBoxName(assetId)
    })),
    suggestedParams: withFlatFee(params.suggestedParams, PACT_V201_APP_CALL_FEE)
  });
}

function withFlatFee(
  suggestedParams: algosdk.SuggestedParams,
  fee: bigint
): algosdk.SuggestedParams {
  return { ...suggestedParams, fee, flatFee: true };
}

function validateDeposit(params: {
  txn: import("../../types.js").SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  receiver: string;
  assetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, label, userAddress, receiver, assetId, amount, errors } = params;
  if (assetId === ALGO_ASSET_ID) {
    if (txn === undefined || txn.type !== "pay" || !txn.payment) {
      errors.push(`${label} must be an ALGO payment to the vault.`);
      return;
    }
    if (txn.sender !== userAddress) {
      errors.push(`${label} sender must be the user address.`);
    }
    if (txn.payment.receiver !== receiver) {
      errors.push(`${label} receiver must be the vault address.`);
    }
    if (txn.payment.amount !== amount.toString()) {
      errors.push(`${label} amount must equal the pool asset amount.`);
    }
    return;
  }
  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push(`${label} must be an asset transfer to the vault.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.assetTransfer.receiver !== receiver) {
    errors.push(`${label} receiver must be the vault address.`);
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push(`${label} asset must be ${assetId}.`);
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push(`${label} amount must equal the pool asset amount.`);
  }
}

async function defaultIsLpOptedIn(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<boolean> {
  const account = await algod.accountInformation(address).do();
  return (account.assets ?? []).some((asset) => Number(asset.assetId) === assetId);
}
