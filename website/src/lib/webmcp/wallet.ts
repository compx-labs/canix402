import { NetworkId, WalletManager } from "@txnlab/use-wallet";
import { defly, WALLET_ID as DEFLY } from "@txnlab/use-wallet-defly";
import { pera, WALLET_ID as PERA } from "@txnlab/use-wallet-pera";

import type { SignTransactionsFn, SuggestedTxnParams } from "./x402-wallet-payment";

export const WEBMCP_WALLET_IDS = [PERA, DEFLY] as const;

export type WebmcpWalletId = (typeof WEBMCP_WALLET_IDS)[number];

let manager: WalletManager | null = null;

export function getWebmcpWalletManager(): WalletManager {
  if (!manager) {
    manager = new WalletManager({
      wallets: [pera(), defly()],
      defaultNetwork: NetworkId.MAINNET
    });
  }
  return manager;
}

export async function resumeWebmcpWallet(): Promise<WalletManager> {
  const instance = getWebmcpWalletManager();
  await instance.resumeSessions();
  return instance;
}

export async function connectWebmcpWallet(walletId: WebmcpWalletId): Promise<string> {
  const instance = getWebmcpWalletManager();
  const wallet = instance.getWallet(walletId);
  if (!wallet) {
    throw Object.assign(new Error(`Wallet ${walletId} is not configured.`), {
      code: "WALLET_UNAVAILABLE"
    });
  }
  await wallet.connect();
  const address = instance.activeAddress;
  if (!address) {
    throw Object.assign(new Error("Wallet connected but no active address was returned."), {
      code: "WALLET_UNAVAILABLE"
    });
  }
  return address;
}

export async function disconnectWebmcpWallet(): Promise<void> {
  await getWebmcpWalletManager().disconnect();
}

export function getActiveWalletAddress(): string | null {
  return manager?.activeAddress ?? null;
}

export function webmcpWalletSignTransactions(): SignTransactionsFn {
  return async (txnGroup, indexesToSign) => {
    const instance = getWebmcpWalletManager();
    if (!instance.activeWallet) {
      throw Object.assign(new Error("Connect Pera or Defly before paying."), {
        code: "WALLET_REQUIRED"
      });
    }
    return instance.signTransactions(txnGroup, indexesToSign);
  };
}

export async function fetchSuggestedParamsFromWallet(): Promise<SuggestedTxnParams> {
  return getWebmcpWalletManager().algodClient.getTransactionParams().do();
}

export function listWebmcpWallets(): Array<{ id: string; name: string; icon: string }> {
  return getWebmcpWalletManager().wallets.map((wallet) => ({
    id: wallet.id,
    name: wallet.metadata.name,
    icon: wallet.metadata.icon
  }));
}
