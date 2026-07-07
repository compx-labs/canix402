const defaultGateway = "https://canix402-api.compx.io";

export const site = {
  supportEmail: "kieran@neonforge.ltd",
  operator: "Neon Forge Ltd"
} as const;

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

export const defaultPaidPriceUsdc = "0.01";
export const personalizedPriceUsdc = "0.05";
