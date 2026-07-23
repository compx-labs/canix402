/** Canonical public API origin used when env overrides are unset. */
export const DEFAULT_PUBLIC_BASE_URL = "https://canix402-api.compx.io";

export function resolvePublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    env.X402_PUBLIC_BASE_URL?.trim() ||
    env.PUBLIC_GATEWAY_BASE_URL?.trim() ||
    DEFAULT_PUBLIC_BASE_URL
  ).replace(/\/+$/, "");
}
