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
  connectorId: string;
  name: string;
  icon?: string;
}

export interface KnownBaseWallet {
  id: string;
  name: string;
  installUrl: string;
  match: (connectorId: string, connectorName: string) => boolean;
}

export const KNOWN_BASE_WALLETS: KnownBaseWallet[] = [
  {
    id: "metaMask",
    name: "MetaMask",
    installUrl: "https://metamask.io/download/",
    match: (connectorId, connectorName) => /metamask/i.test(connectorId) || /metamask/i.test(connectorName)
  },
  {
    id: "rabby",
    name: "Rabby",
    installUrl: "https://rabby.io/",
    match: (connectorId, connectorName) => /rabby/i.test(connectorId) || /rabby/i.test(connectorName)
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    installUrl: "https://www.coinbase.com/wallet/downloads",
    match: (connectorId, connectorName) => /coinbase/i.test(connectorId) || /coinbase/i.test(connectorName)
  }
];

export interface BaseWalletChoiceRow extends BaseWalletChoice {
  detected: boolean;
  installUrl?: string;
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
      connectorId: connector.id,
      name: connector.id === GENERIC_INJECTED_ID ? "Browser wallet" : connector.name
    };
    if (connector.icon) {
      choice.icon = connector.icon;
    }
    return choice;
  });
}

export function listBaseWalletChoices(): BaseWalletChoiceRow[] {
  const detected = listBaseWalletButtons();
  const claimed = new Set<string>();
  const rows: BaseWalletChoiceRow[] = [];

  for (const known of KNOWN_BASE_WALLETS) {
    const match = detected.find(
      (wallet) => !claimed.has(wallet.uid) && known.match(wallet.connectorId, wallet.name)
    );
    if (match) {
      claimed.add(match.uid);
      rows.push({ ...match, name: known.name, detected: true });
      continue;
    }
    rows.push({
      uid: "",
      connectorId: known.id,
      name: known.name,
      detected: false,
      installUrl: known.installUrl
    });
  }

  for (const wallet of detected) {
    if (claimed.has(wallet.uid)) {
      continue;
    }
    const alreadyKnown = KNOWN_BASE_WALLETS.some((known) => known.match(wallet.connectorId, wallet.name));
    if (alreadyKnown) {
      continue;
    }
    rows.push({ ...wallet, detected: true });
  }

  return rows;
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

export function getBaseWalletMeta(): { name: string; icon?: string; address: string } | null {
  if (!config) {
    return null;
  }
  const connection = getConnection(config);
  if (connection.status !== "connected") {
    return null;
  }
  const meta: { name: string; icon?: string; address: string } = {
    name: connection.connector.name,
    address: connection.address
  };
  if (connection.connector.icon) {
    meta.icon = connection.connector.icon;
  }
  return meta;
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
