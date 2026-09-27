import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchWalletPositions,
  setPositionCollectorsForTests,
  SUPPORTED_POSITION_PROTOCOLS
} from "../../src/services/aggregate-positions.js";
import { setAavePositionDependenciesForTests } from "../../src/services/aave-positions.js";
import { healthFactorFromAccount } from "../../src/execution/shapes/aave/shared.js";

const USER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ALGO =
  "RS7TLLQRXKBAQDAVTSZC2ZLMVMLNSCL3FOUOESJJZ5XSKFFL56UI6X33CI";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ATOKEN = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab";
const VTOKEN = "0x59dca05b6c26dbd64b5381374aaac5cd05644c28";

const COMPLETE = {
  suppliedUsdComplete: true,
  borrowedUsdComplete: true,
  rewardsUsdComplete: true
} as const;

test.afterEach(() => {
  setAavePositionDependenciesForTests(undefined);
  setPositionCollectorsForTests(undefined);
});

test("health factor wad scales to a ratio and the no-debt sentinel is omitted", () => {
  assert.equal(
    healthFactorFromAccount({
      totalDebtBase: 1n,
      healthFactorWad: 2n * 10n ** 18n
    }),
    2
  );
  assert.equal(
    healthFactorFromAccount({
      totalDebtBase: 0n,
      healthFactorWad: (1n << 256n) - 1n
    }),
    null
  );
});

test("a Base address returns supplied and variable-debt rows with a scaled health factor", async () => {
  setAavePositionDependenciesForTests({
    listReserves: async () => [
      {
        underlying: USDC,
        symbol: "USDC",
        decimals: 6,
        aToken: ATOKEN,
        variableDebtToken: VTOKEN,
        usdPerToken: 1
      }
    ],
    readBalance: async (token) => (token === ATOKEN ? 2_000_000n : 500_000n),
    readAccount: async () => ({
      totalDebtBase: 1n,
      healthFactorWad: 15n * 10n ** 17n
    })
  });

  setPositionCollectorsForTests({
    aerodrome: async () => ({ positions: [], warnings: [], coverage: COMPLETE })
  });

  const response = await fetchWalletPositions(USER);
  assert.deepEqual(
    response.protocols.map((row) => row.protocol),
    ["aave", "aerodrome"]
  );
  assert.equal(response.data.length, 2);

  const supplied = response.data.find((row) => row.positionType === "supplied");
  const debt = response.data.find((row) => row.positionType === "debt");
  assert.ok(supplied);
  assert.ok(debt);
  assert.equal(supplied.opportunityId, `aave-lending-${USDC}`);
  assert.equal(supplied.amount, "2");
  assert.equal(supplied.usdValue, 2);
  assert.equal(supplied.healthFactor, 1.5);
  assert.equal(debt.amount, "0.5");
  assert.equal(debt.healthFactor, 1.5);
  assert.deepEqual(supplied.compatibleExitShapeKeys, ["base:aave:v3:withdraw:erc20"]);
  assert.deepEqual(supplied.compatibleManageShapeKeys, ["base:aave:v3:borrow:variable"]);
  assert.deepEqual(debt.compatibleExitShapeKeys, ["base:aave:v3:repay:variable"]);
  assert.deepEqual(debt.compatibleManageShapeKeys, []);
});

test("an Algorand address does not call the Aave collector", async () => {
  let calls = 0;
  setAavePositionDependenciesForTests({
    listReserves: async () => {
      calls += 1;
      return [];
    },
    readBalance: async () => 0n,
    readAccount: async () => ({ totalDebtBase: 0n, healthFactorWad: 0n })
  });
  setPositionCollectorsForTests(
    Object.fromEntries(
      SUPPORTED_POSITION_PROTOCOLS.filter((protocol) => protocol !== "aave").map(
        (protocol) => [
          protocol,
          async () => ({ positions: [], warnings: [], coverage: COMPLETE })
        ]
      )
    ) as Parameters<typeof setPositionCollectorsForTests>[0]
  );

  const response = await fetchWalletPositions(ALGO);
  assert.equal(calls, 0);
  assert.equal(
    response.protocols.some((row) => row.protocol === "aave"),
    false
  );
});
