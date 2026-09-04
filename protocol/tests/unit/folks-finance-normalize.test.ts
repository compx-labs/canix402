import assert from "node:assert/strict";
import test from "node:test";

import {
  FOLKS_XALGO_STAKING_OPPORTUNITY_ID,
  normalizeFolksLendingOpportunity,
  normalizeFolksXAlgoStakingOpportunity
} from "../../src/adapters/index.js";
import { SOURCE_TIMESTAMP_FETCH_PROXY_NOTE } from "../../src/services/source-metadata.js";
import {
  FOLKS_ALGO_POOL_APP_ID,
  FOLKS_FETCHED_AT,
  FOLKS_XALGO_ASSET_ID,
  folksAlgoLendingFixture,
  folksAlgoPool,
  folksPoolInfo,
  folksPoolManagerInfo,
  folksXAlgoStakingFixture
} from "../fixtures/adapters/folks-sdk.js";
import { assertValidMarketRecord } from "./helpers/assert-market-record.js";

test("normalizeFolksLendingOpportunity maps recorded SDK yields and oracle TVL", () => {
  const record = normalizeFolksLendingOpportunity(folksAlgoLendingFixture());
  assertValidMarketRecord(record);
  assert.equal(record.protocol, "folks-finance");
  assert.equal(record.opportunityType, "lending");
  assert.equal(record.opportunityId, `folks-lending-${FOLKS_ALGO_POOL_APP_ID}`);
  assert.equal(record.assetPair, "ALGO");
  assert.deepEqual(record.assetIds, [0]);
  assert.equal(record.apy, 5.5);
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.apr, 4.5);
  assert.equal(record.borrowApr, 9);
  assert.equal(record.risk?.borrowApr, 9);
  assert.equal(record.risk?.utilization, 0);
  assert.equal(record.tvlUsd, 275);
  assert.equal(record.fetchedAt, FOLKS_FETCHED_AT);
  assert.equal(record.sourceTimestamp, record.fetchedAt);
  assert.match(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
  assert.match(record.notes ?? "", /Folks mainnet lending pool 42/);
});

test("normalizeFolksLendingOpportunity maps borrow/deposit balances into utilization", () => {
  const fixture = folksAlgoLendingFixture();
  fixture.poolInfo = folksPoolInfo(1_000_000n);
  fixture.poolInfo.variableBorrow.totalVariableBorrowAmount = 250_000n;
  const record = normalizeFolksLendingOpportunity(fixture);
  assertValidMarketRecord(record);
  assert.equal(record.risk?.utilization, 25);
});

test("normalizeFolksLendingOpportunity uses upstream latestUpdate when present", () => {
  const fixture = folksAlgoLendingFixture();
  fixture.poolInfo = folksPoolInfo(1_250_000_000n, 1_700_000_000n);
  const record = normalizeFolksLendingOpportunity(fixture);
  assertValidMarketRecord(record);
  assert.equal(record.sourceTimestamp, "2023-11-14T22:13:20.000Z");
  assert.doesNotMatch(record.notes ?? "", new RegExp(SOURCE_TIMESTAMP_FETCH_PROXY_NOTE));
});

test("normalizeFolksLendingOpportunity drops incomplete manager/oracle/decimals state", () => {
  const complete = folksAlgoLendingFixture();
  assert.equal(
    normalizeFolksLendingOpportunity({
      ...complete,
      poolManagerInfo: { adminAddress: "ADMIN", pools: {} }
    }),
    null
  );
  assert.equal(
    normalizeFolksLendingOpportunity({
      ...complete,
      oraclePrice: undefined
    }),
    null
  );
  assert.equal(
    normalizeFolksLendingOpportunity({
      ...complete,
      assetDecimals: undefined
    }),
    null
  );
});

test("normalizeFolksLendingOpportunity drops rows for a different pool app id", () => {
  const fixture = folksAlgoLendingFixture();
  fixture.poolManagerInfo = folksPoolManagerInfo(99, {
    depositInterestRate: 1n,
    depositInterestYield: 1n
  });
  assert.equal(normalizeFolksLendingOpportunity(fixture), null);
});

test("normalizeFolksXAlgoStakingOpportunity applies Folks protocol fee", () => {
  const record = normalizeFolksXAlgoStakingOpportunity(folksXAlgoStakingFixture());
  assertValidMarketRecord(record);
  assert.equal(record.opportunityType, "staking");
  assert.equal(record.opportunityId, FOLKS_XALGO_STAKING_OPPORTUNITY_ID);
  assert.equal(record.assetPair, "ALGO/xALGO");
  assert.deepEqual(record.assetIds, [0, FOLKS_XALGO_ASSET_ID]);
  assert.equal(record.apr, 10);
  assert.equal(record.apy, 9.5);
  assert.equal(record.yieldBasis, "apy");
  assert.equal(record.tvlUsd, 275);
  assert.ok(record.notes?.includes("5.00%"));
});

test("normalizeFolksXAlgoStakingOpportunity drops incomplete or invalid fee inputs", () => {
  assert.equal(
    normalizeFolksXAlgoStakingOpportunity({
      ...folksXAlgoStakingFixture(),
      consensusState: { algoBalance: 0n, fee: 0n }
    }),
    null
  );
  assert.equal(
    normalizeFolksXAlgoStakingOpportunity({
      ...folksXAlgoStakingFixture(),
      oraclePrice: undefined
    }),
    null
  );
  assert.equal(
    normalizeFolksXAlgoStakingOpportunity({
      ...folksXAlgoStakingFixture(),
      consensusState: { algoBalance: 1_000n, fee: 1_000_000_000_000_000_000n }
    }),
    null
  );
});

test("normalizeFolksLendingOpportunity still requires a matching pool manager entry for the pool object", () => {
  const record = normalizeFolksLendingOpportunity({
    symbol: "ALGO",
    pool: folksAlgoPool(),
    poolInfo: folksPoolInfo(1n),
    poolManagerInfo: folksPoolManagerInfo(FOLKS_ALGO_POOL_APP_ID, {
      depositInterestRate: 0n,
      depositInterestYield: 0n
    }),
    oraclePrice: 22_000_000n,
    assetDecimals: 6,
    fetchedAtIso: FOLKS_FETCHED_AT
  });
  assertValidMarketRecord(record);
  assert.equal(record.apy, 0);
});
