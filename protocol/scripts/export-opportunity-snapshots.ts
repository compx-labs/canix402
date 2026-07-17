import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { formatOpportunitiesForAgent } from "../src/services/precision.js";
import { OpportunityMarketRecord } from "../src/types/opportunity.js";

/**
 * Regenerates the illustrative opportunity response samples used by the website
 * examples page and mirrored in the OpenAPI examples.
 *
 * The paid opportunity routes fetch from live upstream adapters, so injecting
 * them here would be non-deterministic. Instead we define canonical sample rows
 * and run them through the same precision formatter the API uses at the response
 * boundary, guaranteeing the checked-in samples honor the published precision
 * contract (6 dp standard, up to 12 dp for small non-zero values).
 */

interface SampleFile {
  filename: string;
  rows: OpportunityMarketRecord[];
  meta: Record<string, string | number | boolean>;
}

const tinymanLp: OpportunityMarketRecord = {
  protocol: "tinyman",
  opportunityType: "lp",
  opportunityId: "tinyman:pool:1002541853",
  assetPair: "ALGO/USDC",
  apr: 10.512,
  apy: 12.5,
  yieldBasis: "apy",
  tvlUsd: 2450000.5,
  sourceTimestamp: "2026-07-06T09:00:00.000Z",
  fetchedAt: "2026-07-06T09:00:00.000Z",
  notes: "sourceTimestamp reflects fetch time; upstream does not expose a per-row update time."
};

const folksLendingUsdc: OpportunityMarketRecord = {
  protocol: "folks-finance",
  opportunityType: "lending",
  opportunityId: "folks:lending:31566704",
  assetPair: "USDC",
  apy: 6.06,
  yieldBasis: "apy",
  tvlUsd: 29846.609471,
  sourceTimestamp: "2026-07-06T08:55:00.000Z",
  fetchedAt: "2026-07-06T09:00:00.000Z"
};

const folksLendingAlgo: OpportunityMarketRecord = {
  protocol: "folks-finance",
  opportunityType: "lending",
  opportunityId: "folks:lending:0",
  assetPair: "ALGO",
  assetIds: [0],
  apy: 4.25,
  yieldBasis: "apy",
  tvlUsd: 1875000.25,
  sourceTimestamp: "2026-07-06T08:55:00.000Z",
  fetchedAt: "2026-07-06T09:00:00.000Z"
};

const tinymanLpWithAssetIds: OpportunityMarketRecord = {
  ...tinymanLp,
  assetIds: [0, 31566704],
  notes: undefined
};

const files: SampleFile[] = [
  {
    filename: "opportunities.sample.json",
    rows: [tinymanLp, folksLendingUsdc],
    meta: { limit: 10, offset: 0, includeInactive: false, paymentRequired: true }
  },
  {
    filename: "opportunities-search.sample.json",
    rows: [tinymanLp2()],
    meta: { limit: 25, offset: 0, includeInactive: false, paymentRequired: true }
  },
  {
    filename: "opportunities-personalized.sample.json",
    rows: [folksLendingAlgo, tinymanLpWithAssetIds],
    meta: {
      limit: 10,
      offset: 0,
      includeInactive: false,
      paymentRequired: true,
      address: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      heldAssetCount: 2
    }
  },
  {
    filename: "protocol-opportunities.sample.json",
    rows: [tinymanLp2()],
    meta: { limit: 25, offset: 0, includeInactive: false, paymentRequired: true }
  }
];

function tinymanLp2(): OpportunityMarketRecord {
  return { ...tinymanLp, notes: undefined };
}

function stripUndefined(record: OpportunityMarketRecord): OpportunityMarketRecord {
  return JSON.parse(JSON.stringify(record)) as OpportunityMarketRecord;
}

function main(): void {
  for (const file of files) {
    const data = formatOpportunitiesForAgent(file.rows).map(stripUndefined);
    const payload = { data, meta: file.meta };
    const outputPath = resolve(process.cwd(), "../website/src/data", file.filename);
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }
}

main();
