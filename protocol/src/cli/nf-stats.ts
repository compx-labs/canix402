import { collectNfStatsDocument, uploadNfStatsDocument } from "../services/nf-stats.js";

const dryRun = process.argv.includes("--dry-run");

const document = await collectNfStatsDocument();
if (!document) {
  console.error("Opportunity count failed; not uploading");
  process.exit(1);
}

if (dryRun) {
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
  process.exit(0);
}

const uploaded = await uploadNfStatsDocument(document);
if (!uploaded.ok) {
  process.exit(1);
}
process.exit(0);
