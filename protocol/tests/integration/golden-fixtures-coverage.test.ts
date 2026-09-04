import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createExecutionRegistry } from "../../src/execution/index.js";

const INTEGRATION_DIR = path.dirname(fileURLToPath(import.meta.url));

test("every registered shape key has a mock-SDK deterministic group fixture", async () => {
  const files = (await readdir(INTEGRATION_DIR)).filter(
    (name) =>
      name.endsWith(".test.ts") &&
      name.includes("shape") &&
      name !== "golden-fixtures-coverage.test.ts" &&
      name !== "opportunity-execution-shapes.test.ts" &&
      name !== "execution-shapes-catalog.test.ts"
  );
  const sources = await Promise.all(
    files.map((name) => readFile(path.join(INTEGRATION_DIR, name), "utf8"))
  );
  const blob = sources.join("\n");
  const missing = createExecutionRegistry()
    .keys()
    .filter((shapeKey) => !blob.includes(shapeKey));

  assert.deepEqual(
    missing,
    [],
    `Missing deterministic group fixtures for: ${missing.join(", ")}`
  );
});
