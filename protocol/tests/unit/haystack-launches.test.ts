import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  ABI_RETURN_LOG_PREFIX,
  HAYSTACK_LAUNCH_WINDOW_MS
} from "../../src/execution/shapes/haystack/launch-constants.js";
import {
  bondingProgressPercent,
  decodeAssetMapTokenNum,
  decodeTokenInfoBox,
  priceUsd
} from "../../src/execution/shapes/haystack/launch-codec.js";
import { parseIndexedLaunches } from "../../src/execution/shapes/haystack/launch-indexer.js";
import {
  filterAndSortLaunches,
  resolveLaunchWindow,
  type HaystackLaunchListRow
} from "../../src/execution/shapes/haystack/launch-query.js";
import {
  LAUNCH_TOKEN_SELECTOR_HEX,
  TOKEN_INFO_TYPE,
  uint64Bytes
} from "../../src/execution/shapes/haystack/launch-spec.js";
import {
  getHaystackLaunch,
  listHaystackLaunches,
  resetHaystackLaunchCacheForTests,
  setHaystackLaunchDependenciesForTests
} from "../../src/services/haystack-launches.js";
import type { HaystackLaunchTokenInfo } from "../../src/execution/shapes/haystack/launch-codec.js";

const CREATOR = algosdk.generateAccount().addr.toString();

test("token box decode round-trips name, symbol, and bonding progress", () => {
  const info = sampleInfo({
    name: "Lenin",
    symbol: "LENIN",
    initialRealTokenReserves: 800n,
    realTokenReserves: 200n
  });
  const decoded = decodeTokenInfoBox(encodeInfo(info));
  assert.equal(decoded.name, "Lenin");
  assert.equal(decoded.symbol, "LENIN");
  assert.equal(decoded.tokenNum, 175);
  assert.equal(decoded.bondingOn, 0);
  assert.equal(bondingProgressPercent(decoded), 75);
  assert.equal(decodeAssetMapTokenNum(uint64Bytes(175)), 175);
});

test("USD price uses the bonding-token oracle scale", () => {
  const info = sampleInfo({
    virtualTokenReserves: 1_000_000_000_000n,
    virtualBondingReserves: 2_000_000n
  });
  assert.equal(priceUsd(info, 1_000_000_000n), "0.000002");
});

test("indexer keeps launch creates and reads the token number from the return log", () => {
  const log = Buffer.concat([
    Buffer.from(ABI_RETURN_LOG_PREFIX, "hex"),
    Buffer.from(uint64Bytes(175))
  ]).toString("base64");
  const launches = parseIndexedLaunches([
    {
      roundTime: 1_790_981_792,
      applicationTransaction: {
        applicationArgs: [Buffer.from(LAUNCH_TOKEN_SELECTOR_HEX, "hex")]
      },
      logs: [log],
      innerTxns: [{ createdAssetIndex: 3_729_195_158 }]
    },
    {
      roundTime: 1_790_981_800,
      applicationTransaction: {
        applicationArgs: [Buffer.from("3172ca9d", "hex")]
      },
      logs: []
    }
  ]);
  assert.equal(launches.length, 1);
  assert.equal(launches[0]?.tokenNum, 175);
  assert.equal(launches[0]?.assetId, 3_729_195_158);
  assert.equal(launches[0]?.launchedAt, "2026-10-02T22:56:32.000Z");
});

test("launch list filters by name, progress bounds, and bonding-percent order", () => {
  const rows = [
    row({ tokenNum: 1, name: "Alpha", symbol: "ALP", progressPercent: 10 }),
    row({ tokenNum: 2, name: "Beta", symbol: "LEN", progressPercent: 80 }),
    row({ tokenNum: 3, name: "Lenin", symbol: "ZZZ", progressPercent: 40 }),
    row({ tokenNum: 4, name: "Gamma", symbol: "GAM", progressPercent: 40 })
  ];
  const searched = filterAndSortLaunches(rows, { q: "len" });
  assert.deepEqual(searched.launches.map((entry) => entry.tokenNum), [2, 3]);

  const bounded = filterAndSortLaunches(rows, { minProgress: 40, maxProgress: 80, order: "asc" });
  assert.deepEqual(bounded.launches.map((entry) => entry.tokenNum), [4, 3, 2]);

  const desc = filterAndSortLaunches(rows, { order: "desc" });
  assert.deepEqual(desc.launches.map((entry) => entry.tokenNum), [2, 4, 3, 1]);
});

test("omitted launchedAfter is the 60 days before launchedBefore", () => {
  const now = Date.parse("2026-10-05T12:00:00.000Z");
  const open = resolveLaunchWindow(now, {});
  assert.equal(open.launchedBefore, "2026-10-05T12:00:00.000Z");
  assert.equal(Date.parse(open.launchedBefore) - Date.parse(open.launchedAfter), HAYSTACK_LAUNCH_WINDOW_MS);

  const explicit = resolveLaunchWindow(now, { launchedAfter: "2026-01-01T00:00:00.000Z" });
  assert.equal(explicit.launchedAfter, "2026-01-01T00:00:00.000Z");
});

test("list search is cached for the window and filters run in memory", async () => {
  resetHaystackLaunchCacheForTests();
  let reads = 0;
  const now = Date.parse("2026-10-05T12:00:00.000Z");
  setHaystackLaunchDependenciesForTests({
    now: () => now,
    searchLaunches: async () => {
      reads += 1;
      return [
        { tokenNum: 7, assetId: 99, launchedAt: "2026-09-01T00:00:00.000Z" },
        { tokenNum: 8, assetId: 100, launchedAt: "2026-09-02T00:00:00.000Z" }
      ];
    },
    readToken: async (tokenNum) =>
      sampleInfo({
        tokenNum,
        name: tokenNum === 7 ? "Alpha" : "Beta",
        symbol: tokenNum === 7 ? "ALP" : "BET",
        bondingOn: 0
      }),
    bondingTokenPrice: async () => 1_000_000_000n
  });

  const first = await listHaystackLaunches({ q: "alp" });
  const second = await listHaystackLaunches({ q: "bet", order: "asc" });
  assert.equal(reads, 1);
  assert.equal(first.total, 1);
  assert.equal(first.launches[0]?.symbol, "ALP");
  assert.equal(second.launches[0]?.symbol, "BET");
  assert.equal(first.launchedAfter, resolveLaunchWindow(now, {}).launchedAfter);

  setHaystackLaunchDependenciesForTests(undefined);
});

test("one-token read uses the asset map and reports a graduated token", async () => {
  setHaystackLaunchDependenciesForTests({
    readTokenNumForAsset: async () => 9,
    readToken: async () => sampleInfo({ tokenNum: 9, bondingOn: 3, poolAppId: 42, assetId: 555 }),
    bondingTokenPrice: async () => null,
    userHolding: async () => 12n
  });
  const detail = await getHaystackLaunch({ assetId: 555, address: CREATOR });
  assert.equal(detail.tokenNum, 9);
  assert.equal(detail.phase, "graduated");
  assert.equal(detail.buyShapeKey, null);
  assert.equal(detail.userHolding, "12");
  assert.match(detail.note ?? "", /POST \/swaps\/quote/);
  setHaystackLaunchDependenciesForTests(undefined);
});

function row(overrides: Partial<HaystackLaunchListRow>): HaystackLaunchListRow {
  return {
    tokenNum: 1,
    assetId: 10,
    name: "Token",
    symbol: "TOK",
    assetUrl: "ipfs://example",
    creator: CREATOR,
    bondingTokenId: 0,
    launchedAt: "2026-09-01T00:00:00.000Z",
    progressPercent: 0,
    priceBonding: "0",
    priceUsd: null,
    realTokenReserves: "1",
    realBondingReserves: "1",
    initialRealTokenReserves: "1",
    bondingTargetUsd: "2500000000",
    priceMultiplier: "20",
    buyShapeKey: "mainnet:haystack:v1:buy:bonding",
    ...overrides
  };
}

function sampleInfo(overrides: Partial<HaystackLaunchTokenInfo> = {}): HaystackLaunchTokenInfo {
  return {
    version: 2,
    tokenNum: 175,
    tokenCreator: CREATOR,
    bondingTokenId: 0,
    virtualTokenReserves: 1_000_000n,
    virtualBondingReserves: 1_000_000n,
    realTokenReserves: 800_000n,
    realBondingReserves: 20_000n,
    initialRealTokenReserves: 800_000n,
    launchQ: 1n,
    feeBpsPlatform: 100,
    feeBpsCreator: 50,
    bondingTargetUsd: 2_500_000_000n,
    tokenPriceMultiplier: 20_000_000_000n,
    bondingOn: 0,
    assetId: 3_729_195_158,
    symbol: "LENIN",
    name: "Lenin",
    assetUrl: "ipfs://example",
    description: "",
    socialWebsite: "",
    socialX: "",
    socialTelegram: "",
    socialDiscord: "",
    poolAppId: 0,
    lpTokenId: 0,
    ...overrides
  };
}

function encodeInfo(info: HaystackLaunchTokenInfo): Uint8Array {
  return TOKEN_INFO_TYPE.encode([
    Uint8Array.from([info.version]),
    info.tokenNum,
    info.tokenCreator,
    info.bondingTokenId,
    info.virtualTokenReserves,
    info.virtualBondingReserves,
    info.realTokenReserves,
    info.realBondingReserves,
    info.initialRealTokenReserves,
    info.launchQ,
    info.feeBpsPlatform,
    info.feeBpsCreator,
    info.bondingTargetUsd,
    info.tokenPriceMultiplier,
    info.bondingOn,
    info.assetId,
    fixedBytes(info.symbol, 8),
    fixedBytes(info.name, 32),
    fixedBytes(info.assetUrl, 96),
    fixedBytes(info.description, 1024),
    fixedBytes(info.socialWebsite, 256),
    fixedBytes(info.socialX, 64),
    fixedBytes(info.socialTelegram, 64),
    fixedBytes(info.socialDiscord, 64),
    info.poolAppId,
    info.lpTokenId
  ]);
}

function fixedBytes(value: string, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(Buffer.from(value, "utf8"));
  return bytes;
}
