export interface McpConfig {
  apiUrl: string;
  algodUrl: string;
  network: string;
  walletMnemonic: string | undefined;
}

const DEFAULT_API_URL = "https://canix402-api.compx.io";
const DEFAULT_ALGOD_URL = "https://mainnet-api.algonode.cloud";
const DEFAULT_NETWORK = "algorand-mainnet";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const apiUrl = trimTrailingSlash(
    env.CANIX402_API_URL?.trim() || DEFAULT_API_URL
  );
  const algodUrl = trimTrailingSlash(
    env.CANIX402_ALGOD_URL?.trim()
      || env.X402_ALGOD_URL?.trim()
      || DEFAULT_ALGOD_URL
  );
  const network = env.CANIX402_NETWORK?.trim() || DEFAULT_NETWORK;
  const walletMnemonic =
    env.CANIX402_WALLET_MNEMONIC?.trim()
    || env.X402_CLIENT_MNEMONIC?.trim()
    || undefined;

  return {
    apiUrl,
    algodUrl,
    network,
    walletMnemonic
  };
}

export function hasWallet(config: McpConfig): boolean {
  return typeof config.walletMnemonic === "string" && config.walletMnemonic.length > 0;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
