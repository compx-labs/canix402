import assert from "node:assert/strict";
import test from "node:test";

import {
  aaveLendingOpportunityId,
  fetchAaveOpportunities,
  normalizeAaveReserve,
  setAaveAdapterDependenciesForTests
} from "../../src/adapters/index.js";
import { BASE_CHAIN_ID } from "../../src/execution/evm.js";
import {
  AAVE_FIXTURE_FETCHED_AT,
  aaveCollateralOnlyZeroApy,
  aaveFrozen,
  aaveNativeEth,
  aavePaused,
  aaveUsdc,
  aaveWethBorrowDisabled,
  aaveZeroTvl
} from "../fixtures/adapters/aave-reserves.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

test.afterEach(() => {
  setAaveAdapterDependenciesForTests(undefined);
});

test("normalizeAaveReserve maps a Base USDC reserve onto lending risk fields", () => {
  const record = normalizeAaveReserve(aaveUsdc, AAVE_FIXTURE_FETCHED_AT, {
    chainId: BASE_CHAIN_ID
  });
  assert.ok(record);
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "aave");
  assert.equal(record.chain, "base");
  assert.equal(record.opportunityType, "lending");
  assert.equal(record.assetPair, "USDC");
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.apy, 0.038085525415474957 * 100);
  assert.equal(record.borrowApr, 0.047672454913218233 * 100);
  assert.equal(record.tvlUsd, 179287040.75731447);
  assert.equal(record.assetIds, undefined);
  assert.deepEqual(record.assetAddresses, [
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
  ]);
  assert.equal(
    record.opportunityId,
    aaveLendingOpportunityId("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
  );
  assert.equal(record.poolId, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(record.risk?.utilization, 0.8917849970514299 * 100);
  assert.equal(record.risk?.ltv, 75);
  assert.equal(record.risk?.liquidationThreshold, 78);
  assert.equal(record.risk?.borrowApr, record.borrowApr);
  assert.equal(record.risk?.healthFactor, undefined);
});

test("normalizeAaveReserve omits borrowApr when borrowing is disabled", () => {
  const record = normalizeAaveReserve(aaveWethBorrowDisabled, AAVE_FIXTURE_FETCHED_AT, {
    chainId: BASE_CHAIN_ID
  });
  assert.ok(record);
  assert.equal(record.assetPair, "WETH");
  assert.equal(record.apy, 2);
  assert.equal(record.borrowApr, undefined);
  assert.equal(record.risk?.borrowApr, undefined);
  assert.equal(record.risk?.utilization, 10);
});

test("normalizeAaveReserve drops frozen, paused, zero TVL, collateral-only, and native ETH", () => {
  for (const item of [
    aaveFrozen,
    aavePaused,
    aaveZeroTvl,
    aaveCollateralOnlyZeroApy,
    aaveNativeEth
  ]) {
    assert.equal(
      normalizeAaveReserve(item, AAVE_FIXTURE_FETCHED_AT, { chainId: BASE_CHAIN_ID }),
      null
    );
  }
  assert.equal(
    normalizeAaveReserve(aaveUsdc, AAVE_FIXTURE_FETCHED_AT, { chainId: 1 }),
    null
  );
});

test("fetchAaveOpportunities normalizes the Base market and ignores other markets", async () => {
  setAaveAdapterDependenciesForTests({
    graphqlUrl: "https://aave.test/graphql",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          data: {
            markets: [
              {
                address: "0x0000000000000000000000000000000000000001",
                chain: { chainId: 1 },
                reserves: [aaveUsdc]
              },
              {
                address: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
                chain: { chainId: BASE_CHAIN_ID },
                reserves: [aaveUsdc, aaveFrozen, aaveCollateralOnlyZeroApy]
              }
            ]
          }
        })
      )
  });

  const rows = await fetchAaveOpportunities();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.protocol, "aave");
  assert.equal(rows[0]?.assetPair, "USDC");
});
