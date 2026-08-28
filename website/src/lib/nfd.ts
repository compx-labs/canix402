const DEFAULT_NFD_API_BASE_URL = "https://api.nf.domains";

export function shortenAlgorandAddress(address: string, edge = 5): string {
  if (address.length <= edge * 2) {
    return address;
  }
  return `${address.slice(0, edge)}...${address.slice(-edge)}`;
}

export function nfdNameFromLookupPayload(payload: unknown, address: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const entry = (payload as Record<string, unknown>)[address];
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const name = (entry as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

export async function lookupNfdName(
  address: string,
  options: { apiBaseUrl?: string; fetchImpl?: typeof fetch } = {}
): Promise<string | null> {
  if (!address) {
    return null;
  }
  const base = (options.apiBaseUrl && options.apiBaseUrl.length > 0
    ? options.apiBaseUrl
    : DEFAULT_NFD_API_BASE_URL
  ).replace(/\/$/, "");
  const params = new URLSearchParams({ view: "tiny", address });
  try {
    const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    const response = await fetchImpl(`${base}/nfd/lookup?${params.toString()}`);
    if (!response.ok) {
      return null;
    }
    return nfdNameFromLookupPayload(await response.json(), address);
  } catch {
    return null;
  }
}

export function displayWalletLabel(address: string, nfdName: string | null | undefined): string {
  return nfdName && nfdName.length > 0 ? nfdName : shortenAlgorandAddress(address);
}
