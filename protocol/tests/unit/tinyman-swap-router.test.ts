import assert from "node:assert/strict";
import test from "node:test";

import {
  hopCountFromRouter,
  selectTinymanSwapWinner,
  type TinymanSwapCandidate
} from "../../src/execution/shapes/tinyman/swap-compare.js";
import {
  ONE_HOP_ROUTER_FEE,
  ONE_HOP_ROUTER_MIN_OUT,
  ONE_HOP_ROUTER_OUTPUT,
  POOL_ALGO_USDC,
  POOL_COMPX_ALGO,
  TWO_HOP_DIRECT_OUTPUT,
  TWO_HOP_ROUTER_FEE,
  TWO_HOP_ROUTER_MIN_OUT,
  TWO_HOP_ROUTER_OUTPUT,
  oneHopRouterResponse,
  twoHopRouterResponse
} from "../fixtures/tinyman/swap-router.js";

function candidate(
  path: TinymanSwapCandidate["path"],
  overrides: Partial<TinymanSwapCandidate> = {}
): TinymanSwapCandidate {
  return {
    path,
    hopCount: path === "router" ? 2 : 1,
    expectedIn: 1_000_000n,
    expectedOut: path === "router" ? TWO_HOP_ROUTER_OUTPUT : TWO_HOP_DIRECT_OUTPUT,
    minOut: path === "router" ? TWO_HOP_ROUTER_MIN_OUT : 198_000n,
    maxIn: 1_000_000n,
    networkFeeMicroAlgos: path === "router" ? TWO_HOP_ROUTER_FEE : 3_000n,
    ...overrides
  };
}

test("hopCountFromRouter counts unique pools on a 2-hop COMPX→ALGO→USDC route", () => {
  const hops = hopCountFromRouter(twoHopRouterResponse());
  assert.equal(hops, 2);
  assert.ok(
    twoHopRouterResponse().pool_mapping.flat().includes(POOL_COMPX_ALGO)
  );
  assert.ok(
    twoHopRouterResponse().pool_mapping.flat().includes(POOL_ALGO_USDC)
  );
});

test("hopCountFromRouter counts a 1-hop ALGO→USDC router suggestion as one pool", () => {
  const hops = hopCountFromRouter(oneHopRouterResponse());
  assert.equal(hops, 1);
  assert.deepEqual(oneHopRouterResponse().pool_mapping, [[POOL_ALGO_USDC]]);
});

test("fixed-input selects the Swap Router when 2-hop net out beats the single pool", () => {
  const selection = selectTinymanSwapWinner(
    "fixed-input",
    candidate("router"),
    candidate("direct")
  );
  assert.equal(selection.winner, "router");
  assert.equal(selection.fallbackReason, undefined);
  assert.ok(TWO_HOP_ROUTER_OUTPUT > TWO_HOP_DIRECT_OUTPUT);
});

test("fixed-input falls back to the single pool when it returns more than the router", () => {
  const selection = selectTinymanSwapWinner(
    "fixed-input",
    candidate("router", {
      expectedOut: 990_000n,
      minOut: 980_000n,
      hopCount: 1,
      networkFeeMicroAlgos: ONE_HOP_ROUTER_FEE
    }),
    candidate("direct", {
      expectedOut: ONE_HOP_ROUTER_OUTPUT,
      minOut: ONE_HOP_ROUTER_MIN_OUT,
      hopCount: 1
    })
  );
  assert.equal(selection.winner, "direct");
  assert.equal(selection.fallbackReason, "single-pool-better");
});

test("fixed-input prefers the single pool on a net-return tie", () => {
  const selection = selectTinymanSwapWinner(
    "fixed-input",
    candidate("router", {
      expectedOut: 1_000_000n,
      minOut: 995_000n,
      networkFeeMicroAlgos: 3_000n,
      hopCount: 1
    }),
    candidate("direct", {
      expectedOut: 1_000_000n,
      minOut: 995_000n,
      networkFeeMicroAlgos: 3_000n
    })
  );
  assert.equal(selection.winner, "direct");
  assert.equal(selection.fallbackReason, "tied-prefer-single-pool");
});

test("fixed-output selects the router when it needs less input", () => {
  const selection = selectTinymanSwapWinner(
    "fixed-output",
    candidate("router", { expectedIn: 900_000n, maxIn: 910_000n, expectedOut: 250_000n }),
    candidate("direct", { expectedIn: 1_000_000n, maxIn: 1_010_000n, expectedOut: 250_000n })
  );
  assert.equal(selection.winner, "router");
  assert.equal(selection.fallbackReason, undefined);
});

test("missing router path documents router-unavailable fallback", () => {
  const selection = selectTinymanSwapWinner("fixed-input", undefined, candidate("direct"));
  assert.equal(selection.winner, "direct");
  assert.equal(selection.fallbackReason, "router-unavailable");
});

test("missing single-pool path documents no-single-pool and keeps the router", () => {
  const selection = selectTinymanSwapWinner("fixed-input", candidate("router"), undefined);
  assert.equal(selection.winner, "router");
  assert.equal(selection.fallbackReason, "no-single-pool");
});

test("hopCountFromRouter falls back to unique swap-app accounts when pool_mapping is empty", () => {
  const hops = hopCountFromRouter({
    pool_mapping: [],
    transactions: [
      { type: "axfer", accounts: [] },
      { type: "appl", accounts: [POOL_COMPX_ALGO, POOL_ALGO_USDC] }
    ]
  });
  assert.equal(hops, 2);
});
