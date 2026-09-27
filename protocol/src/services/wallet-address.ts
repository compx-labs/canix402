import algosdk from "algosdk";

import { isEvmAddress, normalizeEvmAddress } from "../execution/evm.js";

export type WalletAddress =
  | { family: "algorand"; address: string }
  | { family: "base"; address: string };

export function parseWalletAddress(value: string): WalletAddress | null {
  if (algosdk.isValidAddress(value)) {
    return { family: "algorand", address: value };
  }
  if (isEvmAddress(value)) {
    return { family: "base", address: normalizeEvmAddress(value) };
  }
  return null;
}

export const WALLET_ADDRESS_ERROR =
  "Address is not a valid Algorand address or a 20-byte Base address.";
