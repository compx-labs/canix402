import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildApp } from "../src/app.js";

async function main(): Promise<void> {
  const app = buildApp();
  await app.ready();

  const response = await app.inject({
    method: "GET",
    url: "/discovery"
  });

  const outputPath = resolve(
    process.cwd(),
    "../website/src/data/discovery.snapshot.json"
  );
  writeFileSync(outputPath, `${JSON.stringify(response.json(), null, 2)}\n`, "utf-8");
  await app.close();
}

await main();
