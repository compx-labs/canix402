import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const protocolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tsxCli = path.resolve(protocolRoot, "../node_modules/tsx/dist/cli.mjs");
const aggregateModule = path.join(
  protocolRoot,
  "src/services/aggregate-opportunities.ts"
);

test("opportunity aggregation survives an SDK rejection with no reason", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "canix-opportunities-"));
  const childFile = path.join(dir, "child.mts");
  writeFileSync(
    childFile,
    `import { containingUnhandledRejections } from ${JSON.stringify(aggregateModule)};
const result = await containingUnhandledRejections(async () => {
  void Promise.reject(undefined);
  return "kept-row";
});
if (result !== "kept-row") {
  process.exit(2);
}
`
  );

  const { code, stdout, stderr } = await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, childFile], {
      cwd: protocolRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        code: exitCode,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8")
      });
    });
  });

  assert.equal(
    code,
    0,
    `containment child exited ${code}\n${stdout}\n${stderr}`
  );
  assert.match(stdout + stderr, /Contained an unhandled rejection/);
});
