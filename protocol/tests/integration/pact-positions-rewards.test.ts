import assert from "node:assert/strict";
import test from "node:test";

import { setAssetDecimalsDependenciesForTests } from "../../src/services/asset-decimals.js";
import {
  collectPactPositions,
  setPactPositionCollectorDependenciesForTests
} from "../../src/services/protocol-positions.js";
import {
  emptyWalletSnapshot,
  type WalletSnapshot
} from "../../src/services/wallet-snapshot.js";

const ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const FARM_APP_ID = 800;
const POOL_APP_ID = 700;
const LP_ASSET_ID = 456;
const REWARD_ASSET_ID = 31_566_704;
const UNKNOWN_REWARD_ASSET_ID = 99_999_999;

test.afterEach(() => {
  setPactPositionCollectorDependenciesForTests(undefined);
  setAssetDecimalsDependenciesForTests(undefined);
});

test("Pact farm rewards are USD-priced when CompX/Tinyman price map has the ASA", async () => {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
  setPactPositionCollectorDependenciesForTests({
    fetchFarm: async () => mockPactFarm({ rewardAssetId: REWARD_ASSET_ID }),
    fetchRewardUsdPrices: async () => ({
      [String(REWARD_ASSET_ID)]: 1
    })
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockPactCatalogFetch();

  try {
    const result = await collectPactPositions(
      ADDRESS,
      farmWalletSnapshot()
    );

    const reward = result.positions.find(
      (position) => position.positionType === "reward"
    );
    const staked = result.positions.find(
      (position) => position.positionType === "staked"
    );
    assert.ok(staked);
    assert.ok(reward);
    assert.equal(
      reward.positionId,
      `pact:reward:${FARM_APP_ID}:${REWARD_ASSET_ID}`
    );
    assert.equal(reward.amountRaw, "2500000");
    assert.equal(reward.amount, "2.5");
    assert.equal(reward.usdValue, 2.5);
    assert.equal(result.coverage?.rewardsUsdComplete, true);
    assert.equal(
      result.warnings.includes("Pact farm reward USD pricing is unavailable."),
      false
    );
    assert.deepEqual(reward.caveats, ["Unclaimed Pact farm reward."]);
    assert.deepEqual(reward.inputHints, {
      farmAppId: FARM_APP_ID,
      assetId: REWARD_ASSET_ID
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Pact farm rewards mark partial only when a reward ASA has no usable price", async () => {
  setAssetDecimalsDependenciesForTests({
    createAlgodClient: () => ({}) as never,
    getAssetById: async () => ({ params: { decimals: 6 } })
  });
  setPactPositionCollectorDependenciesForTests({
    fetchFarm: async () =>
      mockPactFarm({ rewardAssetId: UNKNOWN_REWARD_ASSET_ID }),
    fetchRewardUsdPrices: async () => ({})
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockPactCatalogFetch();

  try {
    const result = await collectPactPositions(
      ADDRESS,
      farmWalletSnapshot()
    );

    const reward = result.positions.find(
      (position) => position.positionType === "reward"
    );
    assert.ok(reward);
    assert.equal(reward.usdValue, null);
    assert.equal(result.coverage?.rewardsUsdComplete, false);
    assert.equal(
      result.warnings.includes("Pact farm reward USD pricing is unavailable."),
      true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function mockPactCatalogFetch(): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes("/pools/all")) {
      return new Response(
        JSON.stringify([
          {
            on_chain_id: String(POOL_APP_ID),
            primary_asset: { on_chain_id: "0", unit_name: "ALGO" },
            secondary_asset: {
              on_chain_id: "31566704",
              unit_name: "USDC"
            },
            pool_asset: {
              on_chain_id: String(LP_ASSET_ID),
              unit_name: "PLP",
              decimals: 6,
              price: "1.25"
            }
          }
        ]),
        { status: 200 }
      );
    }
    if (url.includes("/farms/all")) {
      return new Response(
        JSON.stringify([
          {
            on_chain_id: String(FARM_APP_ID),
            pool: String(POOL_APP_ID)
          }
        ]),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify([]), { status: 200 });
  };
}

function mockPactFarm(options: { rewardAssetId: number }) {
  const updatedAt = new Date("2026-07-01T00:00:00.000Z");
  return {
    getUserStateFromAccountInfo: () => ({ staked: 1_000_000 }),
    estimateAccruedRewards: () => ({
      [options.rewardAssetId]: 2_500_000
    }),
    state: {
      stakedAsset: { index: LP_ASSET_ID },
      rewardAssets: [
        {
          index: options.rewardAssetId,
          unitName: options.rewardAssetId === REWARD_ASSET_ID ? "USDC" : "RWD"
        }
      ],
      updatedAt
    }
  };
}

function farmWalletSnapshot(): WalletSnapshot {
  return {
    ...emptyWalletSnapshot(ADDRESS),
    assets: [{ assetId: LP_ASSET_ID, amount: 0n }],
    appsLocalState: [{ id: FARM_APP_ID, keyValue: [] }],
    accountInfo: {
      address: ADDRESS,
      amount: 0n,
      assets: [],
      "apps-local-state": [
        {
          id: FARM_APP_ID,
          "key-value": []
        }
      ]
    }
  };
}
