import client from "prom-client";

/**
 * Prometheus metrics for the protocol service.
 * Scraped via internal `GET /metrics` (not exposed on the public Caddy gateway).
 */
export const metricsRegistry = new client.Registry();

export const httpRequestsTotal = new client.Counter({
  name: "canix_http_requests_total",
  help: "Total HTTP requests handled by the protocol service",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry]
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "canix_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry]
});

export const adapterRequestsTotal = new client.Counter({
  name: "canix_adapter_requests_total",
  help: "Opportunity adapter fetch attempts",
  labelNames: ["protocol", "result"] as const,
  registers: [metricsRegistry]
});

export const adapterDurationSeconds = new client.Histogram({
  name: "canix_adapter_duration_seconds",
  help: "Opportunity adapter fetch duration in seconds",
  labelNames: ["protocol"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry]
});

export const cacheOpsTotal = new client.Counter({
  name: "canix_cache_ops_total",
  help: "Redis cache operations for opportunities",
  labelNames: ["op", "result"] as const,
  registers: [metricsRegistry]
});

export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number
): void {
  const labels = {
    method: method.toUpperCase(),
    route: normalizeRoute(route),
    status_code: String(statusCode)
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(
    { method: labels.method, route: labels.route },
    durationSeconds
  );
}

export function recordAdapterRequest(
  protocol: string,
  result: "ok" | "error",
  durationSeconds: number
): void {
  adapterRequestsTotal.inc({ protocol, result });
  adapterDurationSeconds.observe({ protocol }, durationSeconds);
}

export function recordCacheOp(
  op: "get" | "set" | "del",
  result: "hit" | "miss" | "error" | "skip"
): void {
  cacheOpsTotal.inc({ op, result });
}

export async function renderMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

export function metricsContentType(): string {
  return metricsRegistry.contentType;
}

function normalizeRoute(route: string): string {
  const path = route.split("?")[0] ?? route;
  return path.length > 0 ? path : "unknown";
}
