export const MCP_SERVER_INSTALL_URL = "https://canix402.compx.io/x402#mcp" as const;
export const MCP_SERVER_REMOTE_URL = "https://canix402-mcp.compx.io/mcp" as const;
export const MCP_SERVER_TRANSPORT = "streamable-http" as const;

/** Canonical MCP tool names — single source of truth for discovery + server registration tests. */
export const MCP_TOOL_NAMES = [
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
  "canix_list_claimable",
  "canix_get_execution_quote",
  "canix_get_quote",
  "canix_optin",
  "canix_swap"
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
