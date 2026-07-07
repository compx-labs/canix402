const defaultGateway = "https://canix402-api.compx.io";

export const site = {
  supportEmail: "kieran@neonforge.ltd",
  operator: "Neon Forge Ltd"
} as const;

const gatewayBaseUrl = import.meta.env.PUBLIC_GATEWAY_BASE_URL ?? defaultGateway;

export const config = {
  gatewayBaseUrl,
  discoveryUrl:
    import.meta.env.PUBLIC_DISCOVERY_URL ?? `${gatewayBaseUrl}/discovery`,
  openApiUrl:
    import.meta.env.PUBLIC_OPENAPI_URL ?? `${gatewayBaseUrl}/openapi.json`,
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
  "Dork.fi"
] as const;

export const defaultPaidPriceUsdc = "0.01";
export const personalizedPriceUsdc = "0.05";
