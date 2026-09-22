import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  baseTransferTypedData,
  encodeBasePaymentSignature,
  type BaseTransferTypedDataInput
} from "./base-typed-data.js";
import { type PaymentRequest } from "./protocol.js";

export {
  BASE_CHAIN_ID,
  BASE_USDC_ASSET_ADDRESS,
  BASE_USDC_EIP712_NAME,
  BASE_USDC_EIP712_VERSION,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  baseTransferTypedData,
  encodeBasePaymentSignature,
  getBaseAccept,
  isBasePaymentNetwork,
  tryGetBaseAccept,
  type BaseTransferTypedData,
  type BaseTransferTypedDataInput,
  type EncodeBasePaymentSignatureInput,
  type ExactEip3009Authorization
} from "./base-typed-data.js";

export interface BuildBasePaymentSignatureInput {
  paymentRequest: PaymentRequest;
  requestUrl: string;
  /** 0x-prefixed secp256k1 private key. Never send this to the API. */
  privateKey: string;
  nowSeconds?: number;
  nonce?: Hex;
  validitySeconds?: number;
}

export async function buildBasePaymentSignature(
  input: BuildBasePaymentSignatureInput
): Promise<string> {
  const account = privateKeyToAccount(parsePrivateKey(input.privateKey));
  const typedInput: BaseTransferTypedDataInput = {
    paymentRequest: input.paymentRequest,
    from: account.address
  };
  if (input.nowSeconds !== undefined) {
    typedInput.nowSeconds = input.nowSeconds;
  }
  if (input.nonce !== undefined) {
    typedInput.nonce = input.nonce;
  }
  if (input.validitySeconds !== undefined) {
    typedInput.validitySeconds = input.validitySeconds;
  }
  const typed = baseTransferTypedData(typedInput);
  const signature = await account.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message
  });

  return encodeBasePaymentSignature({
    paymentRequest: input.paymentRequest,
    requestUrl: input.requestUrl,
    typed,
    signature
  });
}

function parsePrivateKey(value: string): Hex {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("Base payment private key must be a 0x-prefixed 32-byte hex string.");
  }
  return trimmed as Hex;
}
