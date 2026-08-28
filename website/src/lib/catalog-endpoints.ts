const HIDDEN_CATALOG_PATHS = new Set([
  "/",
  "/favicon.ico",
  "/favicon.png",
  "/logo.png",
  "/banner.png",
  "/robots.txt",
  "/llms.txt",
  "/llms-full.txt"
]);

const HIDDEN_CATALOG_IDS = new Set(["root", "faviconIco", "faviconPng", "logoPng", "bannerPng"]);

/** Drop branding and static-asset routes from the human endpoint catalog. */
export function catalogEndpoints<T extends { id: string; path: string }>(endpoints: T[]): T[] {
  return endpoints.filter((endpoint) => {
    const path = endpoint.path.split("?")[0] ?? endpoint.path;
    if (HIDDEN_CATALOG_IDS.has(endpoint.id) || HIDDEN_CATALOG_PATHS.has(path)) {
      return false;
    }
    return !/\.(ico|png|svg|jpe?g|gif|webp)$/i.test(path);
  });
}
