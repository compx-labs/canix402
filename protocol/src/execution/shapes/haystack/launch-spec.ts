import algosdk from "algosdk";

import haystackLaunchArc56 from "../../../haystack-launch.arc56.json" with { type: "json" };

export const HAYSTACK_LAUNCH_ARC56 = haystackLaunchArc56;

const TOKEN_INFO_TUPLE =
  "(byte[1],uint64,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,byte[8],byte[32],byte[96],byte[1024],byte[256],byte[64],byte[64],byte[64],uint64,uint64)";

export const TOKEN_INFO_TYPE = algosdk.ABIType.from(TOKEN_INFO_TUPLE);

export const GAS_METHOD = algosdk.ABIMethod.fromSignature("gas()void");
export const MBR_TO_LAUNCH_METHOD = algosdk.ABIMethod.fromSignature("mbrToLaunchToken()uint64");
export const MBR_TO_LAUNCH_THEN_BUY_METHOD = algosdk.ABIMethod.fromSignature(
  "mbrToLaunchTokenThenBuy()uint64"
);
export const MBR_TO_BUY_METHOD = algosdk.ABIMethod.fromSignature("mbrToBuy(uint64)uint64");
export const IS_BONDING_TOKEN_SUPPORTED_METHOD = algosdk.ABIMethod.fromSignature(
  "isBondingTokenSupported(uint64)bool"
);
export const BONDING_TOKEN_PRICE_METHOD = algosdk.ABIMethod.fromSignature(
  "bondingTokenPrice(uint64)uint64"
);
export const PREVIEW_BONDING_METHOD = algosdk.ABIMethod.fromSignature(
  "previewBonding(uint64,uint64,uint64)(uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64)"
);
export const TOKENS_RECEIVED_FOR_BUY_METHOD = algosdk.ABIMethod.fromSignature(
  "tokensReceivedForBuy(uint64,uint64)uint64"
);
export const TOKENS_RECEIVED_AT_LAUNCH_METHOD = algosdk.ABIMethod.fromSignature(
  "tokensReceivedForBuyAtLaunch(uint64,uint64,uint64,uint64)uint64"
);
export const USER_HOLDINGS_METHOD = algosdk.ABIMethod.fromSignature(
  "userHoldings(uint64,address)uint64"
);
export const LAUNCH_TOKEN_METHOD = algosdk.ABIMethod.fromSignature(
  "launchToken(pay,string,string,string,string,string,string,string,string,uint64,uint64,uint64)uint64"
);
export const LAUNCH_TOKEN_THEN_BUY_METHOD = algosdk.ABIMethod.fromSignature(
  "launchTokenThenBuy(pay,axfer,string,string,string,string,string,string,string,string,uint64,uint64,uint64)uint64"
);
export const LAUNCH_TOKEN_THEN_BUY_ALGO_METHOD = algosdk.ABIMethod.fromSignature(
  "launchTokenThenBuyWithAlgo(pay,pay,string,string,string,string,string,string,string,string,uint64,uint64)uint64"
);
export const BUY_WITH_LIMIT_METHOD = algosdk.ABIMethod.fromSignature(
  "buyWithLimit(uint64,pay,axfer,uint64)uint64"
);
export const BUY_WITH_ALGO_LIMIT_METHOD = algosdk.ABIMethod.fromSignature(
  "buyWithAlgoWithLimit(uint64,pay,pay,uint64)uint64"
);

export const GAS_METHOD_SELECTOR_HEX = selectorHex(GAS_METHOD);
export const LAUNCH_TOKEN_SELECTOR_HEX = selectorHex(LAUNCH_TOKEN_METHOD);
export const LAUNCH_TOKEN_THEN_BUY_SELECTOR_HEX = selectorHex(LAUNCH_TOKEN_THEN_BUY_METHOD);
export const LAUNCH_TOKEN_THEN_BUY_ALGO_SELECTOR_HEX = selectorHex(LAUNCH_TOKEN_THEN_BUY_ALGO_METHOD);
export const BUY_WITH_LIMIT_SELECTOR_HEX = selectorHex(BUY_WITH_LIMIT_METHOD);
export const BUY_WITH_ALGO_LIMIT_SELECTOR_HEX = selectorHex(BUY_WITH_ALGO_LIMIT_METHOD);

export const LAUNCH_METHOD_SELECTORS = new Set([
  LAUNCH_TOKEN_SELECTOR_HEX,
  LAUNCH_TOKEN_THEN_BUY_SELECTOR_HEX,
  LAUNCH_TOKEN_THEN_BUY_ALGO_SELECTOR_HEX
]);

function selectorHex(method: algosdk.ABIMethod): string {
  return Buffer.from(method.getSelector()).toString("hex");
}

/** Token map box: `t` + big-endian token number. */
export function tokenBoxName(tokenNum: number | bigint): Uint8Array {
  return prefixedUint64(0x74, tokenNum);
}

/** Asset map box: `a` + big-endian asset id. Value is the token number. Populated after the first buy. */
export function assetBoxName(assetId: number | bigint): Uint8Array {
  return prefixedUint64(0x61, assetId);
}

/** User holding box: `ub` + address + big-endian token number. */
export function userHoldingBoxName(address: string, tokenNum: number | bigint): Uint8Array {
  const name = new Uint8Array(42);
  name.set(Buffer.from("ub"), 0);
  name.set(algosdk.decodeAddress(address).publicKey, 2);
  name.set(uint64Bytes(tokenNum), 34);
  return name;
}

function prefixedUint64(prefix: number, value: number | bigint): Uint8Array {
  const name = new Uint8Array(9);
  name[0] = prefix;
  name.set(uint64Bytes(value), 1);
  return name;
}

export function uint64Bytes(value: number | bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let remaining = BigInt(value);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export function readUint64(bytes: Uint8Array, offset = 0): bigint {
  let result = 0n;
  for (let index = 0; index < 8; index += 1) {
    result = (result << 8n) | BigInt(bytes[offset + index] ?? 0);
  }
  return result;
}
