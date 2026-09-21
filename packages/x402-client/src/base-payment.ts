import { randomBytes } from "node:crypto";

import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { type PaymentRequest, type PaymentRequestAccept } from "./protocol.js";

/** Circle USDC on Base. EIP-712 name/version match the GoPlausible exact EVM scheme. */
export const BASE_USDC_ASSET_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_USDC_EIP712_NAME = "USD Coin";
export const BASE_USDC_EIP712_VERSION = "2";
export const BASE_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const DEFAULT_VALIDITY_SECONDS = 60 * 60;
const VALID_AFTER_SKEW_SECONDS = 600;

export interface ExactEip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface BuildBasePaymentSignatureInput {
  paymentRequest: PaymentRequest;
  requestUrl: string;
  /** 0x-prefixed secp256k1 private key. Never send this to the API. */
  privateKey: string;
  nowSeconds?: number;
  nonce?: Hex;
  validitySeconds?: number;
}

export function isBasePaymentNetwork(network: string): boolean {
  const normalized = network.trim().toLowerCase();
  return (
    normalized === "base"
    || normalized === "base-mainnet"
    || normalized === "eip155:8453"
    || normalized === "base-sepolia"
    || normalized === "eip155:84532"
  );
}

export function tryGetBaseAccept(
  paymentRequest: PaymentRequest
): PaymentRequestAccept | undefined {
  return paymentRequest.accepts.find((accept) => isBasePaymentNetwork(accept.network));
}

export function getBaseAccept(paymentRequest: PaymentRequest): PaymentRequestAccept {
  const accepted = tryGetBaseAccept(paymentRequest);
  if (!accepted) {
    throw new Error(
      `PAYMENT-REQUIRED does not contain a Base accept option. Networks: ${paymentRequest.accepts
        .map((accept) => accept.network)
        .join(", ")}`
    );
  }
  return accepted;
}

export async function buildBasePaymentSignature(
  input: BuildBasePaymentSignatureInput
): Promise<string> {
  const accepted = getBaseAccept(input.paymentRequest);
  const rawAmount = accepted.maxAmountRequired ?? accepted.amount;
  if (!rawAmount) {
    throw new Error("Accepted payment option is missing amount/maxAmountRequired.");
  }
  if (accepted.scheme && accepted.scheme !== "exact") {
    throw new Error(`Unsupported Base payment scheme: ${accepted.scheme}`);
  }

  const normalizedAmount = rawAmount.includes(".") ? usdcToMicro(rawAmount) : rawAmount;
  const chainId = chainIdForNetwork(accepted.network);
  const asset = getAddress(accepted.asset || BASE_USDC_ASSET_ADDRESS);
  const payTo = getAddress(accepted.payTo);
  const account = privateKeyToAccount(parsePrivateKey(input.privateKey));
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const validAfter = now - VALID_AFTER_SKEW_SECONDS;
  const validBefore = now + (input.validitySeconds ?? DEFAULT_VALIDITY_SECONDS);
  const nonce = input.nonce ?? randomNonce();
  const { name, version } = tokenDomain(accepted, chainId);

  const signature = await account.signTypedData({
    domain: {
      name,
      version,
      chainId,
      verifyingContract: asset
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: payTo,
      value: BigInt(normalizedAmount),
      validAfter: BigInt(validAfter),
      validBefore: BigInt(validBefore),
      nonce
    }
  });

  const authorization: ExactEip3009Authorization = {
    from: account.address,
    to: payTo,
    value: normalizedAmount,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce
  };

  const paymentSignaturePayload = {
    x402Version: input.paymentRequest.x402Version ?? 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network,
    resource: input.paymentRequest.resource ?? { url: input.requestUrl },
    accepted: {
      ...accepted,
      amount: normalizedAmount
    },
    extensions: input.paymentRequest.extensions ?? {},
    outputSchema: null,
    payload: {
      signature,
      authorization
    },
    paymentRequired: input.paymentRequest
  };

  return Buffer.from(JSON.stringify(paymentSignaturePayload), "utf-8").toString("base64");
}

function parsePrivateKey(value: string): Hex {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("Base payment private key must be a 0x-prefixed 32-byte hex string.");
  }
  return trimmed as Hex;
}

function randomNonce(): Hex {
  return `0x${randomBytes(32).toString("hex")}`;
}

function chainIdForNetwork(network: string): number {
  const normalized = network.trim().toLowerCase();
  if (normalized === "base" || normalized === "base-mainnet" || normalized === "eip155:8453") {
    return BASE_CHAIN_ID;
  }
  if (normalized === "base-sepolia" || normalized === "eip155:84532") {
    return BASE_SEPOLIA_CHAIN_ID;
  }
  throw new Error(`Unsupported Base payment network: ${network}`);
}

function tokenDomain(
  accepted: PaymentRequestAccept,
  chainId: number
): { name: string; version: string } {
  const extra = accepted.extra;
  let name = chainId === BASE_SEPOLIA_CHAIN_ID ? "USDC" : BASE_USDC_EIP712_NAME;
  let version = BASE_USDC_EIP712_VERSION;
  if (extra && typeof extra === "object") {
    const record = extra as Record<string, unknown>;
    if (typeof record.name === "string" && record.name.trim()) {
      name = record.name;
    }
    if (typeof record.version === "string" && record.version.trim()) {
      version = record.version;
    }
  }
  return { name, version };
}

function usdcToMicro(usdcAmount: string): string {
  const [wholePart = "0", fractionPart = ""] = usdcAmount.split(".");
  const paddedFraction = `${fractionPart}000000`.slice(0, 6);
  return `${BigInt(wholePart) * 1_000_000n + BigInt(paddedFraction)}`;
}
