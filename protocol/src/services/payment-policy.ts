export type EndpointAccess = "free" | "paid" | "unknown";

export interface EndpointPolicyDefinition {
  id: string;
  method: "GET" | "POST";
  pathPattern: string;
  access: Exclude<EndpointAccess, "unknown">;
  summary: string;
  description?: string;
  tags: string[];
  pathParams?: string[];
  queryParams?: string[];
  priceUsdc?: string;
}

const HACKATHON_TAG = "x402-global-challenge";

export const endpointPolicyMatrix: readonly EndpointPolicyDefinition[] = [
  {
    id: "root",
    method: "GET",
    pathPattern: "/",
    access: "free",
    summary: "API root branding and social metadata page",
    tags: ["system", "discovery"]
  },
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
    id: "faviconIco",
    method: "GET",
    pathPattern: "/favicon.ico",
    access: "free",
    summary: "API favicon for directory indexing",
    tags: ["system", "discovery"]
  },
  {
    id: "faviconPng",
    method: "GET",
    pathPattern: "/favicon.png",
    access: "free",
    summary: "API favicon image",
    tags: ["system", "discovery"]
  },
  {
    id: "logoPng",
    method: "GET",
    pathPattern: "/logo.png",
    access: "free",
    summary: "Service logo for directory and social indexing",
    tags: ["system", "discovery"]
  },
  {
    id: "bannerPng",
    method: "GET",
    pathPattern: "/banner.png",
    access: "free",
    summary: "Service banner for directory and social indexing",
    tags: ["system", "discovery"]
  },
  {
    id: "x402WellKnown",
    method: "GET",
    pathPattern: "/.well-known/x402",
    access: "free",
    summary: "x402 discovery fan-out document",
    tags: ["discovery", "agents", "x402"]
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
    id: "haystackSwapQuote",
    method: "POST",
    pathPattern: "/swaps/quote",
    access: "free",
    summary: "Fetch a walletless Haystack swap quote",
    description:
      "Returns a serializable Haystack route quote for an Algorand swap without signing or submitting transactions. Amounts use asset base units. Quotes are short-lived and should be refreshed after completing prerequisite opt-ins.",
    tags: ["defi", "swaps", "haystack", "agents"]
  },
  {
    id: "haystackSwapOptIn",
    method: "POST",
    pathPattern: "/swaps/optin",
    access: "free",
    summary: "Build prerequisite Haystack swap opt-ins",
    description:
      "Inspects the supplied account and quote, then returns any required output-asset and application opt-in transactions as an unsigned group. The caller signs and submits the group locally; canix402 never receives wallet keys or submits it.",
    tags: ["defi", "swaps", "haystack", "transactions", "wallet"]
  },
  {
    id: "tokenPricing",
    method: "POST",
    pathPattern: "/pricing",
    access: "free",
    summary: "Fetch USD token prices for Algorand asset IDs",
    description:
      "Returns CompX USD oracle prices for the requested Algorand asset IDs. A null price indicates that CompX has no current price for that asset.",
    tags: ["defi", "pricing", "compx", "agents"]
  },
  {
    id: "opportunities",
    method: "GET",
    pathPattern: "/opportunities",
    access: "paid",
    summary: "Top 10 aggregated DeFi opportunities ranked by APY",
    description:
      "Returns ranked Algorand DeFi yield opportunities across supported protocols including Tinyman, Pact, Folks Finance, CompX, Dork.fi, and Myth Finance. Use when an agent needs to compare APY/APR, TVL, asset pairs, opportunity type, protocol, source freshness, and caveats before presenting or ranking yield options. This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities", HACKATHON_TAG],
    queryParams: ["protocol", "limit", "offset", "includeInactive"]
  },
  {
    id: "protocolOpportunities",
    method: "GET",
    pathPattern: "/protocols/:protocol/opportunities",
    access: "paid",
    summary: "Top 25 DeFi opportunities for a single protocol ranked by APY",
    description:
      "Returns ranked DeFi opportunities for one Algorand protocol: tinyman, pact, folks-finance, compx, dorkfi, or myth-finance. Use when an agent already knows the target protocol and needs normalized APY/APR, TVL, asset pair, opportunity type, timestamps, and caveats for that venue. This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities", "protocol", HACKATHON_TAG],
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
    tags: ["defi", "opportunities", "search", HACKATHON_TAG],
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
    tags: ["defi", "opportunities", "personalized", "wallet", HACKATHON_TAG],
    queryParams: ["address", "limit", "offset", "includeInactive"],
    priceUsdc: process.env.X402_PRICE_PERSONALIZED_USDC ?? "0.05"
  },
  {
    id: "positions",
    method: "GET",
    pathPattern: "/positions",
    access: "paid",
    summary: "Algorand DeFi positions held by a wallet",
    description:
      "Returns normalized DeFi positions associated with a supplied Algorand wallet address across supported protocols. Use when an agent needs a wallet-level view of deposited, supplied, staked, or liquidity positions and their current values. This endpoint provides position data only; it does not build or submit transactions.",
    tags: ["defi", "positions", "wallet", HACKATHON_TAG],
    queryParams: ["address"],
    priceUsdc: process.env.X402_PRICE_POSITIONS_USDC ?? "0.005"
  },
  {
    id: "haystackSwapTransactions",
    method: "POST",
    pathPattern: "/swaps/transactions",
    access: "paid",
    summary: "Build a walletless Haystack swap transaction group",
    description:
      "Returns an ordered Algorand swap group for a fresh Haystack quote, including signer indexes and any Haystack pre-signed members. The caller signs only the designated transactions and submits the complete group locally. The 0.005 USDC x402 access charge is separate from Haystack's SDK-default 10 bps output fee, DEX fees, price impact, and Algorand network fees.",
    tags: ["defi", "swaps", "haystack", "transactions", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_HAYSTACK_SWAP_USDC ?? "0.005"
  },
  {
    id: "executionQuote",
    method: "POST",
    pathPattern: "/execution/quotes",
    access: "paid",
    summary: "Compile one or more verified transaction shapes into unsigned Algorand transaction groups",
    description:
      "Accepts `{ quotes: [{ shapeKey, input }, ...] }` (min 1) and returns an array of fresh, validated, unsigned transaction groups in request order. Groups are never merged across quotes. On failure the whole request fails and error.details includes quoteIndex and shapeKey. Price is flat per request (not per quote item). Use when an agent has selected one or more DeFi actions and needs deterministic transaction bytes to sign locally. Currently supports all five Tinyman v2 LP shapes (flexible/initial/single-asset add; multiple-assets-out/single-asset-out remove), Tinyman farm shapes (staking-v1 farm:commit for an existing LP position; v2 addLiquidityAndFarm flexible/single-asset that add liquidity and commit the new LP position in one atomic group, with LP tokens remaining in the wallet), Tinyman liquid-stake/restake shapes (liquid-stake-v1 mint/burn tALGO; restake-v1 increaseStake/decreaseStake/claimRewards stALGO), Folks Finance v2 lending escrow shapes (setup depositEscrow/optEscrowAsset; deposit:escrow; withdraw:escrow), Folks Finance xALGO liquid-stake shapes (xalgo-v1 stake/unstake immediate), Pact v1 LP add/remove shapes, CompX v1 lending/staking shapes, Dork.fi v1 ASA lending deposit/withdraw shapes, Myth Finance dualSTAKE shapes (dualstake-v1 mint/redeem LST; farm yield accrues passively while holding the LST), and Haystack v1 single-token HAY staking shapes (stake HAY; unstake HAY and claim USDC+HAY rewards; claim USDC+HAY rewards). Canix does not sign or submit transactions in this endpoint.",
    tags: ["execution", "transactions", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_EXECUTION_QUOTE_USDC ?? "0.1"
  },
  {
    id: "strategiesList",
    method: "GET",
    pathPattern: "/strategies",
    access: "free",
    summary: "List published strategies",
    description:
      "Returns published strategy marketplace documents (bound compositions of verified execution shapes). strategyId equals the strategy NFT ASA id. Fees: 50% of compile access fees go weekly to the NFT holder.",
    tags: ["strategies", "marketplace", "agents"],
    queryParams: ["status", "tag", "creatorAddress", "limit", "offset"]
  },
  {
    id: "strategyDetail",
    method: "GET",
    pathPattern: "/strategies/{strategyId}",
    access: "free",
    summary: "Get a strategy by strategyId (ASA id)",
    description:
      "Returns the Spaces-backed strategy document for strategyId (Algorand ASA id). Includes creatorAddress provenance, createdAt/lastRevisedAt, name/description/tags, and weighted legs.",
    tags: ["strategies", "marketplace", "agents"],
    pathParams: ["strategyId"]
  },
  {
    id: "strategyPublish",
    method: "POST",
    pathPattern: "/strategies",
    access: "paid",
    summary: "Publish a new strategy (mints NFT, writes Spaces JSON)",
    description:
      "Creates a tradable ARC-3 strategy NFT and stores the weight-based composition. Price 100 USDC (Canix-only; no holder share). Rejects raw transaction groups.",
    tags: ["strategies", "marketplace", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_STRATEGY_PUBLISH_USDC ?? "100"
  },
  {
    id: "strategyRevise",
    method: "POST",
    pathPattern: "/strategies/{strategyId}",
    access: "paid",
    summary: "Revise a strategy composition (NFT holder only, 14-day cooldown)",
    description:
      "In-place update of legs/display fields for strategyId. Price 1 USDC (Canix-only). Caller must be the current NFT holder. At most one successful revise per 14 days per strategyId.",
    tags: ["strategies", "marketplace", "x402", "agents", HACKATHON_TAG],
    pathParams: ["strategyId"],
    priceUsdc: process.env.X402_PRICE_STRATEGY_REVISE_USDC ?? "1"
  },
  {
    id: "strategyCompile",
    method: "POST",
    pathPattern: "/strategies/{strategyId}/compile",
    access: "paid",
    summary: "Compile a strategy into unsigned execution quotes",
    description:
      "Loads the strategy document, scales capital across legs by weightBps, and returns ExecutableQuote[]. Price 0.1 USDC. 50% of this access fee is paid weekly to the strategy NFT holder. Payment note must be x402:v2:strategy:{strategyId}.",
    tags: ["strategies", "execution", "x402", "agents", HACKATHON_TAG],
    pathParams: ["strategyId"],
    priceUsdc: process.env.X402_PRICE_STRATEGY_COMPILE_USDC ?? "0.1"
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
  /^\/positions$/,
  /^\/protocols\/[^/]+\/opportunities$/,
  /^\/swaps\/transactions$/,
  /^\/execution\/quotes$/,
  /^\/strategies\/\d+\/compile$/
];

const freePathMatchers = [
  /^\/$/,
  /^\/health$/,
  /^\/metadata$/,
  /^\/discovery$/,
  /^\/openapi\.json$/,
  /^\/llms\.txt$/,
  /^\/llms-full\.txt$/,
  /^\/robots\.txt$/,
  /^\/favicon\.ico$/,
  /^\/favicon\.png$/,
  /^\/logo\.png$/,
  /^\/banner\.png$/,
  /^\/\.well-known\/x402$/,
  /^\/\.well-known\/x402\.json$/,
  /^\/\.well-known\/agent-card\.json$/,
  /^\/\.well-known\/agent\.json$/,
  /^\/\.well-known\/ai-plugin\.json$/,
  /^\/swaps\/quote$/,
  /^\/swaps\/optin$/,
  /^\/pricing$/
];

export function classifyEndpointAccess(
  path: string,
  method?: string
): EndpointAccess {
  const normalizedMethod = method?.toUpperCase();

  if (/^\/strategies$/.test(path) || /^\/strategies\/\d+$/.test(path)) {
    if (normalizedMethod === "GET") {
      return "free";
    }
    if (normalizedMethod === "POST") {
      return "paid";
    }
    return "unknown";
  }

  if (freePathMatchers.some((matcher) => matcher.test(path))) {
    return "free";
  }

  if (paidPathMatchers.some((matcher) => matcher.test(path))) {
    return "paid";
  }

  return "unknown";
}

export function isPaidEndpoint(path: string, method?: string): boolean {
  return classifyEndpointAccess(path, method) === "paid";
}
