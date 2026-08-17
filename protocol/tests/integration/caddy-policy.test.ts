import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const caddyfile = readFileSync(resolve(process.cwd(), "caddy/Caddyfile"), "utf-8");

test("Caddy keeps free POST routes outside x402 enforcement", () => {
  assert.match(caddyfile, /@free_post \{[\s\S]*?path \/swaps\/quote \/swaps\/optin \/pricing/);
  assert.match(caddyfile, /@free \{[\s\S]*?path [^\n]*\/execution\/shapes/);
  assert.match(caddyfile, /@free \{[\s\S]*?path [^\n]*\/ready/);
  assert.match(
    caddyfile,
    /@free \{[\s\S]*?path [^\n]*\/public\/agents\/brownie\/positions/
  );
  assert.doesNotMatch(caddyfile, /@free \{[\s\S]*?path [^\n]*\/metrics/);
  assert.doesNotMatch(caddyfile, /@paid_strategy_/);
  assert.doesNotMatch(caddyfile, /\$X402_PRICE_STRATEGY_/);
  assert.doesNotMatch(caddyfile, /\/strategies/);
});

test("Caddy gives eligibility a dedicated paid policy", () => {
  assert.match(caddyfile, /@paid_eligibility path \/eligibility/);
  assert.match(
    caddyfile,
    /handle @paid_eligibility \{[\s\S]*?price \{\$X402_PRICE_ELIGIBILITY_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
});

test("Caddy gives plans a dedicated compiler paid policy", () => {
  assert.match(caddyfile, /@paid_plans path \/plans/);
  assert.match(
    caddyfile,
    /handle @paid_plans \{[\s\S]*?price \{\$X402_PRICE_PLANS_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
});

test("Caddy gives claimable positions a dedicated paid policy", () => {
  assert.match(
    caddyfile,
    /@paid_positions_claimable path \/positions\/claimable/
  );
  assert.match(
    caddyfile,
    /handle @paid_positions_claimable \{[\s\S]*?price \{\$X402_PRICE_POSITIONS_CLAIMABLE_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
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
