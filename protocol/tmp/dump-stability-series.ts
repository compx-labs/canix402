import { mkdirSync, writeFileSync } from "node:fs";
import { loadOpportunityHistory } from "../src/services/opportunity-history.js";

const ids = [
  "2PIFZW53RHCSFSYMCFUBW4XOCXOMB7XOYQSQ6KGT3KVGJTL4HM6COZRNMM:lp",
  "VVBWRAJ3YSZGXBGJ2K654J3WA2VZOJW5U4SJCZWLM634H572WTGWTT53EE:lp",
  "VVBWRAJ3YSZGXBGJ2K654J3WA2VZOJW5U4SJCZWLM634H572WTGWTT53EE:farm",
  "UC4AUDFKY7KMFWABG2F47WAS32MBDIJ4HJ6RDCJHSZBOVVWGANCWWOGWGQ:farm",
  "UC4AUDFKY7KMFWABG2F47WAS32MBDIJ4HJ6RDCJHSZBOVVWGANCWWOGWGQ:lp",
  "folks-lending-971372237",
  "reti-staking-159"
];

async function main(): Promise<void> {
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const { points, stability } = await loadOpportunityHistory(id, "30d");
    out[id] = {
      stability,
      points: points.map((point) => ({
        ts: point.ts,
        apy: Number(point.apy.toFixed(4))
      }))
    };
    const mean =
      stability.apyMean === undefined ? "" : stability.apyMean.toFixed(4);
    const stdev =
      stability.apyStdev === undefined ? "" : stability.apyStdev.toFixed(4);
    console.log(
      [id.slice(0, 24), String(points.length), stability.bucket, mean, stdev].join(
        " | "
      )
    );
  }
  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/stability-series.json", JSON.stringify(out));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
