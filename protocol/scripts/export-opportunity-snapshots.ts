import { readFileSync, writeFileSync } from "node:fs";
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
 * contract (6 dp standard, up to 12 dp for small non-zero values) and attach
 * executionShapes / compatibleExitShapes via the same enricher as live responses.
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
  assetIds: [0, 31566704],
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
  opportunityId: "folks-lending-971254667",
  assetPair: "USDC",
  assetIds: [31566704],
  apy: 6.06,
  yieldBasis: "apy",
  tvlUsd: 29846.609471,
  sourceTimestamp: "2026-07-06T08:55:00.000Z",
  fetchedAt: "2026-07-06T09:00:00.000Z"
};

const folksLendingAlgo: OpportunityMarketRecord = {
  protocol: "folks-finance",
  opportunityType: "lending",
  opportunityId: "folks-lending-971365552",
  assetPair: "ALGO",
  assetIds: [0],
  apy: 4.25,
  yieldBasis: "apy",
  tvlUsd: 1875000.25,
  sourceTimestamp: "2026-07-06T08:55:00.000Z",
  fetchedAt: "2026-07-06T09:00:00.000Z"
};

const retiStaking: OpportunityMarketRecord = {
  protocol: "reti",
  opportunityType: "staking",
  opportunityId: "reti-staking-12",
  assetPair: "ALGO",
  assetIds: [0],
  apy: 8.5,
  apr: 8.5,
  yieldBasis: "apr",
  tvlUsd: 125000.5,
  sourceTimestamp: "2026-07-23T10:00:00.000Z",
  fetchedAt: "2026-07-23T10:00:00.000Z",
  entryRequirements: {
    minAmount: { assetId: 0, amount: "1000000000" },
    eligibilityFullyCheckable: true
  },
  capacity: {
    stakerSlotsRemaining: 20,
    algoRoomMicroAlgos: "50000000000",
    acceptingStake: true
  },
  notes: "Réti validator-level consensus staking; quote-time eligibility checks are authoritative."
};

const tinymanLpWithAssetIds: OpportunityMarketRecord = {
  ...tinymanLp,
  notes: undefined
};

const files: SampleFile[] = [
  {
    filename: "opportunities.sample.json",
    rows: [tinymanLp, retiStaking, folksLendingUsdc],
    meta: { limit: 10, offset: 0, includeInactive: false, paymentRequired: true }
  },
  {
    filename: "opportunities-search.sample.json",
    rows: [tinymanLp2()],
    meta: { limit: 25, offset: 0, includeInactive: false, paymentRequired: true }
  },
  {
    filename: "opportunities-personalized.sample.json",
    rows: [folksLendingAlgo, tinymanLpWithAssetIds, retiStaking],
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
    rows: [retiStaking],
    meta: { limit: 25, offset: 0, includeInactive: false, paymentRequired: true }
  }
];

function tinymanLp2(): OpportunityMarketRecord {
  return { ...tinymanLp, notes: undefined };
}

function stripUndefined(record: unknown): unknown {
  return JSON.parse(JSON.stringify(record));
}

function main(): void {
  for (const file of files) {
    const data = formatOpportunitiesForAgent(file.rows).map(stripUndefined);
    const payload = { data, meta: file.meta };
    const outputPath = resolve(process.cwd(), "../website/src/data", file.filename);
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  }

  // Keep OpenAPI opportunity response examples aligned with website samples.
  syncOpenApiOpportunityExamples();
}

function syncOpenApiOpportunityExamples(): void {
  const openApiPath = resolve(process.cwd(), "openapi/openapi.json");
  const openApi = JSON.parse(readFileSync(openApiPath, "utf-8")) as {
    components?: {
      examples?: Record<string, { summary?: string; value?: unknown }>;
    };
  };

  if (!openApi.components?.examples) {
    return;
  }

  const aggregate = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../website/src/data/opportunities.sample.json"),
      "utf-8"
    )
  );
  const search = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../website/src/data/opportunities-search.sample.json"),
      "utf-8"
    )
  );
  const personalized = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "../website/src/data/opportunities-personalized.sample.json"
      ),
      "utf-8"
    )
  );
  const protocol = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../website/src/data/protocol-opportunities.sample.json"),
      "utf-8"
    )
  );

  const examples = openApi.components.examples;
  if (examples.AggregateOpportunitiesSample) {
    examples.AggregateOpportunitiesSample.value = aggregate;
  }
  if (examples.FilteredOpportunitiesSample) {
    examples.FilteredOpportunitiesSample.value = search;
  }
  if (examples.PersonalizedOpportunitiesSample) {
    examples.PersonalizedOpportunitiesSample.value = personalized;
  }
  if (examples.ProtocolOpportunitiesSample) {
    examples.ProtocolOpportunitiesSample.value = protocol;
  }

  writeFileSync(openApiPath, `${JSON.stringify(openApi, null, 2)}\n`, "utf-8");
}

main();
