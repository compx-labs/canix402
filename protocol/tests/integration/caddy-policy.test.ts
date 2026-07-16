import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const caddyfile = readFileSync(resolve(process.cwd(), "caddy/Caddyfile"), "utf-8");

test("Caddy keeps free POST routes outside x402 enforcement", () => {
  const freeMatcher = caddyfile.match(/@free path ([^\n]+)/)?.[1] ?? "";

  assert.match(freeMatcher, /(?:^|\s)\/llms\.txt(?:\s|$)/);
  assert.match(freeMatcher, /(?:^|\s)\/robots\.txt(?:\s|$)/);
  assert.match(freeMatcher, /(?:^|\s)\/\.well-known\/agent-card\.json(?:\s|$)/);
  assert.match(freeMatcher, /(?:^|\s)\/\.well-known\/ai-plugin\.json(?:\s|$)/);
  assert.match(freeMatcher, /(?:^|\s)\/swaps\/quote(?:\s|$)/);
  assert.match(freeMatcher, /(?:^|\s)\/swaps\/optin(?:\s|$)/);
  assert.match(freeMatcher, /(?:^|\s)\/pricing(?:\s|$)/);
  assert.doesNotMatch(freeMatcher, /(?:^|\s)\/swaps\/transactions(?:\s|$)/);
});

test("Caddy gives Haystack transaction generation a dedicated paid policy", () => {
  assert.match(
    caddyfile,
    /@paid_haystack_swap path \/swaps\/transactions/
  );
  assert.match(
    caddyfile,
    /handle @paid_haystack_swap \{[\s\S]*?price \{\$X402_PRICE_HAYSTACK_SWAP_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
});
