import assert from "node:assert/strict";
import test from "node:test";

import {
  FALLBACK_IDENTIFIERS_NOTE,
  SOURCE_TIMESTAMP_FETCH_PROXY_NOTE,
  buildSourceMetadata,
  resolveSourceTimestamp,
  unixSecondsToIsoTimestamp
} from "../../src/services/source-metadata.js";

test("resolveSourceTimestamp uses upstream unix seconds when valid", () => {
  const resolved = resolveSourceTimestamp(
    "2026-07-01T12:00:00.000Z",
    1_700_000_000
  );

  assert.equal(resolved.origin, "upstream");
  assert.equal(resolved.sourceTimestamp, "2023-11-14T22:13:20.000Z");
});

test("resolveSourceTimestamp falls back to fetchedAt for missing upstream timestamp", () => {
  const fetchedAt = "2026-07-01T12:00:00.000Z";
  const resolved = resolveSourceTimestamp(fetchedAt, 0);

  assert.equal(resolved.origin, "fetch-proxy");
  assert.equal(resolved.sourceTimestamp, fetchedAt);
});

test("buildSourceMetadata adds fetch-proxy note when upstream timestamp is unavailable", () => {
  const metadata = buildSourceMetadata({
    fetchedAtIso: "2026-07-01T12:00:00.000Z"
  });

  assert.equal(metadata.sourceTimestamp, metadata.fetchedAt);
  assert.equal(metadata.notes, SOURCE_TIMESTAMP_FETCH_PROXY_NOTE);
});

test("buildSourceMetadata combines fetch-proxy, fallback, and context notes", () => {
  const metadata = buildSourceMetadata({
    fetchedAtIso: "2026-07-01T12:00:00.000Z",
    usedFallbackIdentifiers: true,
    contextNotes: ["Tinyman LP pool 123."]
  });

  assert.match(metadata.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
  assert.match(metadata.notes ?? "", new RegExp(FALLBACK_IDENTIFIERS_NOTE));
  assert.match(metadata.notes ?? "", /Tinyman LP pool 123\./);
});

test("buildSourceMetadata omits fetch-proxy note when upstream timestamp is present", () => {
  const metadata = buildSourceMetadata({
    fetchedAtIso: "2026-07-01T12:00:00.000Z",
    upstreamUnixSeconds: 1_700_000_000,
    contextNotes: ["CompX lending market 123456; util=55.2%."]
  });

  assert.equal(metadata.sourceTimestamp, "2023-11-14T22:13:20.000Z");
  assert.equal(metadata.fetchedAt, "2026-07-01T12:00:00.000Z");
  assert.equal(metadata.notes, "CompX lending market 123456; util=55.2%.");
});

test("unixSecondsToIsoTimestamp accepts bigint unix seconds", () => {
  assert.equal(
    unixSecondsToIsoTimestamp(1_700_000_000n, "2026-07-01T12:00:00.000Z"),
    "2023-11-14T22:13:20.000Z"
  );
});
