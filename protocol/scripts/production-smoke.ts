import {
  productionFreeEndpoints,
  productionPaidEndpoints
} from "../tests/helpers/productionEndpoints.js";
import {
  assertFreeEndpoint,
  assertPaidPreflight,
  getProductionBaseUrl,
  loadLiveEnvFiles
} from "../tests/helpers/x402LiveClient.js";

loadLiveEnvFiles();

async function main(): Promise<void> {
  const baseUrl = getProductionBaseUrl();

  for (const endpoint of productionFreeEndpoints) {
    await assertFreeEndpoint(baseUrl, endpoint.path);
  }

  for (const endpoint of productionPaidEndpoints) {
    await assertPaidPreflight(baseUrl, endpoint.path, {
      method: endpoint.method,
      body: endpoint.body
    });
  }

  console.log(
    `Production smoke checks passed for ${productionFreeEndpoints.length} free and ${productionPaidEndpoints.length} paid endpoints.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
