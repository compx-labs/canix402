import algosdk, {
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";

import type { PactRouterHop } from "../../../services/pact-smart-router.js";
import { ALGO_ASSET_ID } from "./parse-input.js";

export const PACT_SWAP_ASA_ASA = "PACT_SWAP_ASA_ASA";
export const PACT_SWAP_ASA_ALGOS = "PACT_SWAP_ASA_ALGOS";
export const PACT_SWAP_ALGOS_ASA = "PACT_SWAP_ALGOS_ASA";

/** Outer + inner pool swap + inner asset transfer. */
export const PACT_SMART_ROUTER_ONE_HOP_FEE = 5_000n;
/** Packed 2-pool SWAP: two inner pool calls. */
export const PACT_SMART_ROUTER_TWO_HOP_FEE = 8_000n;
export const MIN_ALGO_FEE = 1_000n;

/**
 * ABI from pact-docs `router_interface.json`.
 * One-hop selector hex `3a8c06cf` / b64 `OowGzw==`.
 */
export const SWAP_ONE_HOP_METHOD = new algosdk.ABIMethod({
  name: "SWAP",
  args: [
    { type: "asset", name: "source_asset" },
    { type: "asset", name: "target_asset" },
    { type: "application", name: "pool_ID" },
    { type: "account", name: "address" },
    { type: "string", name: "interface" },
    { type: "uint64", name: "min_expected" }
  ],
  returns: { type: "void" }
});

/**
 * Packed two-hop SWAP. Selector hex `84dd8e10` / b64 `hN2OEA==`.
 */
export const SWAP_TWO_HOP_METHOD = new algosdk.ABIMethod({
  name: "SWAP",
  args: [
    { type: "asset", name: "source_asset" },
    { type: "asset", name: "target_asset" },
    { type: "application", name: "pool_ID" },
    { type: "account", name: "address" },
    { type: "string", name: "interface" },
    { type: "asset", name: "source_asset_2" },
    { type: "asset", name: "target_asset_2" },
    { type: "application", name: "pool_ID_2" },
    { type: "account", name: "address_2" },
    { type: "string", name: "interface_2" },
    { type: "uint64", name: "min_expected" }
  ],
  returns: { type: "void" }
});

export const SWAP_ONE_HOP_SELECTOR_HEX = Buffer.from(SWAP_ONE_HOP_METHOD.getSelector()).toString(
  "hex"
);
export const SWAP_TWO_HOP_SELECTOR_HEX = Buffer.from(SWAP_TWO_HOP_METHOD.getSelector()).toString(
  "hex"
);
export const SWAP_ONE_HOP_SELECTOR_B64 = Buffer.from(SWAP_ONE_HOP_METHOD.getSelector()).toString(
  "base64"
);
export const SWAP_TWO_HOP_SELECTOR_B64 = Buffer.from(SWAP_TWO_HOP_METHOD.getSelector()).toString(
  "base64"
);

export type PackedRouterSwap =
  | { variant: "one"; hop: PactRouterHop; minExpected: bigint }
  | { variant: "two"; hopA: PactRouterHop; hopB: PactRouterHop; minExpected: bigint };

export function pactSwapInterfaceName(fromAssetId: number, toAssetId: number): string {
  if (fromAssetId === ALGO_ASSET_ID) {
    return PACT_SWAP_ALGOS_ASA;
  }
  if (toAssetId === ALGO_ASSET_ID) {
    return PACT_SWAP_ASA_ALGOS;
  }
  return PACT_SWAP_ASA_ASA;
}

/**
 * Pack 1–3 hops into router SWAP calls. Two hops share one app call; three hops
 * are a 2-pool SWAP (min_expected ignored) plus a 1-pool SWAP (min_expected).
 */
export function packRouterSwaps(
  hops: readonly PactRouterHop[],
  minExpected: bigint
): PackedRouterSwap[] {
  if (hops.length === 0 || hops.length > 3) {
    throw new Error(`Pact Smart Router supports 1–3 hops, received ${hops.length}.`);
  }
  if (hops.length === 1) {
    const hop = hops[0];
    if (hop === undefined) {
      throw new Error("Pact Smart Router missing hop.");
    }
    return [{ variant: "one", hop, minExpected }];
  }
  if (hops.length === 2) {
    const hopA = hops[0];
    const hopB = hops[1];
    if (hopA === undefined || hopB === undefined) {
      throw new Error("Pact Smart Router missing packed hops.");
    }
    return [{ variant: "two", hopA, hopB, minExpected }];
  }
  const hopA = hops[0];
  const hopB = hops[1];
  const hopC = hops[2];
  if (hopA === undefined || hopB === undefined || hopC === undefined) {
    throw new Error("Pact Smart Router missing 3-hop legs.");
  }
  return [
    { variant: "two", hopA, hopB, minExpected: 0n },
    { variant: "one", hop: hopC, minExpected }
  ];
}

export function getPactSmartRouterAddress(routerAppId: number): string {
  return algosdk.getApplicationAddress(routerAppId).toString();
}

export function buildPactSmartRouterGroup(params: {
  userAddress: string;
  routerAppId: number;
  fromAssetId: number;
  amountIn: bigint;
  hops: readonly PactRouterHop[];
  minAmountOut: bigint;
  suggestedParams: algosdk.SuggestedParams;
}): Transaction[] {
  const routerAddress = getPactSmartRouterAddress(params.routerAppId);
  const atc = new AtomicTransactionComposer();
  const depositParams: algosdk.SuggestedParams = {
    ...params.suggestedParams,
    flatFee: true,
    fee: MIN_ALGO_FEE
  };

  if (params.fromAssetId === ALGO_ASSET_ID) {
    atc.addTransaction({
      txn: algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: params.userAddress,
        receiver: routerAddress,
        amount: params.amountIn,
        suggestedParams: depositParams
      }),
      signer: makeEmptyTransactionSigner()
    });
  } else {
    atc.addTransaction({
      txn: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: params.userAddress,
        receiver: routerAddress,
        amount: params.amountIn,
        assetIndex: params.fromAssetId,
        suggestedParams: depositParams
      }),
      signer: makeEmptyTransactionSigner()
    });
  }

  for (const packed of packRouterSwaps(params.hops, params.minAmountOut)) {
    addPackedSwapCall({
      atc,
      userAddress: params.userAddress,
      routerAppId: params.routerAppId,
      packed,
      suggestedParams: params.suggestedParams
    });
  }

  return atc.buildGroup().map((member) => member.txn);
}

function addPackedSwapCall(params: {
  atc: AtomicTransactionComposer;
  userAddress: string;
  routerAppId: number;
  packed: PackedRouterSwap;
  suggestedParams: algosdk.SuggestedParams;
}): void {
  if (params.packed.variant === "one") {
    const hop = params.packed.hop;
    params.atc.addMethodCall({
      appID: params.routerAppId,
      method: SWAP_ONE_HOP_METHOD,
      methodArgs: [
        hop.fromAssetId,
        hop.toAssetId,
        hop.poolAppId,
        hop.poolEscrowAddress,
        pactSwapInterfaceName(hop.fromAssetId, hop.toAssetId),
        params.packed.minExpected
      ],
      sender: params.userAddress,
      signer: makeEmptyTransactionSigner(),
      suggestedParams: withFlatFee(params.suggestedParams, PACT_SMART_ROUTER_ONE_HOP_FEE)
    });
    return;
  }

  const { hopA, hopB, minExpected } = params.packed;
  params.atc.addMethodCall({
    appID: params.routerAppId,
    method: SWAP_TWO_HOP_METHOD,
    methodArgs: [
      hopA.fromAssetId,
      hopA.toAssetId,
      hopA.poolAppId,
      hopA.poolEscrowAddress,
      pactSwapInterfaceName(hopA.fromAssetId, hopA.toAssetId),
      hopB.fromAssetId,
      hopB.toAssetId,
      hopB.poolAppId,
      hopB.poolEscrowAddress,
      pactSwapInterfaceName(hopB.fromAssetId, hopB.toAssetId),
      minExpected
    ],
    sender: params.userAddress,
    signer: makeEmptyTransactionSigner(),
    suggestedParams: withFlatFee(params.suggestedParams, PACT_SMART_ROUTER_TWO_HOP_FEE)
  });
}

export function readAppCallSelectorHex(
  appArgsBase64: readonly string[] | undefined
): string | undefined {
  const first = appArgsBase64?.[0];
  if (first === undefined) {
    return undefined;
  }
  return Buffer.from(first, "base64").toString("hex");
}

function withFlatFee(
  params: algosdk.SuggestedParams,
  fee: bigint
): algosdk.SuggestedParams {
  return {
    ...params,
    flatFee: true,
    fee
  };
}
