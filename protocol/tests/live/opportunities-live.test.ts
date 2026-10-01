import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildApp } from "../../src/app.js";
import type { OpportunityRecordV1 } from "../../src/types/opportunity.js";

const REVIEW_LIMIT = 100;
const REVIEW_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../tmp/opportunities-review"
);

const OPPORTUNITY_TYPES = new Set(["lp", "farm", "staking", "lending"]);

interface OpportunitiesBody {
  data: OpportunityRecordV1[];
  meta?: {
    limit?: number;
    cacheEnabled?: boolean;
    cacheHit?: boolean;
  };
}

interface ReviewCase {
  file: string;
  url: string;
  assertRow?: (row: OpportunityRecordV1) => void;
}

interface ReviewIndexEntry {
  file: string;
  url: string;
  status: number;
  returnedCount: number;
  cacheEnabled: boolean | null;
  cacheHit: boolean | null;
}

const REVIEW_CASES: ReviewCase[] = [
  {
    file: "list.json",
    url: `/opportunities?limit=${REVIEW_LIMIT}`
  },
  {
    file: "search-unfiltered.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}`
  },
  {
    file: "search-platform-compx.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&platform=compx`,
    assertRow: (row) => {
      assert.equal(row.protocol, "compx", `${row.opportunityId} protocol`);
    }
  },
  {
    file: "search-platform-folks-tinyman.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&platform=folks-finance,tinyman`,
    assertRow: (row) => {
      assert.ok(
        row.protocol === "folks-finance" || row.protocol === "tinyman",
        `${row.opportunityId} protocol ${row.protocol}`
      );
    }
  },
  {
    file: "search-type-lending.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&type=lending`,
    assertRow: (row) => {
      assert.equal(row.opportunityType, "lending", `${row.opportunityId} type`);
    }
  },
  {
    file: "search-type-lp.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&type=lp`,
    assertRow: (row) => {
      assert.equal(row.opportunityType, "lp", `${row.opportunityId} type`);
    }
  },
  {
    file: "search-platform-pact-lp.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&platform=pact&type=lp`,
    assertRow: (row) => {
      assert.equal(row.protocol, "pact", `${row.opportunityId} protocol`);
      assert.equal(row.opportunityType, "lp", `${row.opportunityId} type`);
    }
  },
  {
    file: "search-min-apy.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&minApy=5`,
    assertRow: (row) => {
      assert.ok(row.apy >= 5, `${row.opportunityId} apy ${row.apy}`);
    }
  },
  {
    file: "search-max-apy.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&maxApy=20`,
    assertRow: (row) => {
      assert.ok(row.apy <= 20, `${row.opportunityId} apy ${row.apy}`);
    }
  },
  {
    file: "search-min-tvl.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&minTvlUsd=50000`,
    assertRow: (row) => {
      assert.ok(row.tvlUsd >= 50_000, `${row.opportunityId} tvlUsd ${row.tvlUsd}`);
    }
  },
  {
    file: "search-chain-algorand.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&chain=algorand`,
    assertRow: (row) => {
      assert.equal(row.chain, "algorand", `${row.opportunityId} chain`);
    }
  },
  {
    file: "search-chain-base.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&chain=base`,
    assertRow: (row) => {
      assert.equal(row.chain, "base", `${row.opportunityId} chain`);
    }
  },
  {
    file: "search-asset-usdc.json",
    url: `/opportunities/search?limit=${REVIEW_LIMIT}&assetIds=31566704`,
    assertRow: (row) => {
      assert.ok(
        (row.assetIds ?? []).includes(31566704),
        `${row.opportunityId} assetIds`
      );
    }
  }
];

function assertRowQuality(row: OpportunityRecordV1, label: string): void {
  assert.equal(typeof row.protocol, "string", `${label} protocol`);
  assert.ok(row.protocol.length > 0, `${label} protocol`);
  assert.ok(OPPORTUNITY_TYPES.has(row.opportunityType), `${label} opportunityType`);
  assert.equal(typeof row.opportunityId, "string", `${label} opportunityId`);
  assert.ok(row.opportunityId.length > 0, `${label} opportunityId`);
  assert.ok(row.chain === "algorand" || row.chain === "base", `${label} chain`);
  assert.equal(Number.isFinite(row.apy), true, `${label} apy`);
  assert.equal(Number.isFinite(row.tvlUsd), true, `${label} tvlUsd`);
  assert.ok(row.tvlUsd >= 0, `${label} tvlUsd`);
  assert.equal(typeof row.risk, "object", `${label} risk`);
  assert.notEqual(row.risk, null, `${label} risk`);
  assert.equal(typeof row.risk.confidence, "string", `${label} risk.confidence`);
  assert.equal(typeof row.executionReady, "boolean", `${label} executionReady`);
}

function duplicateIds(rows: readonly OpportunityRecordV1[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.opportunityId)) {
      duplicates.add(row.opportunityId);
      continue;
    }
    seen.add(row.opportunityId);
  }
  return [...duplicates];
}

function selectedReviewCases(): ReviewCase[] {
  const requested = process.env.CANIX_OPPORTUNITIES_REVIEW_FILES?.split(",")
    .map((file) => file.trim())
    .filter((file) => file.length > 0);
  if (requested === undefined || requested.length === 0) {
    return REVIEW_CASES;
  }
  const selected = REVIEW_CASES.filter((reviewCase) => requested.includes(reviewCase.file));
  const missing = requested.filter(
    (file) => !REVIEW_CASES.some((reviewCase) => reviewCase.file === file)
  );
  if (missing.length > 0) {
    throw new Error(`Unknown review files: ${missing.join(", ")}`);
  }
  return selected;
}

async function runLiveOpportunitiesReview(): Promise<void> {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const reviewCases = selectedReviewCases();
    const partial = reviewCases.length !== REVIEW_CASES.length;
    const app = buildApp();
    await app.ready();

    const index: ReviewIndexEntry[] = [];
    const findings: string[] = [];
    let listIds: string[] | undefined;

    try {
      for (const reviewCase of reviewCases) {
        const response = await app.inject({
          method: "GET",
          url: reviewCase.url
        });
        const body = response.json() as OpportunitiesBody;
        writeFileSync(
          path.join(REVIEW_DIR, reviewCase.file),
          `${JSON.stringify(body, null, 2)}\n`
        );
        index.push({
          file: reviewCase.file,
          url: reviewCase.url,
          status: response.statusCode,
          returnedCount: Array.isArray(body.data) ? body.data.length : 0,
          cacheEnabled: body.meta?.cacheEnabled ?? null,
          cacheHit: body.meta?.cacheHit ?? null
        });

        if (response.statusCode !== 200) {
          findings.push(`${reviewCase.file} status ${response.statusCode}`);
          continue;
        }
        if (!Array.isArray(body.data)) {
          findings.push(`${reviewCase.file} data is not an array`);
          continue;
        }
        if (body.meta?.limit !== REVIEW_LIMIT) {
          findings.push(`${reviewCase.file} meta.limit ${body.meta?.limit}`);
        }
        if (body.data.length > REVIEW_LIMIT) {
          findings.push(`${reviewCase.file} returned ${body.data.length} rows`);
        }
        if (body.meta?.cacheEnabled !== true) {
          findings.push(
            `${reviewCase.file} cache is off; production serves this route from Redis`
          );
        }

        for (const opportunityId of duplicateIds(body.data)) {
          findings.push(`duplicate ${opportunityId} in ${reviewCase.file}`);
        }

        for (const row of body.data) {
          try {
            assertRowQuality(row, `${reviewCase.file} ${row.opportunityId}`);
            reviewCase.assertRow?.(row);
          } catch (error) {
            findings.push(error instanceof Error ? error.message : String(error));
          }
        }

        if (reviewCase.file === "list.json") {
          if (body.data.length === 0) {
            findings.push("unfiltered list is empty");
          }
          listIds = body.data.map((row) => row.opportunityId);
        }

        if (reviewCase.file === "search-unfiltered.json") {
          if (listIds === undefined) {
            findings.push("list.json must be fetched before search-unfiltered.json");
          } else {
            const searchIds = body.data.map((row) => row.opportunityId);
            if (searchIds.join("\n") !== listIds.join("\n")) {
              findings.push(
                "search without filters did not return the same top 100 ids as GET /opportunities"
              );
            }
          }
        }
      }
    } finally {
      if (index.length > 0 && !partial) {
        const indexPath = path.join(REVIEW_DIR, "index.json");
        writeFileSync(
          indexPath,
          `${JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              productionPath: true,
              refresh: false,
              findings,
              cases: index
            },
            null,
            2
          )}\n`
        );
        console.log(`Opportunities review written to ${indexPath}`);
      } else if (index.length > 0) {
        console.log(
          index
            .map(
              (entry) =>
                `${entry.file} status ${entry.status} rows ${entry.returnedCount} cacheHit ${entry.cacheHit}`
            )
            .join("\n")
        );
      }
      if (findings.length > 0) {
        console.log(findings.map((finding) => `- ${finding}`).join("\n"));
      }
      await app.close();
    }

    if (findings.length > 0) {
      throw new Error(`${findings.length} production-path findings. See ${REVIEW_DIR}/index.json`);
    }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || process.env.NODE_TEST_CONTEXT !== undefined) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  runLiveOpportunitiesReview().then(
    () => {
      process.exit(0);
    },
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    }
  );
} else {
  test(
    "live opportunities top 100 with and without search filters",
    { timeout: 600_000 },
    async (t) => {
      if (process.env.CANIX_OPPORTUNITIES_LIVE !== "1") {
        t.skip(
          "Set CANIX_OPPORTUNITIES_LIVE=1 to fetch live opportunity responses for review."
        );
        return;
      }
      await runLiveOpportunitiesReview();
    }
  );
}
