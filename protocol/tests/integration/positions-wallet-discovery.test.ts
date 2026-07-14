import assert from "node:assert/strict";
import test from "node:test";
import type { Indexer } from "algosdk";

import {
  collectPactPositions,
  collectTinymanPositions
} from "../../src/services/protocol-positions.js";
import {
  emptyWalletSnapshot,
  fetchWalletSnapshot,
  type WalletSnapshot
} from "../../src/services/wallet-snapshot.js";

const ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";

test("wallet snapshot uses one indexer lookup and normalizes wallet state", async () => {
  let lookups = 0;
  const request = {
    includeAll: () => request,
    do: async () => ({
      account: {
        amount: 2_000_000n,
        assets: [
          { assetId: 10, amount: 25n },
          { assetId: 11, amount: 0n }
        ],
        appsLocalState: [
          {
            id: 99,
            keyValue: [
              {
                key: new TextEncoder().encode("Staked"),
                value: { bytes: new Uint8Array(), type: 2, uint: 7n }
              }
            ]
          }
        ]
      }
    })
  };
  const indexer = {
    lookupAccountByID: () => {
      lookups += 1;
      return request;
    }
  } as unknown as Indexer;

  const snapshot = await fetchWalletSnapshot(ADDRESS, indexer);

  assert.equal(lookups, 1);
  assert.equal(snapshot.amount, 2_000_000n);
  assert.deepEqual(snapshot.assets, [
    { assetId: 10, amount: 25n },
    { assetId: 11, amount: 0n }
  ]);
  assert.equal(snapshot.appsLocalState[0]?.id, 99);
  const legacyLocalState = snapshot.accountInfo["apps-local-state"] as Array<{
    "key-value": Array<{
      key: string;
      value: { uint: number };
    }>;
  }>;
  assert.equal(legacyLocalState[0]?.["key-value"][0]?.key, "U3Rha2Vk");
  assert.equal(legacyLocalState[0]?.["key-value"][0]?.value.uint, 7);
});

test("Tinyman starts from held asset ids and returns only matching LP tokens", async () => {
  const snapshot = walletSnapshot([
    { assetId: 123, amount: 50_000_000n },
    { assetId: 999, amount: 7n }
  ]);
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({
        results: [
          {
            address: "TINymanPool",
            is_verified: true,
            asset_1: { id: "0", unit_name: "ALGO" },
            asset_2: { id: "31566704", unit_name: "USDC" },
            liquidity_asset: { id: "123", decimals: 6 },
            current_issued_liquidity_assets: "1000000000",
            liquidity_in_usd: "2000"
          }
        ]
      }),
      { status: 200 }
    );
  };

  try {
    const result = await collectTinymanPositions(ADDRESS, snapshot);
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /liquidity_asset_ids=123%2C999/);
    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0]?.assetId, 123);
    assert.equal(result.positions[0]?.amountRaw, "50000000");
    assert.equal(result.positions[0]?.usdValue, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pact maps held LP tokens from its catalog without per-pool RPC calls", async () => {
  const snapshot = walletSnapshot([{ assetId: 456, amount: 2_000_000n }]);
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/pools/all")) {
      return new Response(
        JSON.stringify([
          {
            on_chain_id: "700",
            primary_asset: { on_chain_id: "0", unit_name: "ALGO" },
            secondary_asset: {
              on_chain_id: "31566704",
              unit_name: "USDC"
            },
            pool_asset: {
              on_chain_id: "456",
              unit_name: "PLP",
              decimals: 6,
              price: "1.25"
            }
          }
        ]),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };

  try {
    const result = await collectPactPositions(ADDRESS, snapshot);
    assert.equal(urls.length, 2);
    assert.match(urls[0]!, /\/pools\/all/);
    assert.match(urls[1]!, /\/farms\/all/);
    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0]?.positionId, "pact:lp:456");
    assert.equal(result.positions[0]?.usdValue, 2.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function walletSnapshot(
  assets: WalletSnapshot["assets"]
): WalletSnapshot {
  return {
    ...emptyWalletSnapshot(ADDRESS),
    assets,
    accountInfo: {
      address: ADDRESS,
      amount: 0n,
      assets: assets.map((holding) => ({
        "asset-id": holding.assetId,
        amount: holding.amount
      })),
      "apps-local-state": []
    }
  };
}
