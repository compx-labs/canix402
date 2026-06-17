export type EndpointAccess = "free" | "paid" | "unknown";

export interface EndpointPolicyDefinition {
  id: string;
  method: "GET";
  pathPattern: string;
  access: Exclude<EndpointAccess, "unknown">;
  summary: string;
  tags: string[];
  pathParams?: string[];
  queryParams?: string[];
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
    id: "opportunities",
    method: "GET",
    pathPattern: "/opportunities",
    access: "paid",
    summary: "Aggregated DeFi opportunities",
    tags: ["defi", "opportunities"],
    queryParams: ["protocol", "limit", "offset", "includeInactive"]
  },
  {
    id: "protocolOpportunities",
    method: "GET",
    pathPattern: "/protocols/:protocol/opportunities",
    access: "paid",
    summary: "DeFi opportunities for a single protocol",
    tags: ["defi", "opportunities", "protocol"],
    pathParams: ["protocol"],
    queryParams: ["limit", "offset", "includeInactive"]
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

export function getX402EndpointMetadata(): X402EndpointMetadata {
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
      maxAmountRequired: process.env.X402_PAYMENT_AMOUNT_USDC ?? "0.01"
    }
  };
}

const paidPathMatchers = [
  /^\/opportunities$/,
  /^\/protocols\/[^/]+\/opportunities$/
];

const freePathMatchers = [/^\/health$/, /^\/metadata$/, /^\/discovery$/, /^\/openapi\.json$/];

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
