import { coinbaseWallet } from "@wagmi/connectors/coinbaseWallet";
import {
  connect,
  createConfig,
  createStorage,
  disconnect,
  getConnection,
  getConnectors,
  http,
  injected,
  reconnect,
  signTypedData,
  switchChain,
  watchConnection,
  watchConnectors,
  type Config
} from "@wagmi/core";
import type { BaseTransferTypedData } from "@canix402/x402-client/base";
import type { Hex } from "viem";
import { base } from "viem/chains";

const COINBASE_CONNECTOR_ID = "coinbaseWalletSDK";
const GENERIC_INJECTED_ID = "injected";

export interface BaseWalletChoice {
  uid: string;
  name: string;
  icon?: string;
}

let config: Config | null = null;

function getBaseWalletConfig(): Config {
  if (!config) {
    config = createConfig({
      chains: [base],
      connectors: [
        injected({ shimDisconnect: true }),
        coinbaseWallet({
          appName: "Canix402",
          preference: { options: "eoaOnly" }
        })
      ],
      multiInjectedProviderDiscovery: true,
      storage:
        typeof localStorage === "undefined" ? null : createStorage({ storage: localStorage }),
      transports: {
        [base.id]: http()
      }
    });
  }
  return config;
}

export function listBaseWalletButtons(): BaseWalletChoice[] {
  const connectors = getConnectors(getBaseWalletConfig());
  const discovered = connectors.filter(
    (connector) => connector.type === "injected" && connector.id !== GENERIC_INJECTED_ID
  );
  const coinbase = connectors.filter((connector) => connector.id === COINBASE_CONNECTOR_ID);
  const fallback =
    discovered.length === 0
      ? connectors.filter((connector) => connector.id === GENERIC_INJECTED_ID)
      : [];
  return [...discovered, ...fallback, ...coinbase].map((connector) => {
    const choice: BaseWalletChoice = {
      uid: connector.uid,
      name: connector.id === GENERIC_INJECTED_ID ? "Browser wallet" : connector.name
    };
    if (connector.icon) {
      choice.icon = connector.icon;
    }
    return choice;
  });
}

export async function resumeBaseWallet(): Promise<void> {
  await reconnect(getBaseWalletConfig());
}

export function getBaseWalletAddress(): string | null {
  if (!config) {
    return null;
  }
  const connection = getConnection(config);
  return connection.status === "connected" ? connection.address : null;
}

export async function connectBaseWallet(uid: string): Promise<string> {
  const walletConfig = getBaseWalletConfig();
  const connector = getConnectors(walletConfig).find((item) => item.uid === uid);
  if (!connector) {
    throw Object.assign(new Error("That Base wallet is no longer available."), {
      code: "WALLET_UNAVAILABLE"
    });
  }
  try {
    const result = await connect(walletConfig, { connector, chainId: base.id });
    const address = result.accounts[0];
    if (!address) {
      throw Object.assign(new Error("Wallet connected but no account was returned."), {
        code: "WALLET_UNAVAILABLE"
      });
    }
    if (getConnection(walletConfig).chainId !== base.id) {
      try {
        await switchChain(walletConfig, { chainId: base.id });
      } catch (error) {
        await disconnect(walletConfig, { connector });
        throw error;
      }
    }
    return address;
  } catch (error) {
    if (error instanceof Error && /provider not found/i.test(error.message)) {
      throw Object.assign(
        new Error("No browser wallet was found. Install MetaMask, Rabby, or Coinbase Wallet."),
        { code: "WALLET_UNAVAILABLE" }
      );
    }
    throw error;
  }
}

export async function disconnectBaseWallet(): Promise<void> {
  if (!config) {
    return;
  }
  const connection = getConnection(config);
  if (!connection.connector) {
    return;
  }
  await disconnect(config, { connector: connection.connector });
}

export function watchBaseWallet(listeners: {
  onConnection?: () => void;
  onConnectors?: () => void;
}): () => void {
  const walletConfig = getBaseWalletConfig();
  const unwatchConnection = listeners.onConnection
    ? watchConnection(walletConfig, { onChange: listeners.onConnection })
    : () => undefined;
  const unwatchConnectors = listeners.onConnectors
    ? watchConnectors(walletConfig, { onChange: listeners.onConnectors })
    : () => undefined;
  return () => {
    unwatchConnection();
    unwatchConnectors();
  };
}

export async function signBaseTransferAuthorization(typed: BaseTransferTypedData): Promise<Hex> {
  const walletConfig = getBaseWalletConfig();
  const connection = getConnection(walletConfig);
  if (connection.status !== "connected") {
    throw Object.assign(new Error("Connect a Base wallet before paying."), {
      code: "WALLET_REQUIRED"
    });
  }
  if (connection.chainId !== base.id) {
    await switchChain(walletConfig, { chainId: base.id });
  }
  return signTypedData(walletConfig, {
    account: connection.address,
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message
  });
}
