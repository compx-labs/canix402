import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../../src/app.js";
import {
  setReadinessDependencyOverrides
} from "../../src/services/readiness.js";

test("GET /ready returns 200 when algod is healthy and redis is unconfigured", async () => {
  setReadinessDependencyOverrides({
    checkAlgod: async () => ({ ok: true, latencyMs: 12 }),
    checkRedis: async () => ({ configured: false, ok: true })
  });

  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/ready" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    data: {
      service: "canix402",
      status: "ready",
      checks: {
        algod: { ok: true, latencyMs: 12 },
        redis: { configured: false, ok: true }
      }
    }
  });

  await app.close();
  setReadinessDependencyOverrides(null);
});

test("GET /ready returns 200 degraded when redis is configured but unhealthy", async () => {
  setReadinessDependencyOverrides({
    checkAlgod: async () => ({ ok: true, latencyMs: 8 }),
    checkRedis: async () => ({
      configured: true,
      ok: false,
      latencyMs: 5,
      error: "redis ping timeout"
    })
  });

  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/ready" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, "degraded");
  assert.equal(response.json().data.checks.redis.ok, false);

  await app.close();
  setReadinessDependencyOverrides(null);
});

test("GET /ready returns 503 when algod is unhealthy", async () => {
  setReadinessDependencyOverrides({
    checkAlgod: async () => ({
      ok: false,
      latencyMs: 3,
      error: "algod status timeout"
    }),
    checkRedis: async () => ({ configured: false, ok: true })
  });

  const app = buildApp();
  const response = await app.inject({ method: "GET", url: "/ready" });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().data.status, "not_ready");
  assert.equal(response.json().data.checks.algod.ok, false);

  await app.close();
  setReadinessDependencyOverrides(null);
});

test("GET /metrics exposes Prometheus metric names", async () => {
  const app = buildApp();
  await app.inject({ method: "GET", url: "/health" });

  const response = await app.inject({ method: "GET", url: "/metrics" });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/plain/);
  assert.match(response.body, /canix_http_requests_total/);
  assert.match(response.body, /canix_http_request_duration_seconds/);
  assert.match(response.body, /canix_adapter_requests_total/);
  assert.match(response.body, /canix_adapter_duration_seconds/);
  assert.match(response.body, /canix_cache_ops_total/);

  await app.close();
});

test("GET /ready is free under edge gating", async () => {
  setReadinessDependencyOverrides({
    checkAlgod: async () => ({ ok: true, latencyMs: 1 }),
    checkRedis: async () => ({ configured: false, ok: true })
  });

  const app = buildApp();
  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (path === "/ready" || path === "/health" || path === "/metrics") {
      return;
    }
    return reply.status(402).send({ error: { code: "PAYMENT_REQUIRED", message: "pay" } });
  });

  const ready = await app.inject({ method: "GET", url: "/ready" });
  const metrics = await app.inject({ method: "GET", url: "/metrics" });

  assert.equal(ready.statusCode, 200);
  assert.equal(metrics.statusCode, 200);

  await app.close();
  setReadinessDependencyOverrides(null);
});
