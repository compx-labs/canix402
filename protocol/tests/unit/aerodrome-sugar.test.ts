import assert from "node:assert/strict";
import test from "node:test";

import { readAerodromeSugarPools } from "../../src/adapters/aerodrome.js";
import {
  BASE_MULTICALL3,
  decodeLpSugarAll,
  decodeTryAggregate,
  encodeTryAggregateCall,
  SUGAR_COUNT_SELECTOR
} from "../../src/adapters/aerodrome-sugar.js";
import { AERO_POOL, SUGAR_VOLATILE_PAGE_HEX } from "../fixtures/adapters/aerodrome-pools.js";

const SUGAR = "0x69dd9db6d8f8e7d83887a704f447b1a584b599a1";
const COUNT_CALL = `0x${SUGAR_COUNT_SELECTOR}`;

test("encodeTryAggregateCall matches the Multicall3 ABI for one Sugar call", () => {
  const encoded = encodeTryAggregateCall([{ target: SUGAR, data: COUNT_CALL }]);
  assert.equal(
    encoded,
    "0xbce38bd7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000069dd9db6d8f8e7d83887a704f447b1a584b599a10000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000406661abd00000000000000000000000000000000000000000000000000000000"
  );
});

test("decodeTryAggregate returns each batched Sugar page", () => {
  const encoded = encodeAggregateReturn([
    { success: true, data: SUGAR_VOLATILE_PAGE_HEX },
    { success: false, data: "0x" }
  ]);
  const parts = decodeTryAggregate(encoded);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]?.success, true);
  assert.equal(parts[0]?.returnData, SUGAR_VOLATILE_PAGE_HEX);
  assert.equal(parts[1]?.success, false);
  const [pool] = decodeLpSugarAll(parts[0]?.returnData ?? "0x");
  assert.equal(pool?.lp, AERO_POOL);
});

test("readAerodromeSugarPools retries rate limits and decodes the batch", async () => {
  let countAttempts = 0;
  let batchAttempts = 0;
  const pools = await readAerodromeSugarPools(
    async (to, data) => {
      if (to === SUGAR && data === COUNT_CALL) {
        countAttempts += 1;
        if (countAttempts === 1) {
          throw new Error("Base RPC returned non-2xx status: 429.");
        }
        return `0x${"2".padStart(64, "0")}`;
      }
      batchAttempts += 1;
      if (batchAttempts === 1) {
        throw new Error("Base RPC returned non-2xx status: 429.");
      }
      assert.equal(to, BASE_MULTICALL3);
      return encodeAggregateReturn([
        { success: true, data: SUGAR_VOLATILE_PAGE_HEX },
        { success: true, data: SUGAR_VOLATILE_PAGE_HEX }
      ]);
    },
    { sugar: SUGAR, pageSize: 1, pagesPerCall: 2, sleep: async () => undefined }
  );

  assert.equal(countAttempts, 2);
  assert.equal(batchAttempts, 2);
  assert.equal(pools.length, 2);
  assert.equal(pools[0]?.lp, AERO_POOL);
});

test("a reverted Sugar batch is split into single pages", async () => {
  const calls: string[] = [];
  const pools = await readAerodromeSugarPools(
    async (to, data) => {
      calls.push(to);
      if (data === COUNT_CALL) {
        return `0x${"2".padStart(64, "0")}`;
      }
      if (to === BASE_MULTICALL3) {
        throw new Error("execution reverted");
      }
      return SUGAR_VOLATILE_PAGE_HEX;
    },
    { sugar: SUGAR, pageSize: 1, pagesPerCall: 2, sleep: async () => undefined }
  );

  assert.equal(pools.length, 2);
  assert.equal(calls.filter((to) => to === BASE_MULTICALL3).length, 1);
  assert.equal(calls.filter((to) => to === SUGAR).length, 3);
});

test("Sugar rate limits still fail the catalog when retries are exhausted", async () => {
  await assert.rejects(
    () =>
      readAerodromeSugarPools(
        async () => {
          throw new Error("Base RPC returned non-2xx status: 429.");
        },
        { sugar: SUGAR, pageSize: 1, pagesPerCall: 2, sleep: async () => undefined }
      ),
    /Aerodrome Sugar count\(\) failed\. Base RPC returned non-2xx status: 429\./
  );
});

function encodeAggregateReturn(results: readonly { success: boolean; data: string }[]): string {
  const tuples = results.map((result) => {
    const payload = result.data.replace(/^0x/, "");
    const padded = payload.padEnd(payload.length + ((64 - (payload.length % 64)) % 64), "0");
    return (
      word(result.success ? 1n : 0n) +
      word(64n) +
      word(BigInt(payload.length / 2)) +
      padded
    );
  });
  let cursor = results.length * 32;
  const heads: string[] = [];
  for (const body of tuples) {
    heads.push(word(BigInt(cursor)));
    cursor += body.length / 2;
  }
  return `0x${word(32n)}${word(BigInt(results.length))}${heads.join("")}${tuples.join("")}`;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
