import snapshot from "../data/discovery.snapshot.json";
import {
  defaultPaidPriceUsdc,
  eligibilityPriceUsdc,
  personalizedPriceUsdc,
  plansPriceUsdc,
  plansRebalancePriceUsdc,
  executionComposePriceUsdc,
  executionSimulatePriceUsdc,
  positionsClaimablePriceUsdc,
  positionsPriceUsdc
} from "./config";

export interface DiscoveryEndpoint {
  id: string;
  method: string;
  path: string;
  access: "free" | "paid";
  summary: string;
  tags: string[];
  pathParams?: string[];
  queryParams?: string[];
  responseCodes?: number[];
  x402?: {
    protocolVersion: number;
    requiredHeaders: string[];
    facilitator: string;
    requirementTemplate: {
      scheme: string;
      network: string;
      asset: string;
      payTo: string;
      maxAmountRequired: string;
    };
  };
}

export interface DiscoveryDocument {
  service: string;
  apiVersion: string;
  discoveryVersion: string;
  capabilities: string[];
  x402ProtocolVersion: number;
  endpoints: DiscoveryEndpoint[];
  errorCatalog: Array<{
    code: string;
    httpStatus: number;
    description: string;
  }>;
}

export interface LoadedDiscovery {
  document: DiscoveryDocument;
  source: "live" | "snapshot";
}

const FETCH_TIMEOUT_MS = 4_000;

function unwrapDiscoveryPayload(payload: unknown): DiscoveryDocument {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "data" in payload &&
    typeof (payload as { data?: unknown }).data === "object" &&
    (payload as { data?: unknown }).data !== null
  ) {
    return (payload as { data: DiscoveryDocument }).data;
  }

  return payload as DiscoveryDocument;
}

function isPersonalizedEndpoint(endpoint: DiscoveryEndpoint): boolean {
  return (
    endpoint.id === "personalizedOpportunities" ||
    endpoint.path.includes("/personalized")
  );
}

function isPositionsEndpoint(endpoint: DiscoveryEndpoint): boolean {
  return endpoint.id === "positions" || endpoint.path === "/positions";
}

function isClaimableEndpoint(endpoint: DiscoveryEndpoint): boolean {
  return (
    endpoint.id === "positionsClaimable" || endpoint.path === "/positions/claimable"
  );
}

function isEligibilityEndpoint(endpoint: DiscoveryEndpoint): boolean {
  return endpoint.id === "eligibility" || endpoint.path === "/eligibility";
}

function isPlansEndpoint(endpoint: DiscoveryEndpoint): boolean {
  return endpoint.id === "plans" || endpoint.path === "/plans";
}

function isRebalanceEndpoint(endpoint: DiscoveryEndpoint): boolean {
  return endpoint.id === "plansRebalance" || endpoint.path === "/plans/rebalance";
}

function isComposeEndpoint(endpoint: DiscoveryEndpoint): boolean {
  return endpoint.id === "executionCompose" || endpoint.path === "/execution/compose";
}

function isSimulateEndpoint(endpoint: DiscoveryEndpoint): boolean {
  return endpoint.id === "executionSimulate" || endpoint.path === "/execution/simulate";
}

function resolvePaidAmount(endpoint: DiscoveryEndpoint): string {
  const raw = endpoint.x402?.requirementTemplate.maxAmountRequired?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed.toString();
    }

    return raw;
  }

  if (isPersonalizedEndpoint(endpoint)) {
    return personalizedPriceUsdc;
  }

  if (isEligibilityEndpoint(endpoint)) {
    return eligibilityPriceUsdc;
  }

  if (isPlansEndpoint(endpoint)) {
    return plansPriceUsdc;
  }

  if (isRebalanceEndpoint(endpoint)) {
    return plansRebalancePriceUsdc;
  }

  if (isComposeEndpoint(endpoint)) {
    return executionComposePriceUsdc;
  }

  if (isSimulateEndpoint(endpoint)) {
    return executionSimulatePriceUsdc;
  }

  if (isPositionsEndpoint(endpoint)) {
    return positionsPriceUsdc;
  }

  if (isClaimableEndpoint(endpoint)) {
    return positionsClaimablePriceUsdc;
  }

  return defaultPaidPriceUsdc;
}

export function formatEndpointPrice(endpoint: DiscoveryEndpoint): string {
  if (endpoint.access !== "paid") {
    return "Free";
  }

  return `${resolvePaidAmount(endpoint)} USDC`;
}

/** Compact card price label, e.g. "$0.01" or "Free". */
export function formatEndpointPriceShort(endpoint: DiscoveryEndpoint): string {
  if (endpoint.access !== "paid") {
    return "Free";
  }

  const amount = resolvePaidAmount(endpoint);
  const parsed = Number(amount);
  if (Number.isFinite(parsed)) {
    const digits = parsed < 0.01 ? 3 : 2;
    return `$${parsed.toFixed(digits)}`;
  }

  return `$${amount}`;
}

/** CSS class for colored endpoint tag pills (hierarchy by domain). */
export function tagBadgeClass(tag: string): string {
  const normalized = tag.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const known = [
    "defi",
    "opportunities",
    "positions",
    "wallet",
    "execution",
    "swaps",
    "haystack",
    "protocol",
    "search",
    "personalized",
    "eligibility",
    "plans",
    "rebalance",
    "simulation",
    "discovery",
    "system",
    "openapi",
    "agents",
    "x402",
    "x402-global-challenge",
    "transactions",
    "pricing",
    "compx"
  ];
  if (known.includes(normalized)) {
    return `badge badge-tag badge-tag-${normalized}`;
  }
  return "badge badge-tag";
}

export function formatEndpointTitle(endpoint: DiscoveryEndpoint): string {
  const fromId = endpoint.id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

  return fromId || endpoint.path;
}

export async function loadDiscovery(discoveryUrl: string): Promise<LoadedDiscovery> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(discoveryUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Discovery fetch failed with status ${response.status}`);
    }

    const payload = unwrapDiscoveryPayload(await response.json());
    return { document: payload, source: "live" };
  } catch {
    const payload = unwrapDiscoveryPayload(snapshot);
    return { document: payload, source: "snapshot" };
  }
}
