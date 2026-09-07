import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAlgofiPositions,
  collectHumblePositions,
  collectStammPositions
} from "../../src/services/hogswap-lp-positions.js";
import {
  resetHogswapClientCacheForTests,
  setHogswapClientDependenciesForTests
} from "../../src/services/hogswap-client.js";
import { emptyWalletSnapshot, type WalletSnapshot } from "../../src/services/wallet-snapshot.js";
import {
  hogswapAlgofiLpValuation,
  hogswapHumbleLpValuation,
  hogswapNullSupplyLpValuation,
  hogswapPoolsPage1,
  hogswapPoolsPage2,
  hogswapStammLpValuation,
  hogswapStammPoolsFixture,
  HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID,
  HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID,
  HOGSWAP_FIXTURE_NULL_LP_ASSET_ID,
  HOGSWAP_FIXTURE_PACT_LP_ASSET_ID,
  HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID,
  HOGSWAP_FIXTURE_TINYMAN_LP_ASSET_ID
} from "../fixtures/hogswap/lp-valuation.js";

const ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";

test.afterEach(() => {
  setHogswapClientDependenciesForTests(undefined);
  resetHogswapClientCacheForTests();
});

test("empty wallet does not call HOGSWAP catalogs", async () => {
  let fetches = 0;
  setHogswapClientDependenciesForTests({
    fetch: async () => {
      fetches += 1;
      throw new Error("should not fetch");
    }
  });
  const result = await collectStammPositions(ADDRESS, emptyWalletSnapshot(ADDRESS));
  assert.deepEqual(result.positions, []);
  assert.equal(fetches, 0);
});

test("STAMM LP holdings are valued from recorded /lp/{id} without Tinyman/Pact double-count", async () => {
  const urls: string[] = [];
  installHogswapFixtureFetch(urls);
  const snapshot = walletSnapshot([
    { assetId: HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID, amount: 1_000_000n },
    { assetId: HOGSWAP_FIXTURE_TINYMAN_LP_ASSET_ID, amount: 9_000_000n },
    { assetId: HOGSWAP_FIXTURE_PACT_LP_ASSET_ID, amount: 8_000_000n },
    { assetId: 777, amount: 5n }
  ]);

  const stamm = await collectStammPositions(ADDRESS, snapshot);
  assert.equal(stamm.positions.length, 1);
  assert.equal(stamm.positions[0]?.protocol, "stamm");
  assert.equal(stamm.positions[0]?.assetId, HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID);
  assert.equal(stamm.positions[0]?.usdValue, 0.303238);
  assert.equal(stamm.positions[0]?.inputHints?.tierIndex, 1);
  assert.deepEqual(stamm.positions[0]?.assetIds, [0, 3178895177]);
  assert.equal(
    urls.some((url) => url.includes(`/lp/${HOGSWAP_FIXTURE_TINYMAN_LP_ASSET_ID}`)),
    false
  );
  assert.equal(
    urls.some((url) => url.includes(`/lp/${HOGSWAP_FIXTURE_PACT_LP_ASSET_ID}`)),
    false
  );
  assert.ok(urls.some((url) => url.includes(`/lp/${HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID}?amount=1000000`)));
});

test("AlgoFi and Humble LP holdings use the unified valuator", async () => {
  installHogswapFixtureFetch();
  const snapshot = walletSnapshot([
    { assetId: HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID, amount: 1_000_000n },
    { assetId: HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID, amount: 2_000_000n }
  ]);
  const [algofi, humble, stamm] = await Promise.all([
    collectAlgofiPositions(ADDRESS, snapshot),
    collectHumblePositions(ADDRESS, snapshot),
    collectStammPositions(ADDRESS, snapshot)
  ]);
  assert.equal(algofi.positions.length, 1);
  assert.equal(algofi.positions[0]?.protocol, "algofi");
  assert.equal(algofi.positions[0]?.usdValue, 1.058638);
  assert.equal(humble.positions.length, 1);
  assert.equal(humble.positions[0]?.protocol, "humble");
  assert.equal(humble.positions[0]?.amount, "2");
  assert.equal(stamm.positions.length, 0);
});

test("null HOGSWAP supply/price stays null rather than inventing USD", async () => {
  installHogswapFixtureFetch();
  const snapshot = walletSnapshot([
    { assetId: HOGSWAP_FIXTURE_NULL_LP_ASSET_ID, amount: 1_000_000n }
  ]);
  const stamm = await collectStammPositions(ADDRESS, snapshot);
  assert.equal(stamm.positions.length, 1);
  assert.equal(stamm.positions[0]?.usdValue, null);
  assert.equal(stamm.coverage?.suppliedUsdComplete, false);
  assert.match(stamm.warnings.join(" "), /null where supply or a reserve price/);
});

function walletSnapshot(
  assets: Array<{ assetId: number; amount: bigint }>
): WalletSnapshot {
  return {
    address: ADDRESS,
    amount: 0n,
    assets,
    appsLocalState: [],
    accountInfo: { address: ADDRESS, assets }
  };
}

function installHogswapFixtureFetch(urls: string[] = []): void {
  setHogswapClientDependenciesForTests({
    now: () => 1_000,
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/stamm/pools")) {
        return jsonResponse(hogswapStammPoolsFixture);
      }
      if (url.includes("/pools?") && url.includes("cursor=page2")) {
        return jsonResponse(hogswapPoolsPage2);
      }
      if (url.includes("/pools?")) {
        return jsonResponse(hogswapPoolsPage1);
      }
      if (url.includes(`/lp/${HOGSWAP_FIXTURE_STAMM_LP_ASSET_ID}`)) {
        return jsonResponse(hogswapStammLpValuation);
      }
      if (url.includes(`/lp/${HOGSWAP_FIXTURE_ALGOFI_LP_ASSET_ID}`)) {
        return jsonResponse(hogswapAlgofiLpValuation);
      }
      if (url.includes(`/lp/${HOGSWAP_FIXTURE_HUMBLE_LP_ASSET_ID}`)) {
        return jsonResponse(hogswapHumbleLpValuation);
      }
      if (url.includes(`/lp/${HOGSWAP_FIXTURE_NULL_LP_ASSET_ID}`)) {
        return jsonResponse(hogswapNullSupplyLpValuation);
      }
      return new Response("not found", { status: 404 });
    }
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
