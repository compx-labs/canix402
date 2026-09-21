/** CI and `NODE_ENV=test` must not hit live catalog adapters that have public defaults. */
export function isOfflineTestRuntime(): boolean {
  return process.env.CI === "true" || process.env.NODE_ENV === "test";
}

export function skipLiveCatalogInTests(overrides: unknown): boolean {
  return overrides === undefined && isOfflineTestRuntime();
}
