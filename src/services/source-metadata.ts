export const SOURCE_TIMESTAMP_FETCH_PROXY_NOTE =
  "sourceTimestamp equals fetchedAt; upstream does not expose a per-row update timestamp.";

export const FALLBACK_IDENTIFIERS_NOTE =
  "Some source fields were missing; fallback identifiers were used.";

export type SourceTimestampOrigin = "upstream" | "fetch-proxy";

export interface SourceMetadataFields {
  sourceTimestamp: string;
  fetchedAt: string;
  notes?: string;
}

export interface BuildSourceMetadataInput {
  fetchedAtIso: string;
  upstreamUnixSeconds?: number | bigint | null;
  contextNotes?: string[];
  usedFallbackIdentifiers?: boolean;
}

export function unixSecondsToIsoTimestamp(
  unixSeconds: number | bigint,
  fallbackIso: string
): string {
  const asNumber =
    typeof unixSeconds === "bigint" ? Number(unixSeconds) : unixSeconds;
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return fallbackIso;
  }

  return new Date(asNumber * 1000).toISOString();
}

export function resolveSourceTimestamp(
  fetchedAtIso: string,
  upstreamUnixSeconds?: number | bigint | null
): { sourceTimestamp: string; origin: SourceTimestampOrigin } {
  if (upstreamUnixSeconds === undefined || upstreamUnixSeconds === null) {
    return { sourceTimestamp: fetchedAtIso, origin: "fetch-proxy" };
  }

  const asNumber =
    typeof upstreamUnixSeconds === "bigint"
      ? Number(upstreamUnixSeconds)
      : upstreamUnixSeconds;
  if (!Number.isFinite(asNumber) || asNumber <= 0) {
    return { sourceTimestamp: fetchedAtIso, origin: "fetch-proxy" };
  }

  return {
    sourceTimestamp: new Date(asNumber * 1000).toISOString(),
    origin: "upstream"
  };
}

export function buildSourceMetadata(
  input: BuildSourceMetadataInput
): SourceMetadataFields {
  const {
    fetchedAtIso,
    upstreamUnixSeconds,
    contextNotes = [],
    usedFallbackIdentifiers = false
  } = input;

  const { sourceTimestamp, origin } = resolveSourceTimestamp(
    fetchedAtIso,
    upstreamUnixSeconds
  );

  const noteParts: string[] = [];
  if (origin === "fetch-proxy") {
    noteParts.push(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE);
  }
  if (usedFallbackIdentifiers) {
    noteParts.push(FALLBACK_IDENTIFIERS_NOTE);
  }
  for (const note of contextNotes) {
    const trimmed = note.trim();
    if (trimmed.length > 0) {
      noteParts.push(trimmed);
    }
  }

  const notes = noteParts.length > 0 ? noteParts.join(" ") : undefined;
  return {
    sourceTimestamp,
    fetchedAt: fetchedAtIso,
    ...(notes ? { notes } : {})
  };
}
