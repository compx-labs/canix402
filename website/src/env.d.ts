/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_GATEWAY_BASE_URL?: string;
  readonly PUBLIC_DISCOVERY_URL?: string;
  readonly PUBLIC_OPENAPI_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
