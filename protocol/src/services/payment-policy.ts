export type EndpointAccess = "free" | "paid" | "unknown";

export interface EndpointPolicyDefinition {
  id: string;
  method: "GET";
  pathPattern: string;
  access: Exclude<EndpointAccess, "unknown">;
  summary: string;
  description?: string;
  tags: string[];
  pathParams?: string[];
  queryParams?: string[];
  priceUsdc?: string;
}

export const endpointPolicyMatrix: readonly EndpointPolicyDefinition[] = [
  {
    id: "health",
    method: "GET",
    pathPattern: "/health",
    access: "free",
    summary: "Service health check",
    tags: ["system"]
  },
  {
    id: "metadata",
    method: "GET",
    pathPattern: "/metadata",
    access: "free",
    summary: "Service metadata and policy surface",
    tags: ["system", "discovery"]
  },
  {
    id: "discovery",
    method: "GET",
    pathPattern: "/discovery",
    access: "free",
    summary: "Machine-readable endpoint catalog for agents",
    tags: ["discovery", "agents"]
  },
  {
    id: "openapi",
    method: "GET",
    pathPattern: "/openapi.json",
    access: "free",
    summary: "OpenAPI contract document",
    tags: ["discovery", "openapi"]
  },
  {
    id: "x402Manifest",
    method: "GET",
    pathPattern: "/.well-known/x402.json",
    access: "free",
    summary: "x402 discovery manifest for agent and directory indexing",
    tags: ["discovery", "agents", "x402"]
  },
  {
    id: "opportunities",
    method: "GET",
    pathPattern: "/opportunities",
    access: "paid",
    summary: "Top 10 aggregated DeFi opportunities ranked by APY",
    description:
      "Returns ranked Algorand DeFi yield opportunities across supported protocols including Tinyman, Pact, Folks Finance, CompX, Dork.fi, and Haystack. Use when an agent needs to compare APY/APR, TVL, asset pairs, opportunity type, protocol, source freshness, and caveats before presenting or ranking yield options. This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities"],
    queryParams: ["protocol", "limit", "offset", "includeInactive"]
  },
  {
    id: "protocolOpportunities",
    method: "GET",
    pathPattern: "/protocols/:protocol/opportunities",
    access: "paid",
    summary: "Top 25 DeFi opportunities for a single protocol ranked by APY",
    description:
      "Returns ranked DeFi opportunities for one Algorand protocol: tinyman, pact, folks-finance, compx, dorkfi, or haystack. Use when an agent already knows the target protocol and needs normalized APY/APR, TVL, asset pair, opportunity type, timestamps, and caveats for that venue. This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities", "protocol"],
    pathParams: ["protocol"],
    queryParams: ["limit", "offset", "includeInactive"]
  },
  {
    id: "filteredOpportunities",
    method: "GET",
    pathPattern: "/opportunities/search",
    access: "paid",
    summary: "Caller-filtered opportunities across supported platforms",
    description:
      "Returns Algorand DeFi opportunities filtered by platform, opportunity type, APY range, and TVL threshold across supported sources. Use when an agent needs targeted discovery such as high-yield liquidity pools, lending markets, protocol-specific yield, or minimum-liquidity opportunities on Algorand. This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities", "search"],
    queryParams: [
      "platform",
      "type",
      "minApy",
      "maxApy",
      "minTvlUsd",
      "limit",
      "offset",
      "includeInactive"
    ]
  },
  {
    id: "personalizedOpportunities",
    method: "GET",
    pathPattern: "/opportunities/personalized",
    access: "paid",
    summary: "Top opportunities tuned to a wallet's held assets",
    description:
      "Returns Algorand DeFi opportunities whose underlying assets match a supplied wallet's holdings, including opted-in ASAs with positive balance and native ALGO when held. Use when an agent needs wallet-aware yield ideas based on assets the account already owns, with normalized APY/APR, TVL, asset ids, source freshness, and caveats. This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities", "personalized", "wallet"],
    queryParams: ["address", "limit", "offset", "includeInactive"],
    priceUsdc: process.env.X402_PRICE_PERSONALIZED_USDC ?? "0.05"
  }
] as const;

export interface X402RequirementTemplate {
  scheme: "exact";
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
}

export interface X402EndpointMetadata {
  protocolVersion: 2;
  requiredHeaders: readonly [
    "PAYMENT-REQUIRED",
    "PAYMENT-SIGNATURE",
    "PAYMENT-RESPONSE"
  ];
  facilitator: string;
  requirementTemplate: X402RequirementTemplate;
}

function resolveUsdcAmount(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return "0.01";
}

export function getX402EndpointMetadata(amountUsdc?: string): X402EndpointMetadata {
  return {
    protocolVersion: 2,
    requiredHeaders: [
      "PAYMENT-REQUIRED",
      "PAYMENT-SIGNATURE",
      "PAYMENT-RESPONSE"
    ],
    facilitator:
      process.env.X402_FACILITATOR_BASE_URL ?? "https://facilitator.goplausible.xyz",
    requirementTemplate: {
      scheme: "exact",
      network: process.env.X402_PAYMENT_NETWORK ?? "algorand-mainnet",
      asset: process.env.X402_USDC_ASSET_ID ?? "31566704",
      payTo: process.env.X402_PAYMENT_RECEIVER_ADDRESS ?? "REPLACE_WITH_PAYTO_ADDRESS",
      maxAmountRequired: resolveUsdcAmount(
        amountUsdc,
        process.env.X402_PAYMENT_AMOUNT_USDC
      )
    }
  };
}

const paidPathMatchers = [
  /^\/opportunities$/,
  /^\/opportunities\/search$/,
  /^\/opportunities\/personalized$/,
  /^\/protocols\/[^/]+\/opportunities$/
];

const freePathMatchers = [
  /^\/health$/,
  /^\/metadata$/,
  /^\/discovery$/,
  /^\/openapi\.json$/,
  /^\/\.well-known\/x402\.json$/
];

export function classifyEndpointAccess(path: string): EndpointAccess {
  if (freePathMatchers.some((matcher) => matcher.test(path))) {
    return "free";
  }

  if (paidPathMatchers.some((matcher) => matcher.test(path))) {
    return "paid";
  }

  return "unknown";
}

export function isPaidEndpoint(path: string): boolean {
  return classifyEndpointAccess(path) === "paid";
}
