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

test("Caddy gives plans rebalance a dedicated compiler paid policy", () => {
  assert.match(caddyfile, /@paid_plans_rebalance path \/plans\/rebalance/);
  assert.match(
    caddyfile,
    /handle @paid_plans_rebalance \{[\s\S]*?price \{\$X402_PRICE_PLANS_REBALANCE_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
});

test("Caddy gives policy validate a dedicated compiler paid policy", () => {
  assert.match(caddyfile, /@paid_policy_validate path \/policy\/validate/);
  assert.match(
    caddyfile,
    /handle @paid_policy_validate \{[\s\S]*?price \{\$X402_PRICE_POLICY_VALIDATE_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
});

test("Caddy gives execution compose a dedicated compiler paid policy", () => {
  assert.match(caddyfile, /@paid_execution_compose path \/execution\/compose/);
  assert.match(
    caddyfile,
    /handle @paid_execution_compose \{[\s\S]*?price \{\$X402_PRICE_EXECUTION_COMPOSE_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
});

test("Caddy gives execution simulate a dedicated compiler paid policy", () => {
  assert.match(caddyfile, /@paid_execution_simulate path \/execution\/simulate/);
  assert.match(
    caddyfile,
    /handle @paid_execution_simulate \{[\s\S]*?price \{\$X402_PRICE_EXECUTION_SIMULATE_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
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

test("Caddy gives opportunity history a dedicated research paid policy", () => {
  assert.match(caddyfile, /@paid_history path \/opportunities\/\*\/history/);
  assert.match(
    caddyfile,
    /handle @paid_history \{[\s\S]*?price \{\$X402_PRICE_HISTORY_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
  const historyIndex = caddyfile.indexOf("@paid_history path /opportunities/*/history");
  const aggregateIndex = caddyfile.indexOf("@paid_aggregate path /opportunities");
  assert.ok(historyIndex >= 0 && aggregateIndex > historyIndex);
});

test("Caddy skips x402 when X-Canix-Session is present on session-eligible routes", () => {
  assert.match(caddyfile, /@session \{[\s\S]*?header X-Canix-Session csess_\*/);
  assert.match(
    caddyfile,
    /Access-Control-Expose-Headers "PAYMENT-REQUIRED, PAYMENT-RESPONSE, x-canix-session-remaining-research, x-canix-session-remaining-quotes, x-canix-session-expires-at"/
  );
  assert.match(
    caddyfile,
    /@session \{[\s\S]*?path \/opportunities \/opportunities\/search \/opportunities\/personalized \/opportunities\/\*\/history \/eligibility \/plans \/plans\/rebalance \/policy\/validate \/positions \/positions\/claimable \/protocols\/\*\/opportunities \/swaps\/transactions \/execution\/quotes \/execution\/compose \/execution\/simulate/
  );
  assert.match(caddyfile, /handle @session \{[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}/);
  const sessionMatcher = caddyfile.match(/@session \{[\s\S]*?\n\t\}/);
  assert.ok(sessionMatcher?.[0], "expected @session matcher block");
  assert.doesNotMatch(sessionMatcher[0], /\/sessions/);
});

test("Caddy gives session create and refresh dedicated paid policies", () => {
  assert.match(caddyfile, /@paid_sessions_refresh path \/sessions\/refresh/);
  assert.match(
    caddyfile,
    /handle @paid_sessions_refresh \{[\s\S]*?price \{\$X402_PRICE_SESSIONS_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
  assert.match(caddyfile, /@paid_sessions path \/sessions/);
  assert.match(
    caddyfile,
    /handle @paid_sessions \{[\s\S]*?price \{\$X402_PRICE_SESSIONS_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
  assert.match(caddyfile, /@free \{[\s\S]*?path [^\n]*\/sessions\/\*/);
});

test("Caddy gives watch create and refresh dedicated paid policies", () => {
  assert.match(caddyfile, /@paid_watch_refresh path \/watch\/refresh/);
  assert.match(
    caddyfile,
    /handle @paid_watch_refresh \{[\s\S]*?price \{\$X402_PRICE_WATCH_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
  assert.match(caddyfile, /@paid_watch path \/watch/);
  assert.match(
    caddyfile,
    /handle @paid_watch \{[\s\S]*?price \{\$X402_PRICE_WATCH_USDC\}[\s\S]*?reverse_proxy \{\$UPSTREAM_API\}[\s\S]*?\}/
  );
  assert.match(caddyfile, /@free \{[\s\S]*?path [^\n]*\/watch\/\*/);
  assert.match(caddyfile, /@free_post \{[\s\S]*?path [^\n]*\/watch\/\*\/rotate-secret/);
});

