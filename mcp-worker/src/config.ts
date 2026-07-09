export interface WorkerEnv {
  CANIX402_GATEWAY_URL?: string;
  CANIX402_MCP_PUBLIC_URL?: string;
  CANIX402_NETWORK?: string;
}

export interface WorkerConfig {
  gatewayUrl: string;
  publicUrl: string;
  network: string;
}

const DEFAULT_GATEWAY_URL = "https://canix402-api.compx.io";
const DEFAULT_PUBLIC_URL = "https://mcp.canix402.com/mcp";
const DEFAULT_NETWORK = "algorand-mainnet";

export function loadWorkerConfig(env: WorkerEnv, requestUrl?: string): WorkerConfig {
  const gatewayUrl = trimTrailingSlash(env.CANIX402_GATEWAY_URL || DEFAULT_GATEWAY_URL);
  const publicUrl = trimTrailingSlash(
    env.CANIX402_MCP_PUBLIC_URL
      || (requestUrl ? `${new URL(requestUrl).origin}/mcp` : DEFAULT_PUBLIC_URL)
  );

  return {
    gatewayUrl,
    publicUrl,
    network: env.CANIX402_NETWORK || DEFAULT_NETWORK
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
