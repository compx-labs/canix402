import { EXECUTION_PROTOCOL_CAVEATS_AGENT_HINT } from "../execution/shape-docs.js";
import type { SessionBucket, SessionPolicy } from "../types/session.js";
import type { WatchPolicy } from "../types/watch.js";
import {
  DEFAULT_SESSION_PRICE_USDC
} from "../types/session-schema.js";
import { DEFAULT_WATCH_PRICE_USDC } from "../types/watch-schema.js";
import {
  getSessionQuoteBudget,
  getSessionResearchBudget,
  getSessionTtlSeconds
} from "./session-store.js";
import { getWatchPollSeconds, getWatchTtlSeconds } from "./watch-store.js";

export type EndpointAccess = "free" | "paid" | "unknown";
export type SessionAccess = SessionBucket;

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
  /** Prepaid session bucket accepted instead of a per-request x402 payment. */
  sessionAccess?: SessionAccess;
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
    summary: "Fetch a walletless multi-router swap quote",
    description:
      "Quotes every enabled swap router in parallel, scores expected net out, and returns the winning route without signing or submitting. Pass optional router to force a single adapter. Amounts use asset base units. Quotes are short-lived and should be refreshed after completing prerequisite opt-ins.",
    tags: ["defi", "swaps", "haystack", "agents"]
  },
  {
    id: "haystackSwapOptIn",
    method: "POST",
    pathPattern: "/swaps/optin",
    access: "free",
    summary: "Build prerequisite swap opt-ins for the winning quote",
    description:
      "Inspects the supplied account and winning quote, then returns any required output-asset and application opt-in transactions as an unsigned group. The caller signs and submits the group locally; canix402 never receives wallet keys or submits it.",
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
    summary: "Top 10 aggregated DeFi opportunities ranked by risk then APY",
    description:
      "Returns ranked Algorand DeFi yield opportunities across supported protocols including Tinyman, Pact, Folks Finance, CompX, Dork.fi, Myth Finance, Haystack, Réti, and Alpha Arcade. Ranking applies designed risk constraints (confidence, utilization, volatility, reward runway, wallet health factor when address is in context) before raw APY. Use when an agent needs to compare APY/APR, TVL, asset pairs, opportunity type, protocol, source freshness, risk, and caveats before presenting yield options. This endpoint provides normalized market data only; it does not build or submit transactions.",  // pragma: allowlist secret
    tags: ["defi", "opportunities", HACKATHON_TAG],
    queryParams: ["protocol", "limit", "offset", "includeInactive", "refresh"],
    sessionAccess: "research"
  },
  {
    id: "protocolOpportunities",
    method: "GET",
    pathPattern: "/protocols/:protocol/opportunities",
    access: "paid",
    summary: "Top 25 DeFi opportunities for a single protocol ranked by risk then APY",
    description:
      "Returns ranked DeFi opportunities for one Algorand protocol: tinyman, pact, folks-finance, compx, dorkfi, myth-finance, haystack, reti, alpha-arcade, or stamm. Ranking applies designed risk constraints before raw APY. Use when an agent already knows the target protocol and needs normalized APY/APR, TVL, asset pair, opportunity type, timestamps, risk, and caveats for that venue. This endpoint provides normalized market data only; it does not build or submit transactions.",  // pragma: allowlist secret
    tags: ["defi", "opportunities", "protocol", HACKATHON_TAG],
    pathParams: ["protocol"],
    queryParams: ["limit", "offset", "includeInactive", "refresh"],
    sessionAccess: "research"
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
    ],
    sessionAccess: "research"
  },
  {
    id: "personalizedOpportunities",
    method: "GET",
    pathPattern: "/opportunities/personalized",
    access: "paid",
    summary: "Top opportunities tuned to a wallet's held assets",
    description:
      "Returns Algorand DeFi opportunities whose underlying assets match a supplied wallet's holdings, including opted-in ASAs with positive balance and native ALGO when held. Matching applies POST /eligibility rules (min amount, ASA gates, capacity, unresolved NFD/creator gates) so full or gated venues are not recommended as enterable. Ranking prefers designed risk constraints (including wallet health factor from existing position snapshots) over raw APY. Each row includes canEnter, eligibilityFullyCheckable, and risk; quote-time on-chain checks remain authoritative. Use POST /eligibility for the diagnostic (missingAssets, gates, capacity, suggestedSwap). This endpoint provides normalized market data only; it does not build or submit transactions.",  // pragma: allowlist secret
    tags: ["defi", "opportunities", "personalized", "wallet", HACKATHON_TAG],
    queryParams: ["address", "limit", "offset", "includeInactive", "refresh"],
    priceUsdc: process.env.X402_PRICE_PERSONALIZED_USDC ?? "0.05",
    sessionAccess: "research"
  },
  {
    id: "opportunityHistory",
    method: "GET",
    pathPattern: "/opportunities/:opportunityId/history",
    access: "paid",
    summary: "Bounded APY/TVL history for one opportunity",
    description:
      "Returns a rolling APY and TVL series for one opportunity over a bounded window (1d, 7d, or 30d). Snapshots are stored as cheap hourly Redis buckets — not a warehouse and not backfilled from explorers. Empty points until the snapshot job has run. Includes a stability signal (APY stdev / sample count) so snapshot APY cannot dominate plan sizing. Market data only; Canix does not sign or submit transactions.",
    tags: ["defi", "opportunities", "history", HACKATHON_TAG],
    pathParams: ["opportunityId"],
    queryParams: ["window"],
    priceUsdc: process.env.X402_PRICE_HISTORY_USDC ?? "0.01",
    sessionAccess: "research"
  },
  {
    id: "eligibility",
    method: "POST",
    pathPattern: "/eligibility",
    access: "paid",
    summary: "Wallet eligibility and capacity for selected opportunities",
    description:
      "Checks whether a wallet can enter one or more opportunities before requesting an execution quote. Resolves Réti entryRequirements and capacity (min amount, ASA gates, staker slots, ALGO room). NFD and creator gates are published as unresolved — canEnter is never true until eligibilityFullyCheckable is true. Returns missingAssets, gates, capacity, an optional suggestedSwap hint (not a live quote), and wallet healthFactor for lending venues that already expose it on positions. Quote-time on-chain checks remain authoritative. Canix does not sign or submit transactions.",  // pragma: allowlist secret
    tags: ["defi", "opportunities", "eligibility", "wallet", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_ELIGIBILITY_USDC ?? "0.01",
    sessionAccess: "research"
  },
  {
    id: "plans",
    method: "POST",
    pathPattern: "/plans",
    access: "paid",
    summary: "Compile an allocation intent into an ordered unsigned plan",
    description:
      "Agent states an allocation intent (address, budget/asset, constraints). Canix ranks enterable venues with designed risk constraints before raw APY, then returns ordered steps: eligibility, optional live multi-router swap compose (opt-in → swap → enter, driven by requiredAssetIds), protocol setup chains, and enter quotes as independent unsigned groups (never merged). Reuses quotes[] / order / prerequisiteShapeKeys. Includes expected position delta, a fail-closed simulation summary when compiled groups are available, x402 + network fee totals, and expiry. Quote-time on-chain checks remain authoritative. Canix does not sign or submit. Brownie and other agents should consume this SKU rather than forking a compiler.",  // pragma: allowlist secret
    tags: ["defi", "plans", "execution", "eligibility", "wallet", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_PLANS_USDC ?? "0.25",
    sessionAccess: "quotes"
  },
  {
    id: "plansRebalance",
    method: "POST",
    pathPattern: "/plans/rebalance",
    access: "paid",
    summary: "Compile a delta rebalance plan of unsigned groups",
    description:
      "Positions are the book; opportunities are the menu. Pass address plus targetWeights (bps summing to 10000) and/or harvestIdle to claim worth-claiming rewards and redeploy idle ALGO. Returns ordered unsigned groups — claims, partial exits, optional multi-router swap compose, and enters — only the delta legs that change the book (not a full unwind-and-rebuild). Reuses claim desk, eligibility, compose, and position exit/manage shapeKeys. Groups are never merged. Attaches a fail-closed simulation summary when compiled groups are available. Canix does not sign or submit.",  // pragma: allowlist secret
    tags: ["defi", "plans", "rebalance", "execution", "eligibility", "wallet", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_PLANS_REBALANCE_USDC ?? "0.25",
    sessionAccess: "quotes"
  },
  {
    id: "policyValidate",
    method: "POST",
    pathPattern: "/policy/validate",
    access: "paid",
    summary: "Validate a compiled plan or quotes[] against an operator policy document",
    description:
      "Operators bring policy; Canix evaluates a compiled plan (or proposed quotes[]) against a versioned policy document (max protocol weight, ALGO reserve floor, TVL/freshness floors, no-new-borrows, execution-ready only). Returns { pass, reasons[] }. Reuses plan/eligibility/risk fields already on the compiled object and fails closed when a required field is missing — it does not re-quote on-chain. Canix does not sign or submit. Brownie and a second agent can share the same schema (protocol/docs/policy-schema.md).",  // pragma: allowlist secret
    tags: ["defi", "policy", "plans", "execution", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_POLICY_VALIDATE_USDC ?? "0.25",
    sessionAccess: "quotes"
  },
  {
    id: "positions",
    method: "GET",
    pathPattern: "/positions",
    access: "paid",
    summary: "Algorand DeFi positions held by a wallet",
    description:
      "Returns normalized DeFi positions associated with a supplied Algorand wallet address across supported protocols. LP tokens indexed by HOGSWAP (STAMM, AlgoFi, Humble) are valued via GET /lp/{asset_id}?amount= — proportional NAV, null rather than guessed. Tinyman and Pact LP collectors remain canonical for those venues (no double-count by LP ASA). This endpoint provides position data only; it does not build or submit transactions.",  // pragma: allowlist secret
    tags: ["defi", "positions", "wallet", HACKATHON_TAG],
    queryParams: ["address"],
    priceUsdc: process.env.X402_PRICE_POSITIONS_USDC ?? "0.005",
    sessionAccess: "research"
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
    priceUsdc: process.env.X402_PRICE_POSITIONS_CLAIMABLE_USDC ?? "0.001",
    sessionAccess: "research"
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
    summary: "Build a walletless swap transaction group from the winning quote",
    description:
      "Returns an ordered Algorand swap group for a fresh multi-router quote, including signer indexes and any pre-signed members from the winning router. The caller signs only the designated transactions and submits the complete group locally. The 0.005 USDC x402 access charge is separate from Haystack's SDK-default 10 bps output fee, other router fees, DEX fees, price impact, and Algorand network fees.",
    tags: ["defi", "swaps", "haystack", "transactions", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_HAYSTACK_SWAP_USDC ?? "0.005",
    sessionAccess: "quotes"
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
      "Accepts `{ quotes: [{ shapeKey, input }, ...] }` (min 1) and returns an array of fresh, validated, unsigned transaction groups in request order. Groups are never merged across quotes. On failure the whole request fails and error.details includes quoteIndex and shapeKey. Price is flat per request (not per quote item). Use when an agent has selected one or more DeFi actions and needs deterministic transaction bytes to sign locally. Currently supports all five Tinyman v2 LP shapes (flexible/initial/single-asset add; multiple-assets-out/single-asset-out remove), Tinyman v2 swap shapes (swap:fixedInput / swap:fixedOutput via Tinyman Swap Router, falling back to a single Tinyman pool when the router is not better; Tinyman-pool only, never a cross-DEX aggregator), Tinyman farm shapes (staking-v1 farm:commit / farm:uncommit / farm:claimRewards; v2 addLiquidityAndFarm flexible/single-asset that add liquidity and commit the new LP position in one atomic group, with LP tokens remaining in the wallet), Tinyman liquid-stake/restake shapes (liquid-stake-v1 mint/burn tALGO; restake-v1 increaseStake/decreaseStake/claimRewards stALGO), Folks Finance v2 lending escrow shapes (setup depositEscrow/optEscrowAsset; deposit:escrow; withdraw:escrow), Folks Finance v2 loan credit shapes (setup:loanEscrow; setup:addCollateral; collateral:sync / collateral:reduce; borrow:variable; repay:withTxn), Folks Finance xALGO liquid-stake shapes (xalgo-v1 stake/unstake immediate), Pact v1 LP add/remove shapes, Pact Smart Router unsigned swap (`mainnet:pact:smart-router:swap:fixed-input`; local graph + Pool.prepareSwap, not Haystack), CompX v1 lending shapes (deposit/withdraw ASA; borrow:asa; repay:asa) and CompX v1 staking shapes, Dork.fi v1 ASA lending shapes (deposit/withdraw; borrow:asa; repay:asa), Myth Finance dualSTAKE shapes (dualstake-v1 mint/redeem LST; farm yield accrues passively while holding the LST), Haystack v1 single-token HAY staking shapes (stake HAY; unstake HAY and claim USDC+HAY rewards; claim USDC+HAY rewards), Réti v1 ALGO staking shapes (stake/unstake), Alpha Arcade v1 ALPHA staking shapes (stake/unstake/claim USDC), and STAMM v1 LP mint/redeem via HOGSWAP (unsigned groups; do not hardcode router app ids), and HOGSWAP v1 swap shapes (fixed-input / fixed-output; unsigned groups; routing fee already netted into expectedOut; do not hardcode router app ids). Canix does not sign or submit transactions in this endpoint. " +
      EXECUTION_PROTOCOL_CAVEATS_AGENT_HINT,
    tags: ["execution", "transactions", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_EXECUTION_QUOTE_USDC ?? "0.1",
    sessionAccess: "quotes"
  },
  {
    id: "executionCompose",
    method: "POST",
    pathPattern: "/execution/compose",
    access: "paid",
    summary: "Compose opt-in → winning swap → enter as unmerged unsigned groups",
    description:
      "Compiles “I hold asset A, I want this opportunity” into sequenced groups: optional ASA/app opt-in, multi-router swap (signer indexes and pre-signed members preserved), then enter — driven by requiredAssetIds. Groups are never merged. Failure modes (stale quote, missing opt-in, slippage) are listed on step warnings. Canix does not sign or submit. Caller signs user legs and submits locally in order.",  // pragma: allowlist secret
    tags: ["execution", "swaps", "plans", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_EXECUTION_COMPOSE_USDC ?? "0.1",
    sessionAccess: "quotes"
  },
  {
    id: "executionSimulate",
    method: "POST",
    pathPattern: "/execution/simulate",
    access: "paid",
    summary: "Simulate compiled unsigned groups for predicted balance and position deltas",
    description:
      "Given compiled unsigned group(s) from a plan or execution quote, returns predicted wallet balance and position deltas without signing or submitting. Fails closed with machine-readable reasons when the group would not succeed (stale quote, not opted in, min balance, health factor too low, capacity). Canix does not sign or submit. POST /plans attaches the same simulation summary when compiled groups are available.",  // pragma: allowlist secret
    tags: ["defi", "execution", "plans", "simulation", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_EXECUTION_SIMULATE_USDC ?? "0.1",
    sessionAccess: "quotes"
  },
  {
    id: "sessionsCreate",
    method: "POST",
    pathPattern: "/sessions",
    access: "paid",
    summary: "Buy a prepaid agent session receipt",
    description:
      "One compiler-priced x402 payment mints a walletless prepaid session receipt (canix://session/{id}). The receipt unlocks N research calls and M quotes/plans until TTL. Sessions are receipts, not keys — Canix never stores a wallet. Exact-scheme one-shots remain the default; omit X-Canix-Session to pay per request. Fail-closed on expiry, exhausted quota, or store unavailability.",
    tags: ["sessions", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_SESSIONS_USDC ?? DEFAULT_SESSION_PRICE_USDC
  },
  {
    id: "sessionsRefresh",
    method: "POST",
    pathPattern: "/sessions/refresh",
    access: "paid",
    summary: "Refresh a prepaid agent session receipt",
    description:
      "Compiler-priced x402 payment that resets N/M quota and TTL on an existing session id, or mints a new receipt if the previous one is gone. Cannot be paid with an existing session — this route is one-shot only.",
    tags: ["sessions", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_SESSIONS_USDC ?? DEFAULT_SESSION_PRICE_USDC
  },
  {
    id: "sessionsReceipt",
    method: "GET",
    pathPattern: "/sessions/:sessionId",
    access: "free",
    summary: "Read prepaid session remaining N/M",
    description:
      "Returns the session receipt including remaining research and quotes/plans quota and expiry. Agents should use this resource instead of the public indexer /transactions showcase. Fail-closed 402 when the receipt is unknown or expired.",
    tags: ["sessions", "agents", "discovery"],
    pathParams: ["sessionId"]
  },
  {
    id: "watchCreate",
    method: "POST",
    pathPattern: "/watch",
    access: "paid",
    summary: "Register a paid wallet watch retainer",
    description:
      "Recurring compiler-priced x402 retainer that registers a walletless watch (address + thresholds + optional HTTPS webhook). Fires signed, idempotent notifications on health-factor, claimable-USD, APY-drop, or Réti-capacity crossings. Canix never stores wallet keys — only the address, callback, and a server-generated HMAC secret (shown once). Refresh with POST /watch/refresh before TTL. MCP resource canix://watch/{watchId} lists recent firings.",
    tags: ["watch", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_WATCH_USDC ?? DEFAULT_WATCH_PRICE_USDC
  },
  {
    id: "watchRefresh",
    method: "POST",
    pathPattern: "/watch/refresh",
    access: "paid",
    summary: "Refresh a paid wallet watch retainer",
    description:
      "Compiler-priced x402 payment that extends TTL on an existing watch id. Optionally rotateSecret to mint a new HMAC key (returned once). Cannot be paid with a prepaid session. Unknown or expired watches fail-closed; register again with POST /watch.",
    tags: ["watch", "x402", "agents", HACKATHON_TAG],
    priceUsdc: process.env.X402_PRICE_WATCH_USDC ?? DEFAULT_WATCH_PRICE_USDC
  },
  {
    id: "watchReceipt",
    method: "GET",
    pathPattern: "/watch/:watchId",
    access: "free",
    summary: "Read watch receipt and recent threshold firings",
    description:
      "Returns the walletless watch receipt including thresholds, webhook URL, expiry, and recent signed-delivery firings (idempotency keys). Does not return the HMAC secret. Unknown or expired receipts fail-closed with 402 WATCH_*.",
    tags: ["watch", "agents", "discovery"],
    pathParams: ["watchId"]
  },
  {
    id: "watchRotateSecret",
    method: "POST",
    pathPattern: "/watch/:watchId/rotate-secret",
    access: "free",
    summary: "Rotate the watch webhook HMAC secret",
    description:
      "Mints a new webhook signing secret. Requires the current secret in X-Canix-Watch-Secret. The new secret is returned once and never stored as a wallet key. Does not extend retainer TTL — pay POST /watch/refresh for that.",
    tags: ["watch", "agents"],
    pathParams: ["watchId"]
  }
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
  /^\/opportunities\/[^/]+\/history$/,
  /^\/eligibility$/,
  /^\/plans$/,
  /^\/plans\/rebalance$/,
  /^\/policy\/validate$/,
  /^\/positions$/,
  /^\/positions\/claimable$/,
  /^\/protocols\/[^/]+\/opportunities$/,
  /^\/swaps\/transactions$/,
  /^\/execution\/quotes$/,
  /^\/execution\/compose$/,
  /^\/execution\/simulate$/,
  /^\/sessions$/,
  /^\/sessions\/refresh$/,
  /^\/watch$/,
  /^\/watch\/refresh$/
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

const SESSION_CREATE_PATH = "/sessions";
const SESSION_REFRESH_PATH = "/sessions/refresh";
const SESSION_RECEIPT_PATH = /^\/sessions\/[^/]+$/;
const WATCH_CREATE_PATH = "/watch";
const WATCH_REFRESH_PATH = "/watch/refresh";
const WATCH_RECEIPT_PATH = /^\/watch\/[^/]+$/;
const WATCH_ROTATE_PATH = /^\/watch\/[^/]+\/rotate-secret$/;

export function classifyEndpointAccess(
  path: string,
  method?: string
): EndpointAccess {
  const pathname = path.split("?")[0] ?? path;
  const methodUpper = method?.toUpperCase();

  // POST /sessions and POST /sessions/refresh are paid one-shots.
  // GET /sessions/:id (including the path segment "refresh") is the free receipt.
  if (pathname === SESSION_CREATE_PATH) {
    return "paid";
  }
  if (pathname === SESSION_REFRESH_PATH && methodUpper !== "GET") {
    return "paid";
  }
  if (SESSION_RECEIPT_PATH.test(pathname)) {
    if (!methodUpper || methodUpper === "GET") {
      return "free";
    }
  }

  if (pathname === WATCH_CREATE_PATH) {
    return "paid";
  }
  if (pathname === WATCH_REFRESH_PATH && methodUpper !== "GET") {
    return "paid";
  }
  if (WATCH_ROTATE_PATH.test(pathname)) {
    return "free";
  }
  if (WATCH_RECEIPT_PATH.test(pathname)) {
    if (!methodUpper || methodUpper === "GET") {
      return "free";
    }
  }

  if (freePathMatchers.some((matcher) => matcher.test(pathname))) {
    return "free";
  }

  if (paidPathMatchers.some((matcher) => matcher.test(pathname))) {
    return "paid";
  }

  return "unknown";
}

export function isPaidEndpoint(path: string, method?: string): boolean {
  return classifyEndpointAccess(path, method) === "paid";
}

const researchSessionMatchers = [
  /^\/opportunities$/,
  /^\/opportunities\/search$/,
  /^\/opportunities\/personalized$/,
  /^\/opportunities\/[^/]+\/history$/,
  /^\/eligibility$/,
  /^\/positions$/,
  /^\/positions\/claimable$/,
  /^\/protocols\/[^/]+\/opportunities$/
];

const quoteSessionMatchers = [
  /^\/plans$/,
  /^\/plans\/rebalance$/,
  /^\/policy\/validate$/,
  /^\/execution\/quotes$/,
  /^\/execution\/compose$/,
  /^\/execution\/simulate$/,
  /^\/swaps\/transactions$/,
];

/** Normalize `/protocols/:protocol/opportunities` to a concrete path for matchers. */
function normalizePolicyPath(path: string): string {
  return (path.split("?")[0] ?? path).replace(/:[A-Za-z]+/g, "x");
}

export function classifySessionBucket(
  path: string,
  _method?: string
): SessionBucket | undefined {
  const normalized = normalizePolicyPath(path);
  if (researchSessionMatchers.some((matcher) => matcher.test(normalized))) {
    return "research";
  }
  if (quoteSessionMatchers.some((matcher) => matcher.test(normalized))) {
    return "quotes";
  }
  return undefined;
}

export function getSessionPolicy(
  env: NodeJS.ProcessEnv = process.env
): SessionPolicy {
  return {
    header: "X-Canix-Session",
    receiptUriTemplate: "canix://session/{sessionId}",
    researchBudget: getSessionResearchBudget(env),
    quoteBudget: getSessionQuoteBudget(env),
    ttlSeconds: getSessionTtlSeconds(env),
    priceUsdc: env.X402_PRICE_SESSIONS_USDC?.trim() || DEFAULT_SESSION_PRICE_USDC,
    oneShotDefault: true,
    note:
      "Exact-scheme one-shots remain the default. Send X-Canix-Session with a prepaid receipt to consume N research or M quotes/plans until TTL. Create/refresh are one-shot only. Fail-closed on expiry, exhausted quota, or store unavailability."
  };
}

export function getWatchPolicy(
  env: NodeJS.ProcessEnv = process.env
): WatchPolicy {
  return {
    receiptUriTemplate: "canix://watch/{watchId}",
    ttlSeconds: getWatchTtlSeconds(env),
    priceUsdc: env.X402_PRICE_WATCH_USDC?.trim() || DEFAULT_WATCH_PRICE_USDC,
    pollIntervalSeconds: getWatchPollSeconds(env),
    signatureHeader: "X-Canix-Signature",
    idempotencyHeader: "X-Canix-Idempotency-Key",
    secretHeader: "X-Canix-Watch-Secret",
    note:
      "Recurring x402 retainer. POST /watch registers address + thresholds + optional HTTPS webhook and returns an HMAC secret once. Notifications fire only on threshold crossings, signed with the secret, and carry an idempotency key for replay. Rotate the secret with POST /watch/{id}/rotate-secret. Canix never stores wallet keys."
  };
}
