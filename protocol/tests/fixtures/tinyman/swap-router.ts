import algosdk from "algosdk";
import { SwapType, type SwapRouterResponse, type SwapRouterTransactionRecipe } from "@tinymanorg/tinyman-js-sdk";

import { USDC_ASSET_ID } from "../../../src/execution/shapes/haystack/constants.js";

/** Tinyman Swap Router app (mainnet), from `@tinymanorg/tinyman-js-sdk`. */
export const TINYMAN_SWAP_ROUTER_APP_ID = 3_119_560_942;
/** Tinyman AMM v2 validator (mainnet). */
export const TINYMAN_V2_VALIDATOR_APP_ID = 1_002_541_853;

export const COMPX_ASSET_ID = 1_732_165_149;
export const ALGO_ASSET_ID = 0;
export { USDC_ASSET_ID };

export const POOL_COMPX_ALGO = algosdk.generateAccount().addr.toString();
export const POOL_ALGO_USDC = algosdk.generateAccount().addr.toString();
export const POOL_COMPX_USDC = algosdk.generateAccount().addr.toString();

export const TWO_HOP_INPUT_AMOUNT = 1_000_000n;
export const TWO_HOP_ROUTER_OUTPUT = 250_000n;
export const TWO_HOP_ROUTER_MIN_OUT = 247_500n;
export const TWO_HOP_DIRECT_OUTPUT = 200_000n;
export const TWO_HOP_ROUTER_FEE = 9_000n;
export const DIRECT_FIXED_INPUT_FEE = 3_000n;

export const ONE_HOP_INPUT_AMOUNT = 1_000_000n;
export const ONE_HOP_ROUTER_OUTPUT = 1_010_000n;
export const ONE_HOP_ROUTER_MIN_OUT = 999_900n;
export const ONE_HOP_DIRECT_OUTPUT = 1_000_000n;
export const ONE_HOP_ROUTER_FEE = 8_000n;

const utf8 = new TextEncoder();

export function tinymanSwapRouterAppAddress(): string {
  return algosdk.getApplicationAddress(TINYMAN_SWAP_ROUTER_APP_ID).toString();
}

export function twoHopRouterResponse(
  overrides: Partial<SwapRouterResponse> = {}
): SwapRouterResponse {
  const routerAddress = tinymanSwapRouterAppAddress();
  return {
    swap_type: SwapType.FixedInput,
    input_amount: TWO_HOP_INPUT_AMOUNT.toString(),
    output_amount: TWO_HOP_ROUTER_OUTPUT.toString(),
    slippage: "0.005",
    input_asset: {
      id: String(COMPX_ASSET_ID),
      decimals: 6,
      name: "CompX",
      unit_name: "COMPX"
    },
    output_asset: {
      id: String(USDC_ASSET_ID),
      decimals: 6,
      name: "USDC",
      unit_name: "USDC"
    },
    input_amount_arg: TWO_HOP_INPUT_AMOUNT.toString(),
    output_amount_arg: TWO_HOP_ROUTER_MIN_OUT.toString(),
    input_amount_mapping: [TWO_HOP_INPUT_AMOUNT.toString(), "500000"],
    pool_mapping: [[POOL_COMPX_ALGO], [POOL_ALGO_USDC]],
    asset_mapping: [
      [COMPX_ASSET_ID, ALGO_ASSET_ID],
      [ALGO_ASSET_ID, USDC_ASSET_ID]
    ],
    asset_in_algo_price: "0.12",
    price_impact: "0.004",
    transactions: twoHopRouterRecipes(routerAddress, TWO_HOP_INPUT_AMOUNT, TWO_HOP_ROUTER_MIN_OUT),
    transaction_fee: TWO_HOP_ROUTER_FEE.toString(),
    transaction_fee_in_input_asset: "75",
    swap_fee: "750",
    swap_fee_algo_price: "0.0003",
    status: {
      round_number: "50000000",
      round_datetime: "2026-09-07T00:00:00.000Z"
    },
    ...overrides
  };
}

export function oneHopRouterResponse(
  overrides: Partial<SwapRouterResponse> = {}
): SwapRouterResponse {
  const routerAddress = tinymanSwapRouterAppAddress();
  return {
    ...twoHopRouterResponse(),
    input_amount: ONE_HOP_INPUT_AMOUNT.toString(),
    output_amount: ONE_HOP_ROUTER_OUTPUT.toString(),
    input_asset: {
      id: "0",
      decimals: 6,
      name: "ALGO",
      unit_name: "ALGO"
    },
    output_asset: {
      id: String(USDC_ASSET_ID),
      decimals: 6,
      name: "USDC",
      unit_name: "USDC"
    },
    input_amount_arg: ONE_HOP_INPUT_AMOUNT.toString(),
    output_amount_arg: ONE_HOP_ROUTER_MIN_OUT.toString(),
    input_amount_mapping: [ONE_HOP_INPUT_AMOUNT.toString()],
    pool_mapping: [[POOL_ALGO_USDC]],
    asset_mapping: [[ALGO_ASSET_ID, USDC_ASSET_ID]],
    price_impact: "0.001",
    transactions: oneHopRouterRecipes(routerAddress, ONE_HOP_INPUT_AMOUNT, ONE_HOP_ROUTER_MIN_OUT),
    transaction_fee: ONE_HOP_ROUTER_FEE.toString(),
    ...overrides
  };
}

function twoHopRouterRecipes(
  routerAddress: string,
  inputAmount: bigint,
  minOut: bigint
): SwapRouterTransactionRecipe[] {
  return [
    {
      type: algosdk.TransactionType.axfer,
      receiver: routerAddress,
      app_id: 0,
      asset_id: COMPX_ASSET_ID,
      amount: Number(inputAmount),
      args: null,
      accounts: [],
      assets: [],
      apps: []
    },
    swapAppRecipe(minOut, [POOL_COMPX_ALGO, POOL_ALGO_USDC], [
      COMPX_ASSET_ID,
      USDC_ASSET_ID
    ])
  ];
}

function oneHopRouterRecipes(
  routerAddress: string,
  inputAmount: bigint,
  minOut: bigint
): SwapRouterTransactionRecipe[] {
  return [
    {
      type: algosdk.TransactionType.pay,
      receiver: routerAddress,
      app_id: 0,
      asset_id: 0,
      amount: Number(inputAmount),
      args: null,
      accounts: [],
      assets: [],
      apps: []
    },
    swapAppRecipe(minOut, [POOL_ALGO_USDC], [USDC_ASSET_ID])
  ];
}

function swapAppRecipe(
  minOut: bigint,
  pools: string[],
  assets: number[]
): SwapRouterTransactionRecipe {
  return {
    type: algosdk.TransactionType.appl,
    receiver: "",
    app_id: TINYMAN_SWAP_ROUTER_APP_ID,
    asset_id: 0,
    amount: 0,
    args: [
      Buffer.from(utf8.encode("swap")).toString("base64"),
      Buffer.from(utf8.encode("fixed-input")).toString("base64"),
      Buffer.from(algosdk.encodeUint64(minOut)).toString("base64")
    ],
    accounts: pools,
    assets,
    apps: [TINYMAN_V2_VALIDATOR_APP_ID]
  };
}

export function suggestedParams(fee = 1000): algosdk.SuggestedParams {
  return {
    fee: BigInt(fee),
    minFee: 1000n,
    firstValid: 1000n,
    lastValid: 2000n,
    genesisID: "mainnet-v1.0",
    genesisHash: new Uint8Array(32).fill(9),
    flatFee: true
  };
}

/**
 * Documented Swap Router outer group: input transfer/pay + router `swap` app call.
 * Inner pool hops are executed by the router app; Canix never signs or submits.
 */
export function buildRouterSwapGroup(params: {
  userAddress: string;
  assetInId: number;
  inputAmount: bigint;
  minOut: bigint;
  poolAddresses: string[];
  foreignAssets: number[];
  fee: bigint;
}): algosdk.Transaction[] {
  const sender = params.userAddress;
  const routerAddress = tinymanSwapRouterAppAddress();
  const inputTxn =
    params.assetInId === ALGO_ASSET_ID
      ? algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender,
          receiver: routerAddress,
          amount: params.inputAmount,
          suggestedParams: suggestedParams(0)
        })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender,
          receiver: routerAddress,
          amount: params.inputAmount,
          assetIndex: params.assetInId,
          suggestedParams: suggestedParams(0)
        });
  inputTxn.fee = 0n;

  const appTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    appIndex: BigInt(TINYMAN_SWAP_ROUTER_APP_ID),
    appArgs: [utf8.encode("swap"), utf8.encode("fixed-input"), algosdk.encodeUint64(params.minOut)],
    accounts: params.poolAddresses,
    foreignApps: [TINYMAN_V2_VALIDATOR_APP_ID],
    foreignAssets: params.foreignAssets.filter((id) => id !== ALGO_ASSET_ID),
    suggestedParams: suggestedParams(0)
  });
  appTxn.fee = 0n;

  const group = [inputTxn, appTxn];
  group[0]!.fee = params.fee;
  algosdk.assignGroupID(group);
  return group;
}

export function buildDirectSwapGroup(params: {
  userAddress: string;
  poolAddress: string;
  assetInId: number;
  inputAmount: bigint;
  minOut: bigint;
}): algosdk.Transaction[] {
  const sender = params.userAddress;
  const inputTxn =
    params.assetInId === ALGO_ASSET_ID
      ? algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender,
          receiver: params.poolAddress,
          amount: params.inputAmount,
          suggestedParams: suggestedParams(1000)
        })
      : algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender,
          receiver: params.poolAddress,
          amount: params.inputAmount,
          assetIndex: params.assetInId,
          suggestedParams: suggestedParams(1000)
        });

  const appTxn = algosdk.makeApplicationNoOpTxnFromObject({
    sender,
    appIndex: BigInt(TINYMAN_V2_VALIDATOR_APP_ID),
    appArgs: [utf8.encode("swap"), utf8.encode("fixed-input"), algosdk.encodeUint64(params.minOut)],
    accounts: [params.poolAddress],
    foreignAssets: [params.assetInId, USDC_ASSET_ID].filter((id) => id !== ALGO_ASSET_ID),
    suggestedParams: suggestedParams(2000)
  });

  const group = [inputTxn, appTxn];
  algosdk.assignGroupID(group);
  return group;
}
