/**
 * Unit and API tests set `CANIX402_OFFLINE_CATALOG=1` so default-URL adapters
 * do not hit live GraphQL/SDK/HTTP. Gateway e2e and production keep live fetch.
 */
export function isOfflineTestRuntime(): boolean {
  return process.env.CANIX402_OFFLINE_CATALOG === "1";
}

export function skipLiveCatalogInTests(overrides: unknown): boolean {
  return overrides === undefined && isOfflineTestRuntime();
}
