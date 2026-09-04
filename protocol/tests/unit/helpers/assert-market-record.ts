import assert from "node:assert/strict";

import { FormatRegistry } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type {
  OpportunityMarketRecord,
  OpportunityRecordV1
} from "../../../src/types/opportunity.js";
import {
  OpportunityMarketRecordSchema,
  OpportunityRecordSchema
} from "../../../src/types/opportunity-schema.js";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => ISO_DATE_TIME.test(value));
}

function formatErrors(errors: Iterable<{ path: string; message: string }>): string {
  return [...errors]
    .map((error) => `${error.path || "/"}: ${error.message}`)
    .join("; ");
}

export function assertValidMarketRecord(
  record: OpportunityMarketRecord | null,
  message?: string
): asserts record is OpportunityMarketRecord {
  assert.ok(record, message ?? "expected a normalized opportunity market record");
  const errors = [...Value.Errors(OpportunityMarketRecordSchema, record)];
  assert.equal(errors.length, 0, formatErrors(errors));
  assert.equal(typeof record.apy, "number");
  assert.ok(Number.isFinite(record.apy));
  assert.equal(typeof record.tvlUsd, "number");
  assert.ok(Number.isFinite(record.tvlUsd));
}

export function assertValidPublicOpportunity(
  record: OpportunityRecordV1
): void {
  const errors = [...Value.Errors(OpportunityRecordSchema, record)];
  assert.equal(errors.length, 0, formatErrors(errors));
  assert.equal(typeof record.executionReady, "boolean");
  assert.ok(Array.isArray(record.executionShapes));
  assert.ok(Array.isArray(record.compatibleExitShapes));
  assert.equal("poolAppId" in record, false);
  assert.ok(record.risk);
  assert.ok(
    record.risk.confidence === "high" ||
      record.risk.confidence === "medium" ||
      record.risk.confidence === "low" ||
      record.risk.confidence === "unknown"
  );
}
