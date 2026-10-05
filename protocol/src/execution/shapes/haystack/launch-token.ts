import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";

import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import { parseAddress, parsePositiveBaseUnitAmount } from "./parse-input.js";
import {
  HAYSTACK_LAUNCH_APP_CALL_MAX_FEE,
  HAYSTACK_LAUNCH_APP_ID,
  HAYSTACK_LAUNCH_MAX_MULTIPLIER,
  HAYSTACK_LAUNCH_MAX_TARGET_MICRO_USD,
  HAYSTACK_LAUNCH_MIN_MULTIPLIER,
  LAUNCH_FIELD_BYTES
} from "./launch-constants.js";
import {
  readLaunchGlobal,
  simulateLaunchAbi
} from "./launch-chain.js";
import {
  GAS_METHOD,
  GAS_METHOD_SELECTOR_HEX,
  IS_BONDING_TOKEN_SUPPORTED_METHOD,
  LAUNCH_TOKEN_METHOD,
  LAUNCH_TOKEN_SELECTOR_HEX,
  LAUNCH_TOKEN_THEN_BUY_ALGO_METHOD,
  LAUNCH_TOKEN_THEN_BUY_ALGO_SELECTOR_HEX,
  LAUNCH_TOKEN_THEN_BUY_METHOD,
  LAUNCH_TOKEN_THEN_BUY_SELECTOR_HEX,
  MBR_TO_LAUNCH_METHOD,
  MBR_TO_LAUNCH_THEN_BUY_METHOD,
  PREVIEW_BONDING_METHOD,
  TOKENS_RECEIVED_AT_LAUNCH_METHOD,
  tokenBoxName
} from "./launch-spec.js";
import {
  addAssetOptInToComposer,
  assertGroupedTransactions,
  finalizeComposerGroup,
  getAccountAssetBalance,
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
  action: "launch",
  variant: "token"
};

export interface HaystackLaunchTokenInput {
  userAddress: string;
  symbol: string;
  name: string;
  assetUrl: string;
  description: string;
  socialWebsite: string;
  socialX: string;
  socialTelegram: string;
  socialDiscord: string;
  bondingTokenId: number;
  targetBondingUsd: bigint;
  priceMultiplier: bigint;
  initialBuyAmount: bigint | null;
}

export interface HaystackLaunchTokenState {
  appId: number;
  appAddress: string;
  oracleAppId: number;
  nextTokenNum: number;
  bondingAssetOptedIn: boolean;
  mbrMicroAlgos: bigint;
  tokensForBonding: bigint;
  previewTokens: bigint | null;
}

export interface HaystackLaunchTokenDependencies {
  resolveState: (
    context: ShapeBuildContext,
    input: HaystackLaunchTokenInput
  ) => Promise<HaystackLaunchTokenState>;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  finalizeComposerGroup: typeof finalizeComposerGroup;
}

let dependencyOverrides: Partial<HaystackLaunchTokenDependencies> | undefined;

export function setHaystackLaunchTokenDependenciesForTests(
  overrides?: Partial<HaystackLaunchTokenDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): HaystackLaunchTokenDependencies {
  return {
    resolveState: resolveHaystackLaunchTokenState,
    getSuggestedParams,
    finalizeComposerGroup,
    ...dependencyOverrides
  };
}

export const haystackLaunchTokenShape: TransactionShapeSpec<
  HaystackLaunchTokenInput,
  HaystackLaunchTokenState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Haystack Launch token",
  description:
    "Creates a HayLaunch bonding-curve ASA. Optional first buy uses launchTokenThenBuy or " +
    "launchTokenThenBuyWithAlgo. Pass an existing ipfs:// or https:// asset URL. " +
    "Optional targetBondingUsd is micro-USD (0 uses the contract default; cannot be below the " +
    "on-chain minimum or above $500,000). Optional priceMultiplier is scaled by 1e9 " +
    "(0 uses 20x; otherwise 5x–250x). A first buy that would finish the curve is refused.",
  supportedOpportunityTypes: [],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "symbol", "name", "assetUrl", "bondingTokenId"],
  sources: [
    {
      kind: "arc56",
      description: "protocol/src/haystack-launch.arc56.json launchToken / launchTokenThenBuy"
    }
  ],

  parseInput(raw: unknown): HaystackLaunchTokenInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const initialBuy =
      value.initialBuyAmount === undefined || value.initialBuyAmount === null
        ? null
        : parsePositiveBaseUnitAmount(value.initialBuyAmount, "initialBuyAmount");
    return {
      userAddress: parseAddress(value.userAddress),
      symbol: parseBoundedText(value.symbol, "symbol", LAUNCH_FIELD_BYTES.symbol, true),
      name: parseBoundedText(value.name, "name", LAUNCH_FIELD_BYTES.name, true),
      assetUrl: parseAssetUrl(value.assetUrl),
      description: parseBoundedText(value.description, "description", LAUNCH_FIELD_BYTES.description, false),
      socialWebsite: parseBoundedText(value.socialWebsite, "socialWebsite", LAUNCH_FIELD_BYTES.socialWebsite, false),
      socialX: parseBoundedText(value.socialX, "socialX", LAUNCH_FIELD_BYTES.socialX, false),
      socialTelegram: parseBoundedText(value.socialTelegram, "socialTelegram", LAUNCH_FIELD_BYTES.socialTelegram, false),
      socialDiscord: parseBoundedText(value.socialDiscord, "socialDiscord", LAUNCH_FIELD_BYTES.socialDiscord, false),
      bondingTokenId: parseNonNegativeInt(value.bondingTokenId ?? 0, "bondingTokenId"),
      targetBondingUsd: parseTargetBondingUsd(value.targetBondingUsd ?? 0),
      priceMultiplier: parsePriceMultiplier(value.priceMultiplier ?? 0),
      initialBuyAmount: initialBuy
    };
  },

  async resolveState(context, input) {
    return resolveDependencies().resolveState(context, input);
  },

  async build(context, input, state): Promise<ShapeBuildResult> {
    if (
      input.initialBuyAmount !== null &&
      state.previewTokens !== null &&
      state.previewTokens >= state.tokensForBonding
    ) {
      throw new InvalidShapeInputError(
        "That first buy would finish the bonding curve. Launch without it, then buy in the bonding asset.",
        {
          previewTokens: state.previewTokens.toString(),
          tokensForBonding: state.tokensForBonding.toString()
        }
      );
    }
    const dependencies = resolveDependencies();
    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Haystack launch.", {
        cause: error
      });
    }

    const atc = new AtomicTransactionComposer();
    if (input.bondingTokenId !== 0 && !state.bondingAssetOptedIn) {
      addAssetOptInToComposer({
        atc,
        sender: input.userAddress,
        assetId: input.bondingTokenId,
        suggestedParams
      });
    }
    // Distinct notes keep the two otherwise identical gas() calls from sharing a txid.
    addGasCall(atc, input.userAddress, state, suggestedParams, new Uint8Array([1]));
    addGasCall(atc, input.userAddress, state, suggestedParams, new Uint8Array([2]));

    const mbrPayment = paymentToApp(input.userAddress, state, state.mbrMicroAlgos, suggestedParams);
    const metadata = launchMetadata(input);
    const appParams = {
      sender: input.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams: appCallParams(suggestedParams),
      boxes: [stakingBoxReference(state.appId, tokenBoxName(state.nextTokenNum))],
      appForeignApps: state.oracleAppId > 0 ? [state.oracleAppId] : [],
      ...(input.bondingTokenId > 0 ? { appForeignAssets: [input.bondingTokenId] } : {})
    };

    if (input.initialBuyAmount === null) {
      atc.addMethodCall({
        appID: state.appId,
        method: LAUNCH_TOKEN_METHOD,
        methodArgs: [txnArg(mbrPayment), ...metadata],
        ...appParams
      });
    } else if (input.bondingTokenId === 0) {
      const buyPayment = paymentToApp(
        input.userAddress,
        state,
        input.initialBuyAmount,
        suggestedParams
      );
      atc.addMethodCall({
        appID: state.appId,
        method: LAUNCH_TOKEN_THEN_BUY_ALGO_METHOD,
        methodArgs: [txnArg(mbrPayment), txnArg(buyPayment), ...metadata.slice(0, -1)],
        ...appParams
      });
    } else {
      const buyPayment = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: input.userAddress,
        receiver: state.appAddress,
        assetIndex: input.bondingTokenId,
        amount: input.initialBuyAmount,
        suggestedParams
      });
      atc.addMethodCall({
        appID: state.appId,
        method: LAUNCH_TOKEN_THEN_BUY_METHOD,
        methodArgs: [txnArg(mbrPayment), txnArg(buyPayment), ...metadata],
        ...appParams
      });
    }

    let transactions: Transaction[];
    try {
      transactions = await dependencies.finalizeComposerGroup({
        algod: context.algod,
        atc,
        appCallMaxFee: HAYSTACK_LAUNCH_APP_CALL_MAX_FEE
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to finalize Haystack launch group.", { cause: error });
    }

    return {
      transactions,
      metadata: {
        appId: state.appId,
        bondingTokenId: input.bondingTokenId,
        mbrMicroAlgos: state.mbrMicroAlgos.toString(),
        initialBuyAmount: input.initialBuyAmount?.toString() ?? null,
        previewTokens: state.previewTokens?.toString() ?? null,
        includesFirstBuy: input.initialBuyAmount !== null
      },
      warnings: [
        "Canix does not pin images or generate art. assetUrl must already be ipfs:// or https://.",
        "The launched ASA stays in the contract until buyers claim after graduation."
      ]
    };
  },

  validate(group, input, state): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    assertGroupedTransactions(group, errors);
    const expectedSelector =
      input.initialBuyAmount === null
        ? LAUNCH_TOKEN_SELECTOR_HEX
        : input.bondingTokenId === 0
          ? LAUNCH_TOKEN_THEN_BUY_ALGO_SELECTOR_HEX
          : LAUNCH_TOKEN_THEN_BUY_SELECTOR_HEX;
    const launchIndex = group.findIndex(
      (txn) => readAppCallSelectorHex(txn) === expectedSelector
    );
    if (launchIndex < 0) {
      errors.push("Launch group is missing the HayLaunch app call.");
      return { valid: false, errors, warnings };
    }
    const gasCalls = group.filter((txn) => readAppCallSelectorHex(txn) === GAS_METHOD_SELECTOR_HEX);
    if (gasCalls.length < 2) {
      errors.push("Launch group must include two gas() calls.");
    }
    const mbr = group.find(
      (txn) =>
        txn.payment?.receiver === state.appAddress &&
        txn.payment.amount === state.mbrMicroAlgos.toString()
    );
    if (mbr === undefined) {
      errors.push("Launch group is missing the MBR payment.");
    }
    if (input.bondingTokenId !== 0 && !state.bondingAssetOptedIn) {
      const optIn = group.find(
        (txn) =>
          txn.assetTransfer?.assetIndex === String(input.bondingTokenId) &&
          txn.assetTransfer.amount === "0" &&
          txn.assetTransfer.receiver === input.userAddress
      );
      if (optIn === undefined) {
        errors.push("Launch group is missing the bonding-asset opt-in.");
      }
    }
    if (input.initialBuyAmount !== null) {
      const buy =
        input.bondingTokenId === 0
          ? group.find(
              (txn) =>
                txn.payment?.receiver === state.appAddress &&
                txn.payment.amount === input.initialBuyAmount?.toString()
            )
          : group.find(
              (txn) =>
                txn.assetTransfer?.assetIndex === String(input.bondingTokenId) &&
                txn.assetTransfer.amount === input.initialBuyAmount?.toString() &&
                txn.assetTransfer.receiver === state.appAddress
            );
      if (buy === undefined) {
        errors.push("Launch group is missing the first-buy payment.");
      }
    }
    return { valid: errors.length === 0, errors, warnings };
  }
};

export async function resolveHaystackLaunchTokenState(
  context: ShapeBuildContext,
  input: HaystackLaunchTokenInput
): Promise<HaystackLaunchTokenState> {
  if (context.network !== "mainnet") {
    throw new ShapeStateError("Haystack Launch is mainnet-only.", {
      details: { network: context.network }
    });
  }

  const global = await readLaunchGlobal(context.algod);
  if (input.targetBondingUsd !== 0n && input.targetBondingUsd < global.bondingUsd) {
    throw new InvalidShapeInputError(
      "targetBondingUsd is below the HayLaunch contract minimum.",
      {
        targetBondingUsd: input.targetBondingUsd.toString(),
        minimum: global.bondingUsd.toString()
      }
    );
  }

  const supported = await simulateLaunchAbi({
    algod: context.algod,
    method: IS_BONDING_TOKEN_SUPPORTED_METHOD,
    methodArgs: [input.bondingTokenId],
    sender: input.userAddress
  });
  if (supported !== true) {
    throw new InvalidShapeInputError("That bonding asset is not supported by HayLaunch.", {
      bondingTokenId: input.bondingTokenId
    });
  }

  const mbrMethod = input.initialBuyAmount === null ? MBR_TO_LAUNCH_METHOD : MBR_TO_LAUNCH_THEN_BUY_METHOD;
  const mbr = BigInt(
    (await simulateLaunchAbi({
      algod: context.algod,
      method: mbrMethod,
      sender: input.userAddress
    })) as bigint | number | string
  );
  const preview = (await simulateLaunchAbi({
    algod: context.algod,
    method: PREVIEW_BONDING_METHOD,
    methodArgs: [input.bondingTokenId, input.targetBondingUsd, input.priceMultiplier],
    sender: input.userAddress
  })) as unknown[];
  const tokensForBonding = BigInt(preview[7] as bigint | number | string);

  let previewTokens: bigint | null = null;
  if (input.initialBuyAmount !== null) {
    previewTokens = BigInt(
      (await simulateLaunchAbi({
        algod: context.algod,
        method: TOKENS_RECEIVED_AT_LAUNCH_METHOD,
        methodArgs: [
          input.bondingTokenId,
          input.initialBuyAmount,
          input.targetBondingUsd,
          input.priceMultiplier
        ],
        sender: input.userAddress
      })) as bigint | number | string
    );
    if (previewTokens >= tokensForBonding) {
      throw new InvalidShapeInputError(
        "That first buy would finish the bonding curve. Launch without it, then buy in the bonding asset.",
        {
          previewTokens: previewTokens.toString(),
          tokensForBonding: tokensForBonding.toString()
        }
      );
    }
  }

  const bondingAssetOptedIn =
    input.bondingTokenId === 0
      ? true
      : await isAssetOptedIn(context.algod, input.userAddress, input.bondingTokenId);
  const balance = await getAccountAssetBalance(
    context.algod,
    input.userAddress,
    input.bondingTokenId
  );
  const needed = (input.initialBuyAmount ?? 0n) + (input.bondingTokenId === 0 ? mbr : 0n);
  if (balance < needed) {
    throw new InvalidShapeInputError("Insufficient bonding-asset balance for this launch.", {
      have: balance.toString(),
      need: needed.toString(),
      bondingTokenId: input.bondingTokenId
    });
  }

  return {
    appId: HAYSTACK_LAUNCH_APP_ID,
    appAddress: getApplicationAddress(HAYSTACK_LAUNCH_APP_ID),
    oracleAppId: global.oracleAppId,
    nextTokenNum: global.nextTokenNum,
    bondingAssetOptedIn,
    mbrMicroAlgos: mbr,
    tokensForBonding,
    previewTokens
  };
}

function launchMetadata(input: HaystackLaunchTokenInput): Array<string | bigint | number> {
  return [
    input.symbol,
    input.name,
    input.assetUrl,
    input.description,
    input.socialWebsite,
    input.socialX,
    input.socialTelegram,
    input.socialDiscord,
    input.targetBondingUsd,
    input.priceMultiplier,
    input.bondingTokenId
  ];
}

function addGasCall(
  atc: AtomicTransactionComposer,
  sender: string,
  state: HaystackLaunchTokenState,
  suggestedParams: algosdk.SuggestedParams,
  note: Uint8Array
): void {
  atc.addMethodCall({
    appID: state.appId,
    method: GAS_METHOD,
    methodArgs: [],
    note,
    sender,
    signer: makeEmptyTransactionSigner(),
    suggestedParams,
    appForeignApps: state.oracleAppId > 0 ? [state.oracleAppId] : []
  });
}

function paymentToApp(
  sender: string,
  state: HaystackLaunchTokenState,
  amount: bigint,
  suggestedParams: algosdk.SuggestedParams
): Transaction {
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender,
    receiver: state.appAddress,
    amount,
    suggestedParams
  });
}

function txnArg(txn: Transaction): { txn: Transaction; signer: ReturnType<typeof makeEmptyTransactionSigner> } {
  return { txn, signer: makeEmptyTransactionSigner() };
}

function appCallParams(suggestedParams: algosdk.SuggestedParams): algosdk.SuggestedParams {
  return {
    ...suggestedParams,
    fee: HAYSTACK_LAUNCH_APP_CALL_MAX_FEE,
    flatFee: true
  };
}

function parseAssetUrl(value: unknown): string {
  const url = parseBoundedText(value, "assetUrl", LAUNCH_FIELD_BYTES.assetUrl, true);
  if (!url.startsWith("ipfs://") && !url.startsWith("https://")) {
    throw new InvalidShapeInputError("assetUrl must start with ipfs:// or https://.");
  }
  return url;
}

function parseBoundedText(
  value: unknown,
  field: string,
  maxBytes: number,
  required: boolean
): string {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new InvalidShapeInputError(`${field} is required.`);
    }
    return "";
  }
  if (typeof value !== "string") {
    throw new InvalidShapeInputError(`${field} must be a string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new InvalidShapeInputError(`${field} exceeds ${maxBytes} bytes.`, { [field]: value });
  }
  return value;
}

function parseTargetBondingUsd(value: unknown): bigint {
  const parsed = parseNonNegativeBigint(value, "targetBondingUsd");
  if (parsed > HAYSTACK_LAUNCH_MAX_TARGET_MICRO_USD) {
    throw new InvalidShapeInputError("targetBondingUsd cannot exceed $500,000.", {
      targetBondingUsd: parsed.toString()
    });
  }
  return parsed;
}

function parsePriceMultiplier(value: unknown): bigint {
  const parsed = parseNonNegativeBigint(value, "priceMultiplier");
  if (parsed === 0n) {
    return parsed;
  }
  if (parsed < HAYSTACK_LAUNCH_MIN_MULTIPLIER || parsed > HAYSTACK_LAUNCH_MAX_MULTIPLIER) {
    throw new InvalidShapeInputError(
      "priceMultiplier must be 0 (20x default) or 5x–250x scaled by 1e9.",
      { priceMultiplier: parsed.toString() }
    );
  }
  return parsed;
}

function parseNonNegativeInt(value: unknown, field: string): number {
  const parsed = parseNonNegativeBigint(value, field);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidShapeInputError(`${field} is out of range.`);
  }
  return Number(parsed);
}

function parseNonNegativeBigint(value: unknown, field: string): bigint {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new InvalidShapeInputError(`${field} must be a non-negative integer.`, { [field]: value });
}
