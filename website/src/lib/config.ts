const defaultGateway = "https://canix402-api.compx.io";
const defaultMcpBaseUrl = "https://canix402-mcp.compx.io";

export const site = {
  supportEmail: "kieran@neonforge.ltd",
  operator: "Neon Forge Ltd"
} as const;

const gatewayBaseUrl = import.meta.env.PUBLIC_GATEWAY_BASE_URL ?? defaultGateway;
const mcpBaseUrl = (
  import.meta.env.PUBLIC_MCP_URL ?? `${defaultMcpBaseUrl}/mcp`
).replace(/\/mcp\/?$/, "");

export const config = {
  gatewayBaseUrl,
  discoveryUrl:
    import.meta.env.PUBLIC_DISCOVERY_URL ?? `${gatewayBaseUrl}/discovery`,
  openApiUrl:
    import.meta.env.PUBLIC_OPENAPI_URL ?? `${gatewayBaseUrl}/openapi.json`,
  mcpUrl: import.meta.env.PUBLIC_MCP_URL ?? `${mcpBaseUrl}/mcp`,
  mcpWellKnownUrl:
    import.meta.env.PUBLIC_MCP_WELL_KNOWN_URL ?? `${mcpBaseUrl}/.well-known/mcp`,
  mcpTransport: "streamable-http" as const,
  payToAddress:
    import.meta.env.PUBLIC_PAY_TO_ADDRESS ??
    "3Y2V6ODUVUGM4TXOEXY65YLMKMVLG4PB3GSOXDCJDE4X5YQA5JA3P2FHAQ",
  usdcAssetId: import.meta.env.PUBLIC_USDC_ASSET_ID ?? "31566704",
  indexerBaseUrl:
    import.meta.env.PUBLIC_INDEXER_BASE_URL ?? "https://mainnet-idx.4160.nodely.dev",
  alloTxBaseUrl: import.meta.env.PUBLIC_ALLO_TX_BASE_URL ?? "https://allo.info/tx",
  transactionsRefreshMs: Number(
    import.meta.env.PUBLIC_TRANSACTIONS_REFRESH_MS ?? "120000"
  )
};

export const supportedProtocols = [
  "Tinyman",
  "Pact",
  "Folks Finance",
  "CompX",
  "Dork.fi",
  "Myth Finance",
  "Haystack",
  "Réti"
] as const;

export const defaultPaidPriceUsdc = "0.01";
export const personalizedPriceUsdc = "0.05";
export const positionsPriceUsdc = "0.005";
export const executionQuotePriceUsdc = "0.1";
export const strategyPublishPriceUsdc = "100";
export const strategyRevisePriceUsdc = "1";
export const strategyCompilePriceUsdc = "0.1";

/** Canonical MCP tool names — aligned with API discovery metadata. */
export const mcpToolNames = [
  "canix_health",
  "canix_get_metadata",
  "canix_get_discovery",
  "canix_get_openapi",
  "canix_get_token_prices",
  "canix_list_execution_shapes",
  "canix_list_opportunities",
  "canix_search_opportunities",
  "canix_get_personalized_opportunities",
  "canix_get_protocol_opportunities",
  "canix_get_positions",
  "canix_get_execution_quote",
  "canix_list_strategies",
  "canix_get_strategy",
  "canix_publish_strategy",
  "canix_revise_strategy",
  "canix_compile_strategy",
  "canix_get_quote",
  "canix_optin",
  "canix_swap"
] as const;
