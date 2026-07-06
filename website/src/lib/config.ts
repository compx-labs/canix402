const defaultGateway = "https://canix402.compx.io";

export const config = {
  gatewayBaseUrl: import.meta.env.PUBLIC_GATEWAY_BASE_URL ?? defaultGateway,
  discoveryUrl:
    import.meta.env.PUBLIC_DISCOVERY_URL ??
    `${import.meta.env.PUBLIC_GATEWAY_BASE_URL ?? defaultGateway}/discovery`,
  openApiUrl:
    import.meta.env.PUBLIC_OPENAPI_URL ??
    `${import.meta.env.PUBLIC_GATEWAY_BASE_URL ?? defaultGateway}/openapi.json`
};

export const supportedProtocols = [
  "Tinyman",
  "Pact",
  "Folks Finance",
  "CompX",
  "Dork.fi"
] as const;
