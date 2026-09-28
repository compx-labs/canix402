import algosdk, { Algodv2, type SuggestedParams, type Transaction } from "algosdk";
import { V2_ORDER_LINK_MODE } from "@pdex/sdk/constants";
import { buildV2CancelOrderTransactions } from "@pdex/sdk/transactions";

import { InvalidShapeInputError, ShapeBuildError, ShapeStateError } from "../../errors.js";
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
  loadMallowBookForRequest,
  readyMarket,
  type MallowAccountOrder,
  type MallowBook,
  type MallowPreparedMarket
} from "./book.js";
import { MALLOW_USDC_ASSET_ID } from "./constants.js";

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "mallow",
  protocolVersion: "v1",
  action: "cancelOrder",
  variant: "resting"
};

export interface MallowCancelOrderInput {
  userAddress: string;
  ownerOrderId: string;
}

export interface MallowCancelOrderState {
  market: MallowPreparedMarket;
  order: MallowAccountOrder;
  attachedTakeProfitOrderId?: bigint;
  attachedStopLossOrderId?: bigint;
}

export interface MallowCancelOrderDependencies {
  loadBook: () => Promise<MallowBook>;
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
}

let dependencyOverrides: Partial<MallowCancelOrderDependencies> | undefined;

export function setMallowCancelOrderDependenciesForTests(
  overrides?: Partial<MallowCancelOrderDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): MallowCancelOrderDependencies {
  return {
    loadBook: loadMallowBookForRequest,
    getSuggestedParams,
    ...dependencyOverrides
  };
}

async function getSuggestedParams(algod: Algodv2): Promise<SuggestedParams> {
  return algod.getTransactionParams().do();
}

function parseAddress(value: unknown): string {
  if (typeof value !== "string" || !algosdk.isValidAddress(value)) {
    throw new InvalidShapeInputError("userAddress must be a valid Algorand address.");
  }
  return value;
}

function parseOwnerOrderId(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value.toString();
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  throw new InvalidShapeInputError("ownerOrderId must be the resting order id.", {
    ownerOrderId: value
  });
}

function parseCancelInput(raw: unknown): MallowCancelOrderInput {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidShapeInputError("Cancel input must be an object.");
  }
  const input = raw as Record<string, unknown>;
  return {
    userAddress: parseAddress(input.userAddress),
    ownerOrderId: parseOwnerOrderId(input.ownerOrderId)
  };
}

function refuse(message: string, reason: string, extra?: Record<string, unknown>): never {
  throw new ShapeStateError(message, { details: { reason, ...extra } });
}

function selectOrder(orders: readonly MallowAccountOrder[], ownerOrderId: string): MallowAccountOrder {
  const order = orders.find((candidate) => candidate.ownerOrderId === ownerOrderId);
  if (!order) {
    refuse("That Mallow order is not on this wallet.", "order-not-found", { ownerOrderId });
  }
  return order;
}

/**
 * A bracket parent cancels with its take-profit and stop-loss box ids.
 * A lone child cancels by its own id.
 */
export function mallowCancelAttachments(order: MallowAccountOrder): {
  attachedTakeProfitOrderId?: bigint;
  attachedStopLossOrderId?: bigint;
} {
  if (order.orderKind !== "openLimit" || order.linkMode !== V2_ORDER_LINK_MODE.BRACKET_PARENT) {
    return {};
  }
  const base = order.linkBaseOrderId > 0n ? order.linkBaseOrderId : BigInt(order.ownerOrderId);
  if (base <= 0n) {
    return {};
  }
  return {
    attachedTakeProfitOrderId: base + 1n,
    attachedStopLossOrderId: base + 2n
  };
}

function rehydrate(transactions: readonly unknown[]): Transaction[] {
  return transactions.map((txn, index) => {
    if (!txn || typeof txn !== "object" || !("toByte" in txn) || typeof txn.toByte !== "function") {
      throw new ShapeBuildError(`Could not encode Mallow transaction ${index}.`);
    }
    const encoded = (txn as { toByte: () => Uint8Array }).toByte();
    return algosdk.decodeUnsignedTransaction(encoded);
  });
}

export const mallowCancelOrderShape: TransactionShapeSpec<MallowCancelOrderInput, MallowCancelOrderState> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Mallow cancel resting order",
  description:
    "Compiles an unsigned cancel of one resting Mallow order. An open limit with attached children " +
    "cancels the bracket together. A lone take-profit or stop-loss, including one left behind after a close, " +
    "cancels by its own id. Canix does not sign or submit.",
  supportedOpportunityTypes: ["perps"],
  opportunityRole: "exit",
  requiredInputs: ["userAddress", "ownerOrderId"],
  sources: [
    {
      kind: "sdk",
      description: "PEX public SDK cancel-order builder",
      url: "https://ppls.exchange/"
    },
    {
      kind: "api",
      description: "Mallow API proxy for PEX account orders",
      url: "https://usemallow.app"
    }
  ],

  parseInput: parseCancelInput,

  async resolveState(_context, input): Promise<MallowCancelOrderState> {
    const book = await resolveDependencies().loadBook();
    const order = selectOrder(await book.orders(input.userAddress), input.ownerOrderId);
    if (order.owner !== input.userAddress) {
      refuse("That Mallow order belongs to a different wallet.", "order-not-owned", {
        ownerOrderId: input.ownerOrderId
      });
    }
    if (!order.market || order.collateralAssetId !== MALLOW_USDC_ASSET_ID) {
      refuse("That order is not an ALGO/USD or BTC/USD USDC order.", "market-unavailable", {
        ownerOrderId: input.ownerOrderId
      });
    }
    const row = readyMarket(book, order.market);
    if (row.status !== "ok") {
      refuse(`${order.market}/USD is unavailable on Mallow.`, row.reason, { market: order.market });
    }
    return {
      market: row,
      order,
      ...mallowCancelAttachments(order)
    };
  },

  async build(context, input, state): Promise<ShapeBuildResult> {
    const suggestedParams = await resolveDependencies().getSuggestedParams(context.algod);
    let transactions: Transaction[];
    try {
      transactions = rehydrate(
        buildV2CancelOrderTransactions(
          {
            ...state.market.appRefs,
            v2OrderOpsAppId: state.market.orderOpsAppId,
            sender: input.userAddress,
            ownerOrderId: input.ownerOrderId,
            collateralAssetId: state.order.collateralAssetId,
            keeperFeeAssetId: state.order.keeperFeeAssetId || state.order.collateralAssetId,
            ...(state.attachedTakeProfitOrderId !== undefined
              ? { attachedTakeProfitOrderId: state.attachedTakeProfitOrderId }
              : {}),
            ...(state.attachedStopLossOrderId !== undefined
              ? { attachedStopLossOrderId: state.attachedStopLossOrderId }
              : {})
          },
          suggestedParams
        )
      );
    } catch (error) {
      if (error instanceof ShapeBuildError || error instanceof ShapeStateError) {
        throw error;
      }
      throw new ShapeBuildError(
        error instanceof Error ? error.message : "Failed to build the Mallow cancel.",
        { cause: error }
      );
    }

    return {
      transactions,
      warnings: [
        state.attachedTakeProfitOrderId !== undefined
          ? "This cancels the open limit and its attached take-profit and stop-loss orders."
          : "This cancels one resting order.",
        "Canix does not sign or submit."
      ],
      metadata: {
        protocol: "mallow",
        venue: "pex",
        market: state.order.market,
        marketId: state.market.marketId,
        side: state.order.side,
        ownerOrderId: state.order.ownerOrderId,
        orderKind: state.order.orderKind,
        attachedTakeProfitOrderId: state.attachedTakeProfitOrderId?.toString() ?? null,
        attachedStopLossOrderId: state.attachedStopLossOrderId?.toString() ?? null,
        collateralAssetId: state.order.collateralAssetId,
        builderAddress: null,
        builderFeeBps: 0,
        signed: false,
        submitted: false,
        executionSubmitted: false
      }
    };
  },

  validate(group, input): ShapeValidationResult {
    const errors: string[] = [];
    if (group.length === 0) {
      errors.push("Mallow cancel group is empty.");
    }
    for (const [index, txn] of group.entries()) {
      if (txn.sender !== input.userAddress) {
        errors.push(`Transaction ${index} sender is not the user.`);
      }
      if (group.length > 1 && !txn.groupPresent) {
        errors.push(`Transaction ${index} is not grouped.`);
      }
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  }
};

export function assertMallowCancelEncodes(input: {
  transactions: readonly SerializedTransaction[];
  orderIds: readonly bigint[];
  absentOrderIds?: readonly bigint[];
}): void {
  const blob = Buffer.concat(
    input.transactions.flatMap((txn) => [
      ...(txn.applicationCall?.appArgsBase64 ?? []).map((arg) => Buffer.from(arg, "base64")),
      ...(txn.applicationCall?.boxes ?? []).map((box) => Buffer.from(box.nameBase64, "base64"))
    ])
  );
  for (const orderId of input.orderIds) {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64BE(orderId);
    if (!blob.includes(bytes)) {
      throw new Error(`Cancel group is missing order id ${orderId.toString()}.`);
    }
  }
  for (const orderId of input.absentOrderIds ?? []) {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64BE(orderId);
    if (blob.includes(bytes)) {
      throw new Error(`Cancel group includes order id ${orderId.toString()}.`);
    }
  }
}
