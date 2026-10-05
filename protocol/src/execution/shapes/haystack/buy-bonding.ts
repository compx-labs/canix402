import {
  Protocol,
  RouterClient
} from "@txnlab/haystack-router";
import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  isValidAddress,
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
  encodeUnsignedTransactionBase64,
  type ExecutableQuoteGroupTransaction,
  type SerializedTransaction
} from "../../types.js";
import { DEFAULT_DISABLED_HAYSTACK_PROTOCOLS } from "../../../services/haystack-router.js";
import { parseAddress, parsePositiveBaseUnitAmount } from "./parse-input.js";
import {
  BONDING_ON_CURVE,
  HAYSTACK_LAUNCH_APP_CALL_MAX_FEE,
  HAYSTACK_LAUNCH_APP_ID,
  ROUTED_BUY_RESERVE_DENOMINATOR,
  ROUTED_BUY_RESERVE_NUMERATOR
} from "./launch-constants.js";
import {
  readLaunchGlobal,
  readTokenInfoBox,
  readTokenNumForAsset,
  simulateLaunchAbi
} from "./launch-chain.js";
import {
  BUY_WITH_ALGO_LIMIT_METHOD,
  BUY_WITH_ALGO_LIMIT_SELECTOR_HEX,
  BUY_WITH_LIMIT_METHOD,
  BUY_WITH_LIMIT_SELECTOR_HEX,
  MBR_TO_BUY_METHOD,
  TOKENS_RECEIVED_FOR_BUY_METHOD,
  tokenBoxName,
  userHoldingBoxName
} from "./launch-spec.js";
import {
  addAssetOptInToComposer,
  assertGroupedTransactions,
  finalizeComposerGroup,
  getApplicationAddress,
  getSuggestedParams,
  isAssetOptedIn,
  readAppCallSelectorHex,
  stakingBoxReference
} from "./shared.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "haystack",
  protocolVersion: "v1",
  action: "buy",
  variant: "bonding"
};

const ROUTER_TAIL_TXNS = 3;
const MAX_GROUP_SIZE = 16;

export interface HaystackBuyBondingInput {
  userAddress: string;
  tokenNum: number | null;
  assetId: number | null;
  fromAssetId: number;
  amount: bigint;
  slippageBps: number;
}

export interface HaystackBuyBondingState {
  appId: number;
  appAddress: string;
  oracleAppId: number;
  tokenNum: number;
  assetId: number;
  bondingTokenId: number;
  bondingOn: number;
  realTokenReserves: bigint;
  bondingAssetOptedIn: boolean;
  mbrMicroAlgos: bigint;
  /** Tokens a direct payment would receive, before slippage. Null when the buy is routed. */
  directTokensOut: bigint | null;
}

export interface BondingSwapLeg {
  txn: Transaction;
  /** Re-sign this leg after the curve tail is appended. Absent for user-signed legs. */
  authorize?: (txn: Transaction) => Promise<Uint8Array> | Uint8Array;
}

export interface BondingSwapQuote {
  legs: BondingSwapLeg[];
  minOut: bigint;
}

export interface HaystackBuyBondingDependencies {
  resolveState: (
    context: ShapeBuildContext,
    input: HaystackBuyBondingInput
  ) => Promise<HaystackBuyBondingState>;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeComposerGroup;
  quoteBondingSwap: (params: {
    userAddress: string;
    fromAssetId: number;
    bondingTokenId: number;
    amount: bigint;
    slippageBps: number;
  }) => Promise<BondingSwapQuote>;
  tokensReceivedForBuy: (params: {
    algod: Algodv2;
    tokenNum: number;
    bondingIn: bigint;
    sender: string;
  }) => Promise<bigint>;
}

let dependencyOverrides: Partial<HaystackBuyBondingDependencies> | undefined;

export function setHaystackBuyBondingDependenciesForTests(
  overrides?: Partial<HaystackBuyBondingDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HaystackBuyBondingDependencies {
  return {
    resolveState: resolveHaystackBuyBondingState,
    getSuggestedParams,
    finalizeComposerGroup,
    quoteBondingSwap: defaultQuoteBondingSwap,
    tokensReceivedForBuy: defaultTokensReceivedForBuy,
    ...dependencyOverrides
  };
}

export const haystackBuyBondingShape: TransactionShapeSpec<
  HaystackBuyBondingInput,
  HaystackBuyBondingState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Haystack Launch bonding buy",
  description:
    "Buys a token that is still on the HayLaunch curve. Pay the bonding asset directly, or any " +
    "other asset through the Haystack router. A routed buy that would take 90% or more of the " +
    "remaining real reserves is refused — that completing buy has to be in the bonding asset. " +
    "Pass tokenNum, or assetId after the first buy has created the asset map. The balance stays " +
    "virtual until claim; this shape does not opt the wallet into the launched ASA.",
  supportedOpportunityTypes: [],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "tokenNum", "fromAssetId", "amount", "slippageBps"],
  sources: [
    {
      kind: "arc56",
      description: "protocol/src/haystack-launch.arc56.json buyWithLimit / buyWithAlgoWithLimit"
    },
    {
      kind: "sdk",
      description: "@txnlab/haystack-router composable swap into the bonding asset"
    }
  ],

  parseInput(raw: unknown): HaystackBuyBondingInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const tokenNum = value.tokenNum === undefined ? null : parseNonNegativeInt(value.tokenNum, "tokenNum");
    const assetId = value.assetId === undefined ? null : parseNonNegativeInt(value.assetId, "assetId");
    if (tokenNum === null && (assetId === null || assetId === 0)) {
      throw new InvalidShapeInputError("Pass tokenNum or assetId.");
    }
    return {
      userAddress: parseAddress(value.userAddress),
      tokenNum,
      assetId: assetId === 0 ? null : assetId,
      fromAssetId: parseNonNegativeInt(value.fromAssetId, "fromAssetId"),
      amount: parsePositiveBaseUnitAmount(value.amount, "amount"),
      slippageBps: parseSlippageBps(value.slippageBps)
    };
  },

  resolveState(context, input) {
    return resolveDependencies().resolveState(context, input);
  },

  async build(context, input, state): Promise<ShapeBuildResult> {
    if (state.bondingOn !== BONDING_ON_CURVE) {
      throw new InvalidShapeInputError(
        "This token has left the bonding curve. Buy it with POST /swaps/quote.",
        { tokenNum: state.tokenNum, bondingOn: state.bondingOn }
      );
    }
    const direct = input.fromAssetId === state.bondingTokenId;
    if (direct) {
      return buildDirectBuy(context, input, state);
    }
    return buildRoutedBuy(context, input, state);
  },

  validate(group, input, state): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    assertGroupedTransactions(group, errors);
    const direct = input.fromAssetId === state.bondingTokenId;
    const selector =
      state.bondingTokenId === 0 ? BUY_WITH_ALGO_LIMIT_SELECTOR_HEX : BUY_WITH_LIMIT_SELECTOR_HEX;
    const app = group[group.length - 1];
    if (readAppCallSelectorHex(app) !== selector) {
      errors.push("Bonding buy group must end with the HayLaunch buy app call.");
    }
    const mbr = group.find(
      (txn) =>
        txn.payment?.receiver === state.appAddress &&
        txn.payment.amount === state.mbrMicroAlgos.toString()
    );
    if (mbr === undefined) {
      errors.push("Bonding buy group is missing the MBR payment.");
    }
    if (direct) {
      const payment = buyPayment(group, state, input.amount);
      if (payment === undefined) {
        errors.push("Direct bonding buy payment does not match the requested amount.");
      }
      if (state.bondingTokenId !== 0 && !state.bondingAssetOptedIn) {
        const optIn = group.find(
          (txn) =>
            txn.assetTransfer?.assetIndex === String(state.bondingTokenId) &&
            txn.assetTransfer.amount === "0" &&
            txn.assetTransfer.receiver === input.userAddress
        );
        if (optIn === undefined) {
          errors.push("Direct bonding buy is missing the bonding-asset opt-in.");
        }
      }
    } else {
      const payment = group[group.length - 2];
      const amount = paymentAmount(payment, state.bondingTokenId);
      if (amount === undefined || amount <= 0n) {
        errors.push("Routed bonding buy is missing the bonding-asset payment into the curve.");
      }
      if (group.length < 4) {
        errors.push("Routed bonding buy is missing the Haystack router prefix.");
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }
};

async function buildDirectBuy(
  context: ShapeBuildContext,
  input: HaystackBuyBondingInput,
  state: HaystackBuyBondingState
): Promise<ShapeBuildResult> {
  const dependencies = resolveDependencies();
  if (state.directTokensOut === null || state.directTokensOut <= 0n) {
    throw new InvalidShapeInputError("That buy would receive no tokens.", {
      tokenNum: state.tokenNum,
      amount: input.amount.toString()
    });
  }
  const minTokensOut = applySlippage(state.directTokensOut, input.slippageBps);
  if (minTokensOut <= 0n) {
    throw new InvalidShapeInputError("Slippage reduced the minimum tokens out to zero.", {
      slippageBps: input.slippageBps
    });
  }
  const suggestedParams = await dependencies.getSuggestedParams(context.algod);
  const atc = new AtomicTransactionComposer();
  if (state.bondingTokenId !== 0 && !state.bondingAssetOptedIn) {
    addAssetOptInToComposer({
      atc,
      sender: input.userAddress,
      assetId: state.bondingTokenId,
      suggestedParams
    });
  }
  const mbrPayment = paymentToApp(input.userAddress, state.appAddress, state.mbrMicroAlgos, suggestedParams);
  const spend = spendToApp(
    input.userAddress,
    state.appAddress,
    state.bondingTokenId,
    input.amount,
    suggestedParams
  );
  atc.addMethodCall({
    appID: state.appId,
    method: state.bondingTokenId === 0 ? BUY_WITH_ALGO_LIMIT_METHOD : BUY_WITH_LIMIT_METHOD,
    methodArgs: [state.tokenNum, txnArg(mbrPayment), txnArg(spend), minTokensOut],
    sender: input.userAddress,
    signer: makeEmptyTransactionSigner(),
    suggestedParams: {
      ...suggestedParams,
      fee: HAYSTACK_LAUNCH_APP_CALL_MAX_FEE,
      flatFee: true
    },
    boxes: buyBoxes(state, input.userAddress),
    appForeignApps: state.oracleAppId > 0 ? [state.oracleAppId] : [],
    ...(state.bondingTokenId > 0 ? { appForeignAssets: [state.bondingTokenId] } : {})
  });
  const transactions = await dependencies.finalizeComposerGroup({
    algod: context.algod,
    atc,
    appCallMaxFee: HAYSTACK_LAUNCH_APP_CALL_MAX_FEE
  });
  return {
    transactions,
    metadata: {
      route: "direct",
      tokenNum: state.tokenNum,
      assetId: state.assetId,
      bondingTokenId: state.bondingTokenId,
      minTokensOut: minTokensOut.toString(),
      mbrMicroAlgos: state.mbrMicroAlgos.toString()
    },
    warnings: [
      "The bought balance is virtual (userHoldings) until the token graduates and you claim it."
    ]
  };
}

async function buildRoutedBuy(
  context: ShapeBuildContext,
  input: HaystackBuyBondingInput,
  state: HaystackBuyBondingState
): Promise<ShapeBuildResult> {
  const dependencies = resolveDependencies();
  let quote: BondingSwapQuote;
  try {
    quote = await dependencies.quoteBondingSwap({
      userAddress: input.userAddress,
      fromAssetId: input.fromAssetId,
      bondingTokenId: state.bondingTokenId,
      amount: input.amount,
      slippageBps: input.slippageBps
    });
  } catch (error) {
    if (error instanceof InvalidShapeInputError || error instanceof ShapeBuildError) {
      throw error;
    }
    throw new ShapeBuildError("Failed to quote a Haystack route into the bonding asset.", {
      cause: error
    });
  }
  if (quote.minOut <= 0n) {
    throw new InvalidShapeInputError("The Haystack route guaranteed no bonding-asset output.", {
      fromAssetId: input.fromAssetId,
      bondingTokenId: state.bondingTokenId
    });
  }
  if (quote.legs.length + ROUTER_TAIL_TXNS > MAX_GROUP_SIZE) {
    throw new ShapeBuildError("The Haystack route does not leave room for the bonding buy.", {
      details: { routerTxns: quote.legs.length }
    });
  }
  const tokensOut = await dependencies.tokensReceivedForBuy({
    algod: context.algod,
    tokenNum: state.tokenNum,
    bondingIn: quote.minOut,
    sender: input.userAddress
  });
  if (tokensOut * ROUTED_BUY_RESERVE_DENOMINATOR >= state.realTokenReserves * ROUTED_BUY_RESERVE_NUMERATOR) {
    throw new InvalidShapeInputError(
      "A routed buy would take 90% or more of the remaining bonding reserves. Pay in the bonding asset so the completing buy can graduate the token.",
      {
        tokenNum: state.tokenNum,
        bondingTokenId: state.bondingTokenId,
        tokensOut: tokensOut.toString(),
        realTokenReserves: state.realTokenReserves.toString()
      }
    );
  }
  const minTokensOut = applySlippage(tokensOut, input.slippageBps);
  if (minTokensOut <= 0n) {
    throw new InvalidShapeInputError("Slippage reduced the minimum tokens out to zero.", {
      slippageBps: input.slippageBps
    });
  }
  const suggestedParams = await dependencies.getSuggestedParams(context.algod);
  const mbrPayment = paymentToApp(input.userAddress, state.appAddress, state.mbrMicroAlgos, suggestedParams);
  const curvePayment = spendToApp(
    input.userAddress,
    state.appAddress,
    state.bondingTokenId,
    quote.minOut,
    suggestedParams
  );
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: state.appId,
    method: state.bondingTokenId === 0 ? BUY_WITH_ALGO_LIMIT_METHOD : BUY_WITH_LIMIT_METHOD,
    methodArgs: [state.tokenNum, txnArg(mbrPayment), txnArg(curvePayment), minTokensOut],
    sender: input.userAddress,
    signer: makeEmptyTransactionSigner(),
    suggestedParams: {
      ...suggestedParams,
      fee: HAYSTACK_LAUNCH_APP_CALL_MAX_FEE,
      flatFee: true
    },
    boxes: buyBoxes(state, input.userAddress),
    appForeignApps: state.oracleAppId > 0 ? [state.oracleAppId] : [],
    ...(state.bondingTokenId > 0 ? { appForeignAssets: [state.bondingTokenId] } : {})
  });
  const tail = atc.buildGroup().map((entry) => entry.txn);
  const combined = [...quote.legs.map((leg) => leg.txn), ...tail];
  for (const txn of combined) {
    delete txn.group;
  }
  const grouped = algosdk.assignGroupID(combined);
  const groupTransactions: ExecutableQuoteGroupTransaction[] = [];
  for (let index = 0; index < grouped.length; index += 1) {
    const txn = grouped[index]!;
    const leg = quote.legs[index];
    const encodedTransaction = encodeUnsignedTransactionBase64(txn);
    if (leg?.authorize) {
      const signed = await leg.authorize(txn);
      groupTransactions.push({
        index,
        signer: "logicsig",
        encodedTransaction,
        signedTransaction: Buffer.from(signed).toString("base64")
      });
    } else {
      groupTransactions.push({
        index,
        signer: "user",
        encodedTransaction
      });
    }
  }
  return {
    transactions: normalizeTransactions(grouped),
    groupTransactions,
    metadata: {
      route: "routed",
      tokenNum: state.tokenNum,
      assetId: state.assetId,
      bondingTokenId: state.bondingTokenId,
      fromAssetId: input.fromAssetId,
      minOut: quote.minOut.toString(),
      minTokensOut: minTokensOut.toString(),
      mbrMicroAlgos: state.mbrMicroAlgos.toString()
    },
    warnings: [
      "Router surplus stays in the wallet. Only the router's guaranteed bonding-asset output is paid into the curve.",
      "The bought balance is virtual (userHoldings) until the token graduates and you claim it.",
      "Sign only the user legs. Logic-signature members are already authorized."
    ]
  };
}

export async function resolveHaystackBuyBondingState(
  context: ShapeBuildContext,
  input: HaystackBuyBondingInput
): Promise<HaystackBuyBondingState> {
  if (context.network !== "mainnet") {
    throw new ShapeStateError("Haystack Launch is mainnet-only.", {
      details: { network: context.network }
    });
  }
  let tokenNum = input.tokenNum;
  if (input.assetId !== null) {
    const mapped = await readTokenNumForAsset(context.algod, input.assetId);
    if (mapped === null) {
      throw new InvalidShapeInputError(
        "That asset is not in the HayLaunch asset map yet. Pass tokenNum from the launch.",
        { assetId: input.assetId }
      );
    }
    tokenNum = mapped;
  }
  if (tokenNum === null) {
    throw new InvalidShapeInputError("Pass tokenNum or assetId.");
  }
  const info = await readTokenInfoBox(context.algod, tokenNum);
  if (info === null) {
    throw new ShapeStateError("HayLaunch token was not found.", { details: { tokenNum } });
  }
  if (info.bondingOn !== BONDING_ON_CURVE) {
    throw new InvalidShapeInputError(
      "This token has left the bonding curve. Buy it with POST /swaps/quote.",
      { tokenNum, bondingOn: info.bondingOn, assetId: info.assetId }
    );
  }
  const direct = input.fromAssetId === info.bondingTokenId;
  const global = await readLaunchGlobal(context.algod);
  const mbr = BigInt(
    (await simulateLaunchAbi({
      algod: context.algod,
      method: MBR_TO_BUY_METHOD,
      methodArgs: [tokenNum],
      sender: input.userAddress
    })) as bigint | number | string
  );
  const bondingAssetOptedIn =
    info.bondingTokenId === 0 || direct
      ? info.bondingTokenId === 0
        ? true
        : await isAssetOptedIn(context.algod, input.userAddress, info.bondingTokenId)
      : true;
  let directTokensOut: bigint | null = null;
  if (direct) {
    directTokensOut = await defaultTokensReceivedForBuy({
      algod: context.algod,
      tokenNum,
      bondingIn: input.amount,
      sender: input.userAddress
    });
  }
  return {
    appId: HAYSTACK_LAUNCH_APP_ID,
    appAddress: getApplicationAddress(HAYSTACK_LAUNCH_APP_ID),
    oracleAppId: global.oracleAppId,
    tokenNum,
    assetId: info.assetId,
    bondingTokenId: info.bondingTokenId,
    bondingOn: info.bondingOn,
    realTokenReserves: info.realTokenReserves,
    bondingAssetOptedIn,
    mbrMicroAlgos: mbr,
    directTokensOut
  };
}

async function defaultTokensReceivedForBuy(params: {
  algod: Algodv2;
  tokenNum: number;
  bondingIn: bigint;
  sender: string;
}): Promise<bigint> {
  const value = await simulateLaunchAbi({
    algod: params.algod,
    method: TOKENS_RECEIVED_FOR_BUY_METHOD,
    methodArgs: [params.tokenNum, params.bondingIn],
    sender: params.sender
  });
  return BigInt(value as bigint | number | string);
}

async function defaultQuoteBondingSwap(params: {
  userAddress: string;
  fromAssetId: number;
  bondingTokenId: number;
  amount: bigint;
  slippageBps: number;
}): Promise<BondingSwapQuote> {
  const router = createLaunchRouterClient();
  const needsOptIn =
    params.bondingTokenId !== 0 &&
    (await router.needsAssetOptIn(params.userAddress, params.bondingTokenId));
  const quote = await router.newQuote({
    address: params.userAddress,
    fromASAID: params.fromAssetId,
    toASAID: params.bondingTokenId,
    amount: params.amount,
    type: "fixed-input",
    disabledProtocols: [...DEFAULT_DISABLED_HAYSTACK_PROTOCOLS] as Protocol[],
    maxGroupSize: MAX_GROUP_SIZE - ROUTER_TAIL_TXNS,
    optIn: needsOptIn
  });
  const minOut = applySlippage(BigInt(quote.quote), params.slippageBps);
  const composer = await router.newSwap({
    quote,
    address: params.userAddress,
    slippage: params.slippageBps / 100,
    signer: makeEmptyTransactionSigner()
  });
  await composer.addSwapTransactions();
  const built = composer.buildGroup();
  return {
    minOut,
    legs: built.map((entry) => {
      const userLeg = entry.txn.sender.toString() === params.userAddress;
      return {
        txn: entry.txn,
        ...(userLeg
          ? {}
          : {
              authorize: async (txn: Transaction) => {
                const [blob] = await entry.signer([txn], [0]);
                if (blob === undefined) {
                  throw new ShapeBuildError("Haystack router leg did not produce a signature.");
                }
                return blob;
              }
            })
      };
    })
  };
}

function createLaunchRouterClient(): RouterClient {
  const apiKey = process.env.HAYSTACK_API_KEY?.trim();
  if (!apiKey) {
    throw new ShapeBuildError("HAYSTACK_API_KEY is not configured.");
  }
  const algodUrl = new URL(process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud");
  const referrer =
    process.env.HAYSTACK_REFERRER_ADDRESS?.trim()
    ?? process.env.X402_PAYMENT_RECEIVER_ADDRESS?.trim();
  if (referrer && !isValidAddress(referrer)) {
    throw new ShapeBuildError("The configured Haystack referrer is not a valid Algorand address.");
  }
  return new RouterClient({
    apiKey,
    apiBaseUrl: trimSlash(process.env.HAYSTACK_API_BASE_URL ?? "https://hayrouter.txnlab.dev/api"),
    algodUri: `${algodUrl.protocol}//${algodUrl.hostname}${algodUrl.pathname}`,
    algodToken: process.env.X402_ALGOD_TOKEN ?? "",
    ...(algodUrl.port ? { algodPort: Number(algodUrl.port) } : {}),
    ...(referrer ? { referrerAddress: referrer } : {})
  });
}

function buyBoxes(state: HaystackBuyBondingState, userAddress: string) {
  return [
    stakingBoxReference(state.appId, tokenBoxName(state.tokenNum)),
    stakingBoxReference(state.appId, userHoldingBoxName(userAddress, state.tokenNum))
  ];
}

function paymentToApp(
  sender: string,
  receiver: string,
  amount: bigint,
  suggestedParams: algosdk.SuggestedParams
): Transaction {
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver,
    amount,
    suggestedParams
  });
}

function spendToApp(
  sender: string,
  receiver: string,
  assetId: number,
  amount: bigint,
  suggestedParams: algosdk.SuggestedParams
): Transaction {
  if (assetId === 0) {
    return paymentToApp(sender, receiver, amount, suggestedParams);
  }
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender,
    receiver,
    assetIndex: assetId,
    amount,
    suggestedParams
  });
}

function txnArg(txn: Transaction) {
  return { txn, signer: makeEmptyTransactionSigner() };
}

function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

function buyPayment(
  group: readonly SerializedTransaction[],
  state: HaystackBuyBondingState,
  amount: bigint
) {
  if (state.bondingTokenId === 0) {
    return group.find(
      (txn) => txn.payment?.receiver === state.appAddress && txn.payment.amount === amount.toString()
    );
  }
  return group.find(
    (txn) =>
      txn.assetTransfer?.assetIndex === String(state.bondingTokenId) &&
      txn.assetTransfer.amount === amount.toString() &&
      txn.assetTransfer.receiver === state.appAddress
  );
}

function paymentAmount(
  txn: SerializedTransaction | undefined,
  bondingTokenId: number
): bigint | undefined {
  if (txn === undefined) {
    return undefined;
  }
  if (bondingTokenId === 0) {
    return txn.payment === undefined ? undefined : BigInt(txn.payment.amount);
  }
  if (txn.assetTransfer?.assetIndex !== String(bondingTokenId)) {
    return undefined;
  }
  return BigInt(txn.assetTransfer.amount);
}

function parseSlippageBps(value: unknown): number {
  const parsed = parseNonNegativeInt(value, "slippageBps");
  if (parsed > 10_000) {
    throw new InvalidShapeInputError("slippageBps must be from 0 to 10000.", { slippageBps: parsed });
  }
  return parsed;
}

function parseNonNegativeInt(value: unknown, field: string): number {
  let parsed: bigint;
  if (typeof value === "bigint" && value >= 0n) {
    parsed = value;
  } else if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    parsed = BigInt(value);
  } else {
    throw new InvalidShapeInputError(`${field} must be a non-negative integer.`, { [field]: value });
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidShapeInputError(`${field} is out of range.`);
  }
  return Number(parsed);
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
