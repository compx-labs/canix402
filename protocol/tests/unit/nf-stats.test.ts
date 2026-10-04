import assert from "node:assert/strict";
import test from "node:test";

import {
  isNfStatsCronEnabled,
  NF_STATS_CRON_EXPRESSION
} from "../../src/jobs/nf-stats-cron.js";
import {
  buildNfStatsDocument,
  collectNfStatsDocument,
  publishNfStats,
  uploadNfStatsDocument,
  type NfStatsDocument,
  type NfStatsLogger
} from "../../src/services/nf-stats.js";

const TOKEN = "nf-stats-test-token";
const UPLOAD_URL = "https://nf-stats-upload.example/upload/canix402";
const UPDATED_AT = "2026-10-04T10:15:00.000Z";

function fixtureDocument(): NfStatsDocument {
  return buildNfStatsDocument({
    version: "1.8.2",
    networks: ["mainnet", "base"],
    opportunities: 42,
    protocols: 13,
    executionShapes: 80,
    updatedAt: UPDATED_AT
  });
}

function captureLog(): NfStatsLogger & { lines: string[] } {
  const lines: string[] = [];
  const write = (obj: Record<string, unknown>, msg?: string) => {
    lines.push(JSON.stringify({ ...obj, msg }));
  };
  return { lines, info: write, warn: write, error: write };
}

function scriptedFetch(responses: Array<Response | Error>): {
  calls: Array<{ url: string; init: RequestInit | undefined }>;
  sleeps: number[];
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const sleeps: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) {
      throw new Error("unexpected extra upload attempt");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return {
    calls,
    sleeps,
    fetchImpl,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    }
  };
}

test("stats document uses nf-stats/v1 and measured numbers", () => {
  const document = fixtureDocument();
  const serialized = JSON.stringify(document);
  const networksSupported = document.stats.find((stat) => stat.id === "networks_supported");

  assert.equal(document.schema, "nf-stats/v1");
  assert.equal(document.project, "canix402");
  assert.equal(document.updated_at, UPDATED_AT);
  assert.deepEqual(document.networks, ["base", "mainnet"]);
  assert.ok(networksSupported);
  assert.equal(networksSupported.value, document.networks.length);
  assert.equal(networksSupported.as_of, document.updated_at);
  for (const stat of document.stats) {
    assert.equal(typeof stat.value, "number");
    assert.equal(stat.period, "current");
    assert.equal(stat.as_of, UPDATED_AT);
  }
  assert.equal("released_at" in document, false);
  assert.equal(serialized.includes("released_at"), false);
  assert.equal(serialized.includes(TOKEN), false);
});

test("a failed opportunity count omits the document and does not upload", async () => {
  const log = captureLog();
  const transport = scriptedFetch([new Response("ok", { status: 200 })]);
  const document = await collectNfStatsDocument({
    env: { NF_STATS_TOKEN: TOKEN },
    log,
    fetchOpportunities: async () => ({
      data: [{ id: "partial" }],
      errors: [{ protocol: "tinyman", message: `timeout ${TOKEN}` }]
    })
  });
  assert.equal(document, null);

  const published = await publishNfStats({
    env: { NF_STATS_URL: UPLOAD_URL, NF_STATS_TOKEN: TOKEN },
    log,
    fetchOpportunities: async () => ({
      data: [],
      errors: [{ protocol: "aave", message: `down ${TOKEN}` }]
    }),
    fetchImpl: transport.fetchImpl,
    sleep: transport.sleep
  });

  assert.deepEqual(published, { ok: false, reason: "count_failed" });
  assert.equal(transport.calls.length, 0);
  assert.equal(transport.sleeps.length, 0);
  assert.equal(log.lines.join("\n").includes(TOKEN), false);
  assert.equal(log.lines.join("\n").includes("[redacted]"), true);
});

test("upload sends the document once when the store returns 200 ok", async () => {
  const document = fixtureDocument();
  const log = captureLog();
  const transport = scriptedFetch([new Response("ok\n", { status: 200 })]);

  const result = await uploadNfStatsDocument(document, {
    env: { NF_STATS_URL: UPLOAD_URL, NF_STATS_TOKEN: TOKEN },
    log,
    fetchImpl: transport.fetchImpl,
    sleep: transport.sleep
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(transport.calls.length, 1);
  assert.deepEqual(transport.sleeps, []);
  const call = transport.calls[0];
  assert.ok(call);
  assert.equal(call.url, UPLOAD_URL);
  assert.equal(call.init?.method, "PUT");
  const headers = call.init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(typeof call.init?.body, "string");
  assert.equal(String(call.init?.body).includes(TOKEN), false);
  assert.equal(log.lines.join("\n").includes(TOKEN), false);
  assert.equal(log.lines.join("\n").includes("Authorization"), false);
});

test("upload retries a 500 and then stops on 200 ok", async () => {
  const log = captureLog();
  const transport = scriptedFetch([
    new Response("unavailable", { status: 500 }),
    new Response("ok", { status: 200 })
  ]);

  const result = await uploadNfStatsDocument(fixtureDocument(), {
    env: { NF_STATS_URL: UPLOAD_URL, NF_STATS_TOKEN: TOKEN },
    log,
    fetchImpl: transport.fetchImpl,
    sleep: transport.sleep
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(transport.calls.length, 2);
  assert.deepEqual(transport.sleeps, [1_000]);
});

test("upload does not retry a 400", async () => {
  const log = captureLog();
  const transport = scriptedFetch([
    new Response(`rejected ${TOKEN}`, { status: 400 }),
    new Response("ok", { status: 200 })
  ]);

  const result = await uploadNfStatsDocument(fixtureDocument(), {
    env: { NF_STATS_URL: UPLOAD_URL, NF_STATS_TOKEN: TOKEN },
    log,
    fetchImpl: transport.fetchImpl,
    sleep: transport.sleep
  });

  assert.deepEqual(result, { ok: false, reason: "upload_failed" });
  assert.equal(transport.calls.length, 1);
  assert.deepEqual(transport.sleeps, []);
  const logged = log.lines.join("\n");
  assert.equal(logged.includes(TOKEN), false);
  assert.match(logged, /rejected \[redacted\]/);
  assert.equal(logged.includes("Authorization"), false);
});

test("upload retries a network error and then stops", async () => {
  const log = captureLog();
  const transport = scriptedFetch([
    new TypeError("socket hang up"),
    new TypeError("socket hang up"),
    new TypeError("socket hang up"),
    new TypeError(`socket hang up ${TOKEN}`),
    new TypeError("should not be called")
  ]);

  const result = await uploadNfStatsDocument(fixtureDocument(), {
    env: { NF_STATS_URL: UPLOAD_URL, NF_STATS_TOKEN: TOKEN },
    log,
    fetchImpl: transport.fetchImpl,
    sleep: transport.sleep
  });

  assert.deepEqual(result, { ok: false, reason: "upload_failed" });
  assert.equal(transport.calls.length, 4);
  assert.deepEqual(transport.sleeps, [1_000, 2_000, 4_000]);
  const logged = log.lines.join("\n");
  assert.equal(logged.includes(TOKEN), false);
  assert.match(logged, /socket hang up \[redacted\]/);
});

test("upload skips when the URL or token is missing", async () => {
  const log = captureLog();
  const transport = scriptedFetch([new Response("ok", { status: 200 })]);

  const result = await uploadNfStatsDocument(fixtureDocument(), {
    env: { NF_STATS_URL: UPLOAD_URL, NF_STATS_TOKEN: "   " },
    log,
    fetchImpl: transport.fetchImpl,
    sleep: transport.sleep
  });

  assert.deepEqual(result, { ok: false, reason: "missing_config" });
  assert.equal(transport.calls.length, 0);
  assert.equal(transport.sleeps.length, 0);
});

test("stats cron stays off until NF_STATS_URL is set", () => {
  assert.equal(NF_STATS_CRON_EXPRESSION, "15 * * * *");
  assert.equal(isNfStatsCronEnabled({}), false);
  assert.equal(isNfStatsCronEnabled({ NF_STATS_URL: "  " }), false);
  assert.equal(isNfStatsCronEnabled({ NF_STATS_URL: UPLOAD_URL }), true);
});
