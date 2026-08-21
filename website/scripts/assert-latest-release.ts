import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemver, pickLatestReleaseNote } from "../src/lib/release-version";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "../..");
const notesDir = join(repoRoot, "docs/release-notes");
const protocolPackagePath = join(repoRoot, "protocol/package.json");

function parseFrontmatter(raw: string, id: string): { version: string; date: Date } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error(`${id}: missing YAML frontmatter`);
  }

  const versionMatch = match[1].match(/^version:\s*"?([^"\n]+)"?\s*$/m);
  const dateMatch = match[1].match(/^date:\s*"?([^"\n]+)"?\s*$/m);
  if (!versionMatch || !dateMatch) {
    throw new Error(`${id}: frontmatter must include version and date`);
  }

  const date = new Date(dateMatch[1].trim());
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${id}: invalid date ${dateMatch[1]}`);
  }

  return { version: versionMatch[1].trim(), date };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function runSortSanityChecks(): void {
  assert(compareSemver("1.4.0", "1.3.0") > 0, "1.4.0 should be greater than 1.3.0");
  assert(compareSemver("1.3.0", "1.2.0") > 0, "1.3.0 should be greater than 1.2.0");
  assert(compareSemver("1.4.0", "1.4.0") === 0, "equal versions should compare as 0");

  const latest = pickLatestReleaseNote([
    { id: "2026-08-16-plans", version: "1.3.0", date: new Date("2026-08-16") },
    { id: "2026-08-19-compiler-caveats", version: "1.2.0", date: new Date("2026-08-19") },
    { id: "2026-08-19-compose", version: "1.4.0", date: new Date("2026-08-19") },
    { id: "2026-08-20-protocol-1.4.0", version: "1.4.0", date: new Date("2026-08-20") }
  ]);

  assert(latest?.id === "2026-08-20-protocol-1.4.0", `expected 1.4.0 of 20 Aug, got ${latest?.id}`);
  assert(latest?.version === "1.4.0", `expected version 1.4.0, got ${latest?.version}`);
}

async function main(): Promise<void> {
  runSortSanityChecks();

  const protocolPkg = JSON.parse(await readFile(protocolPackagePath, "utf8")) as { version: string };
  const files = (await readdir(notesDir)).filter((name) => name.endsWith(".md"));
  const notes = await Promise.all(
    files.map(async (name) => {
      const raw = await readFile(join(notesDir, name), "utf8");
      return { id: name.replace(/\.md$/, ""), ...parseFrontmatter(raw, name) };
    })
  );

  const latest = pickLatestReleaseNote(notes);
  if (!latest) {
    throw new Error("No release notes found in docs/release-notes");
  }

  if (latest.version !== protocolPkg.version) {
    throw new Error(
      `Latest website release note is ${latest.version} (${latest.id}), but protocol/package.json is ${protocolPkg.version}`
    );
  }

  console.log(
    `Release notes OK: latest is protocol v${latest.version} (${latest.id}), matching protocol/package.json`
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
