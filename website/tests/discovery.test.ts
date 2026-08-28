import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { catalogEndpoints } from "../src/lib/catalog-endpoints.ts";

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("endpoint catalog hides root, favicon, and other static assets", () => {
  const snapshot = JSON.parse(
    readFileSync(resolve(websiteRoot, "src/data/discovery.snapshot.json"), "utf-8")
  ) as { data: { endpoints: Array<{ id: string; path: string }> } };
  const visible = catalogEndpoints(snapshot.data.endpoints);
  const paths = visible.map((endpoint) => endpoint.path);
  assert.equal(paths.includes("/"), false);
  assert.equal(paths.includes("/favicon.ico"), false);
  assert.equal(paths.includes("/favicon.png"), false);
  assert.equal(paths.includes("/logo.png"), false);
  assert.equal(paths.includes("/banner.png"), false);
  assert.ok(paths.includes("/opportunities"));
  assert.ok(paths.includes("/discovery"));
  assert.ok(paths.includes("/health"));
});
