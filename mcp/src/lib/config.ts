export interface McpConfig {
  apiUrl: string;
  network: string;
}

const DEFAULT_API_URL = "https://canix402-api.compx.io";
const DEFAULT_NETWORK = "algorand-mainnet";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const apiUrl = trimTrailingSlash(
    env.CANIX402_API_URL?.trim()
      || env.X402_PRODUCTION_BASE_URL?.trim()
      || DEFAULT_API_URL
  );
  const network = env.CANIX402_NETWORK?.trim() || DEFAULT_NETWORK;

  return {
    apiUrl,
    network
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
