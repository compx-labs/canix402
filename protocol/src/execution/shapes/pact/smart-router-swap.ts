import algosdk, { Algodv2, Transaction } from "algosdk";

import {
  PactSmartRouterError,
  quotePactSmartRouter,
  resolvePactSmartRouterAppId,
  type PactSmartRouterQuote
} from "../../../services/pact-smart-router.js";
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
import { ALGO_ASSET_ID } from "./parse-input.js";
import {
  parseAddress,
  parseAssetId,
  parseBaseUnitAmount,
  parseOptionalPositiveAppId,
  parseSlippageBps
} from "./parse-input.js";
import {
  MIN_ALGO_FEE,
  SWAP_ONE_HOP_SELECTOR_HEX,
  SWAP_TWO_HOP_SELECTOR_HEX,
  buildPactSmartRouterGroup,
  getPactSmartRouterAddress,
  packRouterSwaps,
  readAppCallSelectorHex
} from "./router-abi.js";

const HIGH_SLIPPAGE_BPS = 500;
const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "pact",
  protocolVersion: "smart-router",
  action: "swap",
  variant: "fixed-input"
};

export interface PactSmartRouterSwapInput {
  userAddress: string;
  fromAssetId: number;
  toAssetId: number;
  amount: bigint;
  maxSlippageBps: number;
  routerAppId?: number;
}

export interface PactSmartRouterSwapState {
  quote: PactSmartRouterQuote;
  routerAppId: number;
  routerAddress: string;
}

export interface PactSmartRouterSwapDependencies {
  quoteRoute: typeof quotePactSmartRouter;
  resolveRouterAppId: typeof resolvePactSmartRouterAppId;
  getSuggestedParams: (algod: Algodv2) => Promise<algosdk.SuggestedParams>;
  buildGroup: typeof buildPactSmartRouterGroup;
}

let dependencyOverrides: Partial<PactSmartRouterSwapDependencies> | undefined;

export function setPactSmartRouterSwapDependenciesForTests(
  overrides?: Partial<PactSmartRouterSwapDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): PactSmartRouterSwapDependencies {
  return {
    quoteRoute: quotePactSmartRouter,
    resolveRouterAppId: resolvePactSmartRouterAppId,
    getSuggestedParams: async (algod) => algod.getTransactionParams().do(),
    buildGroup: buildPactSmartRouterGroup,
    ...dependencyOverrides
  };
}

export const pactSmartRouterSwapShape: TransactionShapeSpec<
  PactSmartRouterSwapInput,
  PactSmartRouterSwapState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Pact Smart Router fixed-input swap",
  description:
    "Quotes a 1–3 hop Pact route (local graph + Pool.prepareSwap) and builds an unsigned " +
    "deposit + router SWAP group. Not a direct single-pool Pact swap. Canix never signs or submits.",
  supportedOpportunityTypes: [],
  opportunityRole: "enter",
  requiredInputs: ["userAddress", "fromAssetId", "toAssetId", "amount", "maxSlippageBps"],
  sources: [
    {
      kind: "docs",
      description:
        "Pact Smart Router on-chain group: deposit source asset then SWAP app calls (router.md)",
      url: "https://github.com/pactfi/pact-docs/blob/master/router.md"
    },
    {
      kind: "sdk",
      description:
        "No SDK Smart Router helper; hop quotes use @pactfi/pactsdk Pool.prepareSwap after GET /pools discovery"
    },
    {
      kind: "api",
      description: "GET {PACT_API_BASE_URL}/pools (fallback /pools/all) — pool discovery only, not a route solver"
    }
  ],

  parseInput(raw: unknown): PactSmartRouterSwapInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    const userAddress = parseAddress(value.userAddress);
    const fromAssetId = parseAssetId(value.fromAssetId, "fromAssetId");
    const toAssetId = parseAssetId(value.toAssetId, "toAssetId");
    if (fromAssetId === toAssetId) {
      throw new InvalidShapeInputError("fromAssetId and toAssetId must be different assets.", {
        fromAssetId,
        toAssetId
      });
    }
    const amount = parseBaseUnitAmount(value.amount, "amount");
    const maxSlippageBps = parseSlippageBps(value.maxSlippageBps);
    const routerAppId = parseOptionalPositiveAppId(value.routerAppId, "routerAppId");
    return {
      userAddress,
      fromAssetId,
      toAssetId,
      amount,
      maxSlippageBps,
      ...(routerAppId === undefined ? {} : { routerAppId })
    };
  },

  async resolveState(
    context: ShapeBuildContext,
    input: PactSmartRouterSwapInput
  ): Promise<PactSmartRouterSwapState> {
    const dependencies = resolveDependencies();
    let routerAppId: number;
    try {
      routerAppId = dependencies.resolveRouterAppId(input.routerAppId);
    } catch (error) {
      throw mapSmartRouterError(error);
    }

    let quote: PactSmartRouterQuote;
    try {
      quote = await dependencies.quoteRoute({
        fromAssetId: input.fromAssetId,
        toAssetId: input.toAssetId,
        amount: input.amount,
        maxSlippageBps: input.maxSlippageBps,
        network: context.network,
        algod: context.algod
      });
    } catch (error) {
      throw mapSmartRouterError(error);
    }

    return {
      quote,
      routerAppId,
      routerAddress: getPactSmartRouterAddress(routerAppId)
    };
  },

  async build(
    context: ShapeBuildContext,
    input: PactSmartRouterSwapInput,
    state: PactSmartRouterSwapState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    let suggestedParams: algosdk.SuggestedParams;
    try {
      suggestedParams = await dependencies.getSuggestedParams(context.algod);
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Pact Smart Router swap.", {
        cause: error
      });
    }

    let rawTxns: Transaction[];
    try {
      rawTxns = dependencies.buildGroup({
        userAddress: input.userAddress,
        routerAppId: state.routerAppId,
        fromAssetId: input.fromAssetId,
        amountIn: input.amount,
        hops: state.quote.hops,
        minAmountOut: state.quote.minAmountOut,
        suggestedParams
      });
    } catch (error) {
      throw new ShapeBuildError("Failed to build Pact Smart Router transaction group.", {
        cause: error
      });
    }

    const warnings: string[] = [];
    if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
      warnings.push(
        `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
      );
    }
    if (input.toAssetId !== ALGO_ASSET_ID) {
      warnings.push(
        "Wallet must already be opted into the output ASA. Canix does not prefix an opt-in in this group."
      );
    }
    warnings.push(
      "Router OPTIN/OPTOUT is omitted; the Smart Router contract is expected to be SUPEROPTIN'd to route assets."
    );

    return {
      transactions: normalizeTransactions(rawTxns),
      warnings,
      metadata: {
        routerAppId: state.routerAppId,
        routerAddress: state.routerAddress,
        fromAssetId: input.fromAssetId,
        toAssetId: input.toAssetId,
        amountIn: input.amount.toString(),
        expectedAmountOut: state.quote.amountOut.toString(),
        minAmountOut: state.quote.minAmountOut.toString(),
        hopCount: state.quote.hops.length,
        hops: state.quote.hops.map((hop) => ({
          poolAppId: hop.poolAppId,
          poolEscrowAddress: hop.poolEscrowAddress,
          fromAssetId: hop.fromAssetId,
          toAssetId: hop.toAssetId,
          amountIn: hop.amountIn.toString(),
          amountOut: hop.amountOut.toString(),
          feeBps: hop.feeBps
        })),
        quoteSource: state.quote.quoteSource,
        slippageBps: input.maxSlippageBps
      }
    };
  },

  validate(
    group,
    input: PactSmartRouterSwapInput,
    state: PactSmartRouterSwapState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const packed = packRouterSwaps(state.quote.hops, state.quote.minAmountOut);
    const expectedLength = 1 + packed.length;

    if (group.length !== expectedLength) {
      errors.push(
        `Expected ${expectedLength} transactions (deposit + ${packed.length} router SWAP call(s)), received ${group.length}.`
      );
      return { valid: false, errors, warnings };
    }

    validateDepositTxn({
      txn: group[0],
      userAddress: input.userAddress,
      routerAddress: state.routerAddress,
      assetId: input.fromAssetId,
      amount: input.amount,
      errors
    });

    for (let index = 0; index < packed.length; index += 1) {
      const txn = group[index + 1];
      const call = packed[index];
      validateSwapTxn({
        txn,
        label: `Transaction ${index + 2}`,
        userAddress: input.userAddress,
        routerAppId: state.routerAppId,
        packed: call,
        errors
      });
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};

function validateDepositTxn(params: {
  txn: SerializedTransaction | undefined;
  userAddress: string;
  routerAddress: string;
  assetId: number;
  amount: bigint;
  errors: string[];
}): void {
  const { txn, userAddress, routerAddress, assetId, amount, errors } = params;
  if (assetId === ALGO_ASSET_ID) {
    if (txn === undefined || txn.type !== "pay" || !txn.payment) {
      errors.push("Transaction 1 must be an ALGO payment depositing the source asset to the router.");
      return;
    }
    if (txn.sender !== userAddress) {
      errors.push("Transaction 1 sender must be the user address.");
    }
    if (txn.payment.receiver !== routerAddress) {
      errors.push("Transaction 1 receiver must be the Smart Router application address.");
    }
    if (txn.payment.amount !== amount.toString()) {
      errors.push("Transaction 1 amount must equal the requested source amount.");
    }
    return;
  }

  if (txn === undefined || txn.type !== "axfer" || !txn.assetTransfer) {
    errors.push("Transaction 1 must be an asset transfer depositing the source ASA to the router.");
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push("Transaction 1 sender must be the user address.");
  }
  if (txn.assetTransfer.receiver !== routerAddress) {
    errors.push("Transaction 1 receiver must be the Smart Router application address.");
  }
  if (txn.assetTransfer.assetIndex !== String(assetId)) {
    errors.push(
      `Transaction 1 asset must be asset id ${assetId}, got ${txn.assetTransfer.assetIndex}.`
    );
  }
  if (txn.assetTransfer.amount !== amount.toString()) {
    errors.push("Transaction 1 amount must equal the requested source amount.");
  }
}

function validateSwapTxn(params: {
  txn: SerializedTransaction | undefined;
  label: string;
  userAddress: string;
  routerAppId: number;
  packed: ReturnType<typeof packRouterSwaps>[number] | undefined;
  errors: string[];
}): void {
  const { txn, label, userAddress, routerAppId, packed, errors } = params;
  if (txn === undefined || txn.type !== "appl" || !txn.applicationCall || packed === undefined) {
    errors.push(`${label} must be a Smart Router SWAP application call.`);
    return;
  }
  if (txn.sender !== userAddress) {
    errors.push(`${label} sender must be the user address.`);
  }
  if (txn.applicationCall.appIndex !== String(routerAppId)) {
    errors.push(
      `${label} must call the Pact Smart Router app (${routerAppId}), got ${txn.applicationCall.appIndex}.`
    );
  }
  const selector = readAppCallSelectorHex(txn.applicationCall.appArgsBase64);
  const expected =
    packed.variant === "one" ? SWAP_ONE_HOP_SELECTOR_HEX : SWAP_TWO_HOP_SELECTOR_HEX;
  if (selector !== expected) {
    errors.push(
      `${label} first app arg must be the ${packed.variant === "one" ? "1-hop" : "2-hop"} SWAP selector (${expected}).`
    );
  }
  const poolAppIds =
    packed.variant === "one"
      ? [packed.hop.poolAppId]
      : [packed.hopA.poolAppId, packed.hopB.poolAppId];
  for (const poolAppId of poolAppIds) {
    if (!txn.applicationCall.foreignApps.includes(String(poolAppId))) {
      errors.push(`${label} foreign apps must include pool ${poolAppId}.`);
    }
  }
  const escrows =
    packed.variant === "one"
      ? [packed.hop.poolEscrowAddress]
      : [packed.hopA.poolEscrowAddress, packed.hopB.poolEscrowAddress];
  for (const escrow of escrows) {
    if (!txn.applicationCall.accounts.includes(escrow)) {
      errors.push(`${label} accounts must include pool escrow ${escrow}.`);
    }
  }
  if (BigInt(txn.fee) < MIN_ALGO_FEE) {
    errors.push(`${label} fee must be at least ${MIN_ALGO_FEE} microAlgos, got ${txn.fee}.`);
  }
}

function mapSmartRouterError(error: unknown): Error {
  if (error instanceof PactSmartRouterError) {
    if (error.kind === "validation") {
      return new InvalidShapeInputError(error.message, error.details);
    }
    if (error.kind === "configuration" || error.kind === "no-route" || error.kind === "upstream") {
      return new ShapeStateError(error.message, { details: error.details, cause: error });
    }
  }
  if (error instanceof InvalidShapeInputError || error instanceof ShapeStateError) {
    return error;
  }
  return new ShapeStateError("Pact Smart Router quote failed.", { cause: error });
}
