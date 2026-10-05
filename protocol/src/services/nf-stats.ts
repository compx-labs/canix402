import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { executionRegistry } from "../execution/index.js";
import { getAppLogger } from "../observability/logger.js";
import {
  fetchOpportunitiesWithErrors,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "./aggregate-opportunities.js";

export const NF_STATS_SCHEMA = "nf-stats/v1" as const;
export const NF_STATS_PROJECT = "canix402" as const;
export const NF_STATS_NAME = "Canix" as const;
export const NF_STATS_PUBLIC_URL = "https://canix402.compx.io" as const;

/** Initial attempt plus three retries: 1s, then 2s, then 4s. */
export const NF_STATS_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export interface NfStat {
  id: string;
  label: string;
  value: number;
  unit: "count";
  period: "current";
  as_of: string;
  source: string;
}

export interface NfStatsDocument {
  schema: typeof NF_STATS_SCHEMA;
  project: typeof NF_STATS_PROJECT;
  name: typeof NF_STATS_NAME;
  status: "live";
  version: string;
  url: typeof NF_STATS_PUBLIC_URL;
  networks: string[];
  updated_at: string;
  stats: NfStat[];
}

export interface NfStatsMeasurements {
  version: string;
  networks: readonly string[];
  opportunities: number;
  protocols: number;
  executionShapes: number;
  updatedAt: string;
}

export interface OpportunityCountResult {
  data: readonly unknown[];
  errors: ReadonlyArray<{ protocol: string; message: string }>;
}

export interface NfStatsLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface NfStatsCollectDeps {
  env?: NodeJS.ProcessEnv;
  fetchOpportunities?: () => Promise<OpportunityCountResult>;
  readVersion?: () => string;
  listNetworks?: () => readonly string[];
  countProtocols?: () => number;
  countExecutionShapes?: () => number;
  now?: () => Date;
  log?: NfStatsLogger;
}

export interface NfStatsUploadDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: NfStatsLogger;
}

export type NfStatsUploadResult =
  | { ok: true }
  | { ok: false; reason: "missing_config" | "upload_failed" };

export type NfStatsPublishResult =
  | { ok: true }
  | { ok: false; reason: "count_failed" | "missing_config" | "upload_failed" };

export function readProtocolVersion(): string {
  const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json");
  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.trim().length === 0) {
    throw new Error("protocol package.json is missing version");
  }
  return parsed.version.trim();
}

/** Public stats ids. The shape registry records Algorand as `mainnet`. */
const NF_STATS_NETWORK_IDS: Record<string, string> = {
  mainnet: "algorand",
  base: "base"
};

export function publishableNetworkId(network: string): string {
  return NF_STATS_NETWORK_IDS[network] ?? network;
}

export function listSupportedNetworks(): string[] {
  const networks = new Set<string>();
  for (const shape of executionRegistry.list()) {
    networks.add(publishableNetworkId(shape.identity.network));
  }
  return [...networks].sort();
}

export function buildNfStatsDocument(input: NfStatsMeasurements): NfStatsDocument {
  const version = input.version.trim();
  if (!version) {
    throw new Error("nf-stats version is missing");
  }
  if (!input.updatedAt.trim()) {
    throw new Error("nf-stats updatedAt is missing");
  }
  for (const value of [input.opportunities, input.protocols, input.executionShapes]) {
    if (!Number.isFinite(value)) {
      throw new Error("nf-stats value is not a finite number");
    }
  }

  const networks = [...new Set(input.networks.map(publishableNetworkId))].sort();
  const asOf = input.updatedAt;
  const stat = (id: string, label: string, value: number, source: string): NfStat => ({
    id,
    label,
    value,
    unit: "count",
    period: "current",
    as_of: asOf,
    source
  });

  return {
    schema: NF_STATS_SCHEMA,
    project: NF_STATS_PROJECT,
    name: NF_STATS_NAME,
    status: "live",
    version,
    url: NF_STATS_PUBLIC_URL,
    networks,
    updated_at: asOf,
    stats: [
      stat("opportunities", "Opportunities", input.opportunities, "aggregate opportunity catalog"),
      stat("protocols", "Protocols", input.protocols, "SUPPORTED_AGGREGATE_PROTOCOLS"),
      stat(
        "execution_shapes",
        "Execution shapes",
        input.executionShapes,
        "verified execution shape registry"
      ),
      stat("networks_supported", "Networks", networks.length, "verified execution shape registry")
    ]
  };
}

/**
 * Build the stats document from the live catalog.
 * Returns null when any opportunity adapter fails so the previous upload stays in place.
 */
export async function collectNfStatsDocument(
  deps: NfStatsCollectDeps = {}
): Promise<NfStatsDocument | null> {
  const log = deps.log ?? appLogger();
  const token = (deps.env ?? process.env).NF_STATS_TOKEN?.trim() ?? "";
  const fetchOpportunities =
    deps.fetchOpportunities ??
    (() => fetchOpportunitiesWithErrors(SUPPORTED_AGGREGATE_PROTOCOLS));

  let result: OpportunityCountResult;
  try {
    result = await fetchOpportunities();
  } catch (error) {
    log.error(
      {
        event: "nf_stats_collect",
        err: redactSecrets(error instanceof Error ? error.message : String(error), token)
      },
      "Opportunity count failed; stats upload skipped"
    );
    return null;
  }

  if (result.errors.length > 0) {
    log.error(
      {
        event: "nf_stats_collect",
        errors: result.errors.map((entry) => ({
          protocol: entry.protocol,
          message: redactSecrets(entry.message, token)
        }))
      },
      "Opportunity count failed; stats upload skipped"
    );
    return null;
  }

  const updatedAt = (deps.now ?? (() => new Date()))().toISOString();
  const networks = (deps.listNetworks ?? listSupportedNetworks)();
  const protocols = (deps.countProtocols ?? (() => SUPPORTED_AGGREGATE_PROTOCOLS.length))();
  const executionShapes = (
    deps.countExecutionShapes ?? (() => executionRegistry.list().length)
  )();

  return buildNfStatsDocument({
    version: (deps.readVersion ?? readProtocolVersion)(),
    networks,
    opportunities: result.data.length,
    protocols,
    executionShapes,
    updatedAt
  });
}

export async function uploadNfStatsDocument(
  document: NfStatsDocument,
  deps: NfStatsUploadDeps = {}
): Promise<NfStatsUploadResult> {
  const env = deps.env ?? process.env;
  const url = env.NF_STATS_URL?.trim() ?? "";
  const token = env.NF_STATS_TOKEN?.trim() ?? "";
  const log = deps.log ?? appLogger();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? delay;

  if (!url || !token) {
    log.error(
      {
        event: "nf_stats_upload",
        missingUrl: !url,
        missingToken: !token
      },
      "Neon Forge stats upload skipped: NF_STATS_URL or NF_STATS_TOKEN is unset"
    );
    return { ok: false, reason: "missing_config" };
  }

  const body = JSON.stringify(document);
  const attempts = NF_STATS_RETRY_DELAYS_MS.length + 1;
  let lastStatus: number | undefined;
  let lastBody = "";
  let lastError = "";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body
      });
      const responseBody = await response.text();
      if (response.status === 200 && responseBody.trim() === "ok") {
        log.info({ event: "nf_stats_upload", status: 200 }, "Neon Forge stats uploaded");
        return { ok: true };
      }

      if (response.status >= 200 && response.status < 500) {
        log.error(
          {
            event: "nf_stats_upload",
            status: response.status,
            body: redactSecrets(responseBody, token)
          },
          "Neon Forge stats upload rejected"
        );
        return { ok: false, reason: "upload_failed" };
      }

      lastStatus = response.status;
      lastBody = responseBody;
      lastError = "";
    } catch (error) {
      lastStatus = undefined;
      lastBody = "";
      lastError = error instanceof Error && error.message ? error.message : "network error";
    }

    const waitMs = NF_STATS_RETRY_DELAYS_MS[attempt];
    if (waitMs === undefined) {
      break;
    }
    await sleep(waitMs);
  }

  const fields: Record<string, unknown> = { event: "nf_stats_upload" };
  if (lastStatus !== undefined) {
    fields.status = lastStatus;
    fields.body = redactSecrets(lastBody, token);
  }
  if (lastError) {
    fields.err = redactSecrets(lastError, token);
  }
  log.error(fields, "Neon Forge stats upload failed");
  return { ok: false, reason: "upload_failed" };
}

export async function publishNfStats(
  deps: NfStatsCollectDeps & NfStatsUploadDeps = {}
): Promise<NfStatsPublishResult> {
  const document = await collectNfStatsDocument(deps);
  if (!document) {
    return { ok: false, reason: "count_failed" };
  }
  return uploadNfStatsDocument(document, deps);
}

export function redactSecrets(value: string, token: string): string {
  if (!token) {
    return value;
  }
  return value.split(token).join("[redacted]");
}

function appLogger(): NfStatsLogger {
  const log = getAppLogger();
  return {
    info: (obj, msg) => {
      log.info(obj, msg);
    },
    warn: (obj, msg) => {
      log.warn(obj, msg);
    },
    error: (obj, msg) => {
      log.error(obj, msg);
    }
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
