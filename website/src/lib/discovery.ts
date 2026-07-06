import snapshot from "../data/discovery.snapshot.json";

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
