import { createHmac, timingSafeEqual } from "node:crypto";

export const WATCH_SIGNATURE_HEADER = "x-canix-signature";
export const WATCH_IDEMPOTENCY_HEADER = "x-canix-idempotency-key";
export const WATCH_ID_HEADER = "x-canix-watch-id";
export const WATCH_SECRET_HEADER = "x-canix-watch-secret";

export const WATCH_SIGNATURE_PREFIX = "sha256=";

export interface WatchWebhookPayload {
  watchId: string;
  address: string;
  kind: string;
  idempotencyKey: string;
  firedAt: string;
  threshold: number | string | boolean;
  previous: number | string | boolean | null;
  current: number | string | boolean | null;
  opportunityId?: string;
}

export interface WatchWebhookDelivery {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function signWatchBody(secret: string, body: string): string {
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return `${WATCH_SIGNATURE_PREFIX}${digest}`;
}

export function verifyWatchSignature(
  secret: string,
  body: string,
  signatureHeader: string | undefined
): boolean {
  if (!signatureHeader) {
    return false;
  }
  const expected = signWatchBody(secret, body);
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

export function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function serializeWatchWebhookBody(payload: WatchWebhookPayload): string {
  return JSON.stringify(payload);
}

export function buildWatchWebhookDelivery(
  url: string,
  secret: string,
  payload: WatchWebhookPayload
): WatchWebhookDelivery {
  const body = serializeWatchWebhookBody(payload);
  return {
    url,
    headers: {
      "content-type": "application/json",
      "user-agent": "canix402-watch/1.0",
      [WATCH_ID_HEADER]: payload.watchId,
      [WATCH_IDEMPOTENCY_HEADER]: payload.idempotencyKey,
      [WATCH_SIGNATURE_HEADER]: signWatchBody(secret, body)
    },
    body
  };
}

export function validateWebhookUrl(
  raw: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "webhookUrl is empty.";
  }
  if (trimmed.length > 2048) {
    return "webhookUrl exceeds 2048 characters.";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "webhookUrl is not a valid URL.";
  }

  if (parsed.username || parsed.password) {
    return "webhookUrl must not include credentials.";
  }

  const isProduction = env.NODE_ENV === "production";
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  if (parsed.protocol === "http:") {
    if (isProduction || !isLoopback) {
      return "webhookUrl must use https (http is allowed only for localhost in non-production).";
    }
    return null;
  }

  if (parsed.protocol !== "https:") {
    return "webhookUrl must use https.";
  }

  if (isProduction && isPrivateHostname(hostname)) {
    return "webhookUrl must not target a private or loopback host.";
  }

  return null;
}

function isPrivateHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal"
  ) {
    return true;
  }
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) {
    return true;
  }
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) {
    return true;
  }
  if (/^169\.254\.\d+\.\d+$/.test(hostname)) {
    return true;
  }
  const match172 = /^172\.(\d+)\.\d+\.\d+$/.exec(hostname);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }
  return false;
}

export type WatchWebhookPoster = (
  delivery: WatchWebhookDelivery
) => Promise<{ ok: boolean; status?: number }>;

const DEFAULT_TIMEOUT_MS = 5_000;

export async function postWatchWebhook(
  delivery: WatchWebhookDelivery,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(delivery.url, {
      method: "POST",
      headers: delivery.headers,
      body: delivery.body,
      signal: controller.signal
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
