/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GATEWAY_BASE_URL?: string;
  readonly PUBLIC_DISCOVERY_URL?: string;
  readonly PUBLIC_OPENAPI_URL?: string;
  readonly PUBLIC_PAY_TO_ADDRESS?: string;
  readonly PUBLIC_USDC_ASSET_ID?: string;
  readonly PUBLIC_INDEXER_BASE_URL?: string;
  readonly PUBLIC_ALLO_TX_BASE_URL?: string;
  readonly PUBLIC_TRANSACTIONS_REFRESH_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
