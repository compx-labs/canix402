import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { WEBMCP_TOOL_NAMES, getWebMcpTool } from "../src/lib/webmcp/catalog.ts";
import {
  extractOpportunities,
  formatApy,
  formatTvl,
  mergeEligibility
} from "../src/lib/webmcp/opportunities.ts";
import { fieldsForSchema } from "../src/lib/webmcp/tool-forms.ts";
import { WEBMCP_TOOL_GROUPS } from "../src/lib/webmcp/tool-groups.ts";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const sampleOpportunity = {
  protocol: "tinyman",
  opportunityType: "lp",
  opportunityId: "tinyman:pool:1002541853",
  assetPair: "ALGO/USDC",
  apy: 12.5,
  yieldBasis: "apy",
  tvlUsd: 2_450_000.5,
  executionReady: true
};

test("webmcp page is an empty opportunities table with a tools drawer", () => {
  const source = readFileSync(resolve(websiteRoot, "src/pages/webmcp.astro"), "utf-8");
  assert.match(source, /data-opportunities-table/);
  assert.match(source, /data-opportunities-empty/);
  assert.match(source, /No opportunities loaded/);
  assert.match(source, /data-list-top-opportunities/);
  assert.match(source, /Get top 25/);
  assert.match(source, /data-webmcp-tools-drawer/);
  assert.match(source, /data-open-tools/);
  assert.equal(source.includes("Registered tools"), false);
  assert.equal(source.includes("webmcp-status-strip"), false);
  assert.equal(source.includes("data-webmcp-api"), false);
  assert.equal(source.includes("data-list-opportunities-form"), false);
  assert.equal(source.includes("Buy session (USDC)"), false);
  assert.equal(source.includes("Apply mocked session"), false);
  assert.equal(source.includes("Read remaining"), false);
  assert.equal(source.includes("data-opportunities-caption"), false);
  assert.equal(source.includes("Get top 25 to fill the table"), false);
  assert.equal(source.includes("Paid calls need a prepaid session"), false);
});

test("tool groups cover the WebMCP catalog once", () => {
  const names = WEBMCP_TOOL_GROUPS.flatMap((group) => [...group.names]);
  assert.deepEqual([...names].sort(), [...WEBMCP_TOOL_NAMES].sort());
});

test("extractOpportunities reads list payloads and ignores errors", () => {
  assert.equal(extractOpportunities({ error: "SESSION_REQUIRED" }), null);
  assert.equal(extractOpportunities({ data: { allocations: [] } }), null);
  assert.deepEqual(extractOpportunities({ data: [] }), []);
  const rows = extractOpportunities({
    data: [{ ...sampleOpportunity, canEnter: true }],
    mcpPayment: { required: false }
  });
  assert.equal(rows?.length, 1);
  assert.equal(rows?.[0]?.opportunityId, "tinyman:pool:1002541853");
  assert.equal(rows?.[0]?.canEnter, true);
  assert.equal(formatApy(rows?.[0]?.apy ?? null, "apy"), "12.50%");
  assert.equal(formatTvl(rows?.[0]?.tvlUsd ?? null), "$2.45M");
});

test("extractOpportunities does not treat positions as table rows", () => {
  assert.equal(
    extractOpportunities({
      data: [
        {
          protocol: "tinyman",
          positionType: "lp",
          positionId: "tinyman:lp:1002541853",
          opportunityId: "tinyman:pool:1002541853"
        }
      ]
    }),
    null
  );
});

test("mergeEligibility updates matching table rows", () => {
  const rows = extractOpportunities({ data: [sampleOpportunity] }) ?? [];
  const merged = mergeEligibility(rows, {
    data: [{ opportunityId: "tinyman:pool:1002541853", canEnter: false }]
  });
  assert.equal(merged?.[0]?.canEnter, false);
  assert.equal(mergeEligibility(rows, { error: "SESSION_REQUIRED" }), null);
});

test("opportunity tool forms skip payment fields and flatten budget", () => {
  const list = getWebMcpTool("canix_list_opportunities");
  const search = getWebMcpTool("canix_search_opportunities");
  const plan = getWebMcpTool("canix_get_plan");
  assert.ok(list && search && plan);
  const listFields = fieldsForSchema(list.inputSchema).map((field) => field.name);
  const searchFields = fieldsForSchema(search.inputSchema).map((field) => field.name);
  const planFields = fieldsForSchema(plan.inputSchema).map((field) => field.name);
  assert.equal(listFields.includes("paymentSignature"), false);
  assert.equal(listFields.includes("sessionReceipt"), false);
  assert.ok(searchFields.includes("minApy"));
  assert.ok(searchFields.includes("assetIds"));
  assert.ok(planFields.includes("budget.assetId"));
  assert.ok(planFields.includes("budget.amount"));
  assert.equal(planFields.includes("budget"), false);
});
