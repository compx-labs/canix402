import { EXECUTION_PROTOCOL_CAVEATS_AGENT_HINT } from "../execution/shape-docs.js";

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
    id: "ready",
    method: "GET",
    pathPattern: "/ready",
    access: "free",
    summary: "Service readiness check (Algod required; Redis soft)",
    tags: ["system"]
  },
  {
    id: "metrics",
    method: "GET",
    pathPattern: "/metrics",
    access: "free",
    summary: "Prometheus metrics scrape endpoint (internal)",
    description:
      "Prometheus text exposition format. Intended for internal scrapes on the protocol component (:3000). Not exposed on the public Caddy gateway.",
    tags: ["system", "observability"]
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
      "Returns ranked Algorand DeFi yield opportunities across supported protocols including Tinyman, Pact, Folks Finance, CompX, Dork.fi, Myth Finance, Haystack, Réti, and Alpha Arcade. Use when an agent needs to compare APY/APR, TVL, asset pairs, opportunity type, protocol, source freshness, and caveats before presenting or ranking yield options. This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities", HACKATHON_TAG],
    queryParams: ["protocol", "limit", "offset", "includeInactive", "refresh"]
  },
  {
    id: "protocolOpportunities",
    method: "GET",
    pathPattern: "/protocols/:protocol/opportunities",
    access: "paid",
    summary: "Top 25 DeFi opportunities for a single protocol ranked by APY",
    description:
      "Returns ranked DeFi opportunities for one Algorand protocol: tinyman, pact, folks-finance, compx, dorkfi, myth-finance, haystack, reti, or alpha-arcade. Use when an agent already knows the target protocol and needs normalized APY/APR, TVL, asset pair, opportunity type, timestamps, and caveats for that venue. This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities", "protocol", HACKATHON_TAG],
    pathParams: ["protocol"],
    queryParams: ["limit", "offset", "includeInactive", "refresh"]
  },
  {
    id: "filteredOpportunities",
    method: "GET",
    pathPattern: "/opportunities/search",
    access: "paid",
    summary: "Caller-filtered opportunities across supported platforms",
    description:
      "Returns Algorand DeFi opportunities filtered by platform, opportunity type, APY range, TVL threshold, and optional ASA assetIds across supported sources. Use when an agent needs targeted discovery such as high-yield liquidity pools, lending markets, protocol-specific yield, minimum-liquidity opportunities, or yields for specific Algorand assets (assetIds=0 for ALGO). This endpoint provides normalized market data only; it does not build or submit transactions.",
    tags: ["defi", "opportunities", "search", HACKATHON_TAG],
    queryParams: [
      "platform",
      "type",
      "minApy",
      "maxApy",
      "minTvlUsd",
      "assetIds",
      "limit",
      "offset",
      "includeInactive",
      "refresh"
    ]
  },
  {
    id: "personalizedOpportunities",
    method: "GET",
    pathPattern: "/opportunities/personalized",
    access: "paid",
    summary: "Top opportunities tuned to a wallet's held assets",
    description:
      "Returns Algorand DeFi opportunities whose underlying assets match a supplied wallet's holdings, including opted-in ASAs with positive balance and native ALGO when held. Matching applies POST /eligibility rules (min amount, ASA gates, capacity, unresolved NFD/creator gates) so full or gated venues are not recommended as enterable. Each row includes canEnter and eligibilityFullyCheckable; quote-time on-chain checks remain authoritative. Use POST /eligibility for the diagnostic (missingAssets, gates, capacity, suggestedSwap). This endpoint provides normalized market data only; it does not build or submit transactions.",  // pragma: allowlist secret
    tags: ["defi", "opportunities", "personalized", "wallet", HACKATHON_TAG],
    queryParams: ["address", "limit", "offset", "includeInactive", "refresh"],
    priceUsdc: process.env.X402_PRICE_PERSONALIZED_USDC ?? "0.05"
  },
  {
    id: "eligibility",
    method: "POST",
    pathPattern: "/eligibility",
    access: "paid",
    summary: "Wallet eligibility and capacity for selected opportunities",
    description:
      "Checks whether a wallet can enter one or more opportunities before requesting an execution quote. Resolves Réti entryRequirements and capacity (min amount, ASA gates, staker slots, ALGO room). NFD and creator gates are published as unresolved — canEnter is never true until eligibilityFullyCheckable is true. Returns missingAssets, gates, capacity, and an optional suggestedSwap hint (not a live quote). Quote-time on-chain checks remain authoritative. Canix does not sign or submit transactions.",  // pragma: allowlist secret
    tags: ["defi", "opportunities", "eligibility", "wallet", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_ELIGIBILITY_USDC ?? "0.01"
  },
  {
    id: "plans",
    method: "POST",
    pathPattern: "/plans",
    access: "paid",
    summary: "Compile an allocation intent into an ordered unsigned plan",
    description:
      "Agent states an allocation intent (address, budget/asset, constraints). Canix returns ordered steps: eligibility, optional live Haystack swap compose (opt-in → swap → enter, driven by requiredAssetIds), protocol setup chains, and enter quotes as independent unsigned groups (never merged). Reuses quotes[] / order / prerequisiteShapeKeys. Includes expected position delta, x402 + network fee totals, and expiry. Quote-time on-chain checks remain authoritative. Canix does not sign or submit. Brownie and other agents should consume this SKU rather than forking a compiler.",  // pragma: allowlist secret
    tags: ["defi", "plans", "execution", "eligibility", "wallet", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_PLANS_USDC ?? "0.25"
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
    id: "positionsClaimable",
    method: "GET",
    pathPattern: "/positions/claimable",
    access: "paid",
    summary: "Claimable DeFi rewards across supported protocols",
    description:
      "Returns claimable reward rows for a wallet with USD value, network-fee / worth-claiming hints, compatible claim shapeKeys, and ready-to-POST quote inputs. Use claimAllQuotes (or selected per-row quotes) with POST /execution/quotes to compile unsigned claim groups — groups are never merged. Covers Tinyman farm, stALGO TINY claim, CompX staking, Pact farm, Haystack, and Alpha Arcade. This endpoint does not build or submit transactions.",
    tags: ["defi", "positions", "rewards", "wallet", "execution", HACKATHON_TAG],
    queryParams: ["address"],
    priceUsdc: process.env.X402_PRICE_POSITIONS_CLAIMABLE_USDC ?? "0.001"
  },
  {
    id: "publicBrowniePositions",
    method: "GET",
    pathPattern: "/public/agents/brownie/positions",
    access: "free",
    summary: "Public DeFi positions for the Brownie Bot showcase wallet",
    description:
      "Free showcase route that returns normalized DeFi positions for the Brownie Bot treasury wallet only. The wallet address is hardcoded server-side — this is not a general free /positions browser. Use GET /positions?address= for arbitrary wallets (paid).",
    tags: ["defi", "positions", "agents", "showcase"]
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
    id: "executionShapes",
    method: "GET",
    pathPattern: "/execution/shapes",
    access: "free",
    summary: "List verified execution shape catalog metadata",
    description:
      "Returns the live catalog of verified transaction shapes (shapeKey, requiredInputs, opportunityRole, docsPath). meta.caveatsDocsPath points at protocol-specific construction caveats. Catalog metadata only — does not compile quotes or return unsigned transactions. Use POST /execution/quotes to compile executable groups. " +
      EXECUTION_PROTOCOL_CAVEATS_AGENT_HINT,
    tags: ["execution", "discovery", "agents"]
  },
  {
    id: "executionQuote",
    method: "POST",
    pathPattern: "/execution/quotes",
    access: "paid",
    summary: "Compile one or more verified transaction shapes into unsigned Algorand transaction groups",
    description:
      "Accepts `{ quotes: [{ shapeKey, input }, ...] }` (min 1) and returns an array of fresh, validated, unsigned transaction groups in request order. Groups are never merged across quotes. On failure the whole request fails and error.details includes quoteIndex and shapeKey. Price is flat per request (not per quote item). Use when an agent has selected one or more DeFi actions and needs deterministic transaction bytes to sign locally. Currently supports all five Tinyman v2 LP shapes (flexible/initial/single-asset add; multiple-assets-out/single-asset-out remove), Tinyman farm shapes (staking-v1 farm:commit / farm:uncommit / farm:claimRewards; v2 addLiquidityAndFarm flexible/single-asset that add liquidity and commit the new LP position in one atomic group, with LP tokens remaining in the wallet), Tinyman liquid-stake/restake shapes (liquid-stake-v1 mint/burn tALGO; restake-v1 increaseStake/decreaseStake/claimRewards stALGO), Folks Finance v2 lending escrow shapes (setup depositEscrow/optEscrowAsset; deposit:escrow; withdraw:escrow), Folks Finance v2 loan credit shapes (setup:loanEscrow; setup:addCollateral; collateral:sync / collateral:reduce; borrow:variable; repay:withTxn), Folks Finance xALGO liquid-stake shapes (xalgo-v1 stake/unstake immediate), Pact v1 LP add/remove shapes, CompX v1 lending shapes (deposit/withdraw ASA; borrow:asa; repay:asa) and CompX v1 staking shapes, Dork.fi v1 ASA lending shapes (deposit/withdraw; borrow:asa; repay:asa), Myth Finance dualSTAKE shapes (dualstake-v1 mint/redeem LST; farm yield accrues passively while holding the LST), Haystack v1 single-token HAY staking shapes (stake HAY; unstake HAY and claim USDC+HAY rewards; claim USDC+HAY rewards), and Réti v1 ALGO staking shapes (stake/unstake). Canix does not sign or submit transactions in this endpoint. " +
      EXECUTION_PROTOCOL_CAVEATS_AGENT_HINT,
    tags: ["execution", "transactions", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_EXECUTION_QUOTE_USDC ?? "0.1"
  },
  {
    id: "executionCompose",
    method: "POST",
    pathPattern: "/execution/compose",
    access: "paid",
    summary: "Compose opt-in → Haystack swap → enter as unmerged unsigned groups",
    description:
      "Compiles “I hold asset A, I want this opportunity” into sequenced groups: optional ASA/app opt-in, Haystack swap (signer indexes and pre-signed members preserved), then enter — driven by requiredAssetIds. Groups are never merged. Failure modes (stale quote, missing opt-in, slippage) are listed on step warnings. Canix does not sign or submit. Caller signs user legs and submits locally in order.",  // pragma: allowlist secret
    tags: ["execution", "swaps", "haystack", "plans", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_EXECUTION_COMPOSE_USDC ?? "0.1"
  },
] as const;

export interface X402RequirementTemplate {
  scheme: "exact";
  network: string;
  asset: string;
  payTo: string;
  /** Human USDC amount (e.g. "0.01"). Discovery uses this; Caddy PAYMENT-REQUIRED uses micro-USDC. */
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
  /** Human-readable USDC price for this endpoint (same as maxAmountRequired). */
  amountUsdc: string;
  /** Micro-USDC integer string (6 decimals) matching Caddy PAYMENT-REQUIRED amounts. */
  amountMicro: string;
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

/** Convert a decimal USDC string to micro-USDC (6 dp) without float rounding. */
export function usdcAmountToMicro(amountUsdc: string): string {
  const trimmed = amountUsdc.trim();
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(trimmed);
  if (!match) {
    // Fallback: treat non-canonical values as already micro or opaque.
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return Math.round(asNumber * 1_000_000).toString();
    }
    return "0";
  }
  const whole = match[1] ?? "0";
  const frac = (match[2] ?? "").padEnd(6, "0").slice(0, 6);
  return (BigInt(whole) * 1_000_000n + BigInt(frac)).toString();
}

export function getX402EndpointMetadata(amountUsdc?: string): X402EndpointMetadata {
  const resolvedUsdc = resolveUsdcAmount(
    amountUsdc,
    process.env.X402_PAYMENT_AMOUNT_USDC
  );
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
      maxAmountRequired: resolvedUsdc
    },
    amountUsdc: resolvedUsdc,
    amountMicro: usdcAmountToMicro(resolvedUsdc)
  };
}

const paidPathMatchers = [
  /^\/opportunities$/,
  /^\/opportunities\/search$/,
  /^\/opportunities\/personalized$/,
  /^\/eligibility$/,
  /^\/plans$/,
  /^\/positions$/,
  /^\/positions\/claimable$/,
  /^\/protocols\/[^/]+\/opportunities$/,
  /^\/swaps\/transactions$/,
  /^\/execution\/quotes$/,
  /^\/execution\/compose$/
];

const freePathMatchers = [
  /^\/$/,
  /^\/health$/,
  /^\/ready$/,
  /^\/metrics$/,
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
  /^\/pricing$/,
  /^\/execution\/shapes$/,
  /^\/public\/agents\/brownie\/positions$/
];

export function classifyEndpointAccess(
  path: string,
  _method?: string
): EndpointAccess {
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
