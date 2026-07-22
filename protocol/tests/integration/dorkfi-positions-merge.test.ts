import assert from "node:assert/strict";
import test from "node:test";

import {
  DORKFI_MAINNET_USDC_ASA_ID,
  DORKFI_MAINNET_USDC_MARKET_APP_ID,
  DORKFI_MAINNET_USDC_POOL_APP_ID,
  type DorkFiLendingMarketState
} from "../../src/execution/shapes/dorkfi/index.js";
import { attachExecutionShapesToPosition } from "../../src/services/position-execution-shapes.js";
import {
  collectDorkFiPositions,
  normalizeDorkFiHealthRecords,
  setDorkFiPositionCollectorDependenciesForTests
} from "../../src/services/protocol-positions.js";
import { emptyWalletSnapshot } from "../../src/services/wallet-snapshot.js";

const ADDRESS =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";

test.afterEach(() => {
  setDorkFiPositionCollectorDependenciesForTests(undefined);
});

function usdcMarketState(
  overrides: Partial<DorkFiLendingMarketState> = {}
): DorkFiLendingMarketState {
  return {
    network: "mainnet",
    poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
    marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
    assetId: DORKFI_MAINNET_USDC_ASA_ID,
    nTokenAppId: 3_333_764_003,
    poolAppAddress: ADDRESS,
    decimals: 6,
    tokenStandard: "asa",
    symbol: "USDC",
    paused: false,
    depositIndex: 10n ** 18n,
    userAssetBalance: 0n,
    userNTokenBalance: 1_000_000n,
    userOptedIntoAsset: true,
    catalogMarket: {
      symbol: "USDC",
      poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
      marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
      nTokenAppId: 3_333_764_003,
      assetId: DORKFI_MAINNET_USDC_ASA_ID,
      decimals: 6,
      tokenStandard: "asa"
    },
    ...overrides
  };
}

test("Dork.fi merges ASA supply with indexed USD aggregate and keeps withdraw actionable", async () => {
  setDorkFiPositionCollectorDependenciesForTests({
    fetchIndexedPositions: async () =>
      normalizeDorkFiHealthRecords([
        {
          network: "algorand-mainnet",
          appId: String(DORKFI_MAINNET_USDC_POOL_APP_ID),
          totalCollateralValue: "1000000000000",
          totalBorrowValue: "0",
          healthFactor: "10",
          lastUpdated: 1_783_944_000_000
        }
      ]),
    resolveMarketState: async (params) => {
      if (
        params.marketAppId === DORKFI_MAINNET_USDC_MARKET_APP_ID &&
        params.assetId === DORKFI_MAINNET_USDC_ASA_ID
      ) {
        return usdcMarketState();
      }
      return usdcMarketState({
        poolAppId: params.poolAppId,
        marketAppId: params.marketAppId,
        assetId: params.assetId,
        userNTokenBalance: 0n,
        symbol: "OTHER",
        catalogMarket: {
          symbol: "OTHER",
          poolAppId: params.poolAppId,
          marketAppId: params.marketAppId,
          nTokenAppId: 1,
          assetId: params.assetId,
          decimals: 6,
          tokenStandard: "asa"
        }
      });
    }
  });

  const result = await collectDorkFiPositions(ADDRESS, emptyWalletSnapshot(ADDRESS));
  const enriched = result.positions.map((position) =>
    attachExecutionShapesToPosition(position)
  );

  const asa = enriched.find(
    (position) =>
      position.opportunityId ===
      "dorkfi:algorand:3333688282:31566704:lending"
  );
  assert.ok(asa);
  assert.equal(asa.positionId, `dorkfi:supplied:${DORKFI_MAINNET_USDC_MARKET_APP_ID}`);
  assert.equal(asa.assetId, DORKFI_MAINNET_USDC_ASA_ID);
  assert.equal(asa.amountRaw, "1000000");
  assert.deepEqual(asa.inputHints, {
    poolAppId: DORKFI_MAINNET_USDC_POOL_APP_ID,
    marketAppId: DORKFI_MAINNET_USDC_MARKET_APP_ID,
    assetId: DORKFI_MAINNET_USDC_ASA_ID
  });
  assert.ok(
    asa.compatibleExitShapeKeys.includes("mainnet:dorkfi:v1:withdraw:asa")
  );

  const usd = enriched.find(
    (position) =>
      position.positionId === `dorkfi:supplied-usd:${DORKFI_MAINNET_USDC_POOL_APP_ID}`
  );
  assert.ok(usd);
  assert.equal(usd.opportunityId, null);
  assert.equal(usd.assetId, null);
  assert.deepEqual(usd.compatibleExitShapeKeys, []);
  assert.ok(
    (usd.caveats ?? []).some((caveat) => caveat.includes("Not executable"))
  );

  assert.equal(result.coverage?.suppliedUsdComplete, true);
  assert.equal(result.coverage?.borrowedUsdComplete, true);
});

test("Dork.fi paused markets are skipped quietly and do not hide USDC supply", async () => {
  setDorkFiPositionCollectorDependenciesForTests({
    fetchIndexedPositions: async () =>
      normalizeDorkFiHealthRecords([
        {
          network: "algorand-mainnet",
          appId: String(DORKFI_MAINNET_USDC_POOL_APP_ID),
          totalCollateralValue: "1000000000000",
          totalBorrowValue: "0",
          healthFactor: "10",
          lastUpdated: 1_783_944_000_000
        }
      ]),
    resolveMarketState: async (params) => {
      if (params.marketAppId === DORKFI_MAINNET_USDC_MARKET_APP_ID) {
        return usdcMarketState();
      }
      throw new Error("Dork.fi market is paused.");
    }
  });

  const result = await collectDorkFiPositions(ADDRESS, emptyWalletSnapshot(ADDRESS));
  assert.equal(result.warnings.length, 0);
  assert.ok(
    result.positions.some(
      (position) =>
        position.opportunityId ===
        "dorkfi:algorand:3333688282:31566704:lending"
    )
  );
});

test("Dork.fi market probe warnings stay short without algosdk dumps", async () => {
  setDorkFiPositionCollectorDependenciesForTests({
    fetchIndexedPositions: async () => ({ positions: [], warnings: [] }),
    resolveMarketState: async () => {
      throw new Error(
        'App call transaction did not log a return value {"txn":{"txn":{"apar":"x".repeat(5000)}}}'
      );
    }
  });

  const result = await collectDorkFiPositions(ADDRESS, emptyWalletSnapshot(ADDRESS));
  assert.ok(result.warnings.length > 0);
  for (const warning of result.warnings) {
    assert.ok(warning.length <= 180, warning);
    assert.equal(warning.includes('"txn"'), false);
  }
});

test("Dork.fi USD aggregates alone never advertise withdraw shapes", () => {
  const result = normalizeDorkFiHealthRecords([
    {
      network: "algorand-mainnet",
      appId: String(DORKFI_MAINNET_USDC_POOL_APP_ID),
      totalCollateralValue: "1000000000000",
      totalBorrowValue: "0",
      healthFactor: "10",
      lastUpdated: 1_783_944_000_000
    }
  ]);
  const enriched = attachExecutionShapesToPosition(result.positions[0]!);
  assert.equal(enriched.positionId, `dorkfi:supplied-usd:${DORKFI_MAINNET_USDC_POOL_APP_ID}`);
  assert.deepEqual(enriched.compatibleExitShapeKeys, []);
  assert.deepEqual(enriched.compatibleManageShapeKeys, []);
});
