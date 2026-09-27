import assert from "node:assert/strict";
import test from "node:test";

import { formatPrice12 } from "@pdex/sdk/oracle";

import { mallowBuilderFee, quoteBuilderFields } from "../../src/execution/shapes/mallow/config.js";
import {
  numberToPrice12,
  openLimitCrossed,
  paperLiquidationPrice,
  protectLegsFromRoi,
  protectPriceFromRoi,
  validateProtectLegs
} from "../../src/execution/shapes/mallow/math.js";
import { selectMallowMarket } from "../../src/execution/shapes/mallow/markets.js";

test("protect price scales a long take profit by leverage", () => {
  assert.ok(
    Math.abs(
      protectPriceFromRoi({
        side: "long",
        entry: 100,
        leverage: 10,
        leg: "takeProfit",
        pct: 25
      }) - 102.5
    ) < 1e-9
  );
});

test("protect price moves a short take profit below entry", () => {
  assert.ok(
    Math.abs(
      protectPriceFromRoi({
        side: "short",
        entry: 100,
        leverage: 10,
        leg: "takeProfit",
        pct: 25
      }) - 97.5
    ) < 1e-9
  );
});

test("protect legs rebase a 10x long 20% take profit and 25% stop", () => {
  const legs = protectLegsFromRoi({
    side: "long",
    entry: 0.1,
    leverage: 10,
    takeProfitPct: 20,
    stopLossPct: 25
  });
  assert.ok(legs.takeProfit !== undefined && Math.abs(legs.takeProfit - 0.102) < 1e-12);
  assert.ok(legs.stopLoss !== undefined && Math.abs(legs.stopLoss - 0.0975) < 1e-12);
});

test("a stop at liquidation is rejected", () => {
  const entry = 100;
  const leverage = 2;
  const stopLoss = protectPriceFromRoi({
    side: "long",
    entry,
    leverage,
    leg: "stopLoss",
    pct: 100
  });
  assert.equal(
    validateProtectLegs({
      side: "long",
      entry,
      stopLoss,
      liquidation: paperLiquidationPrice("long", entry, leverage)
    }),
    "slLiq"
  );
});

test("a long limit below the index is resting", () => {
  const trigger = numberToPrice12(0.1);
  const index = numberToPrice12(0.12);
  assert.equal(openLimitCrossed("long", trigger, index, index), false);
  assert.equal(openLimitCrossed("long", index, trigger, trigger), true);
});

test("BTC price12 survives past the JavaScript safe integer limit", () => {
  const raw = numberToPrice12(100_000);
  assert.ok(raw > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(raw, 100_000n * 1_000_000_000_000n);
  assert.equal(formatPrice12(raw), "100000");
});

test("ALGO and BTC resolution prefers the USD pair", () => {
  const markets = [
    { singleToken: true, symbol: "ALGO", baseSymbol: "ALGO" },
    { singleToken: false, symbol: "ALGO/EUR", baseSymbol: "ALGO", id: "eur" },
    { singleToken: false, symbol: "ALGO/USD", baseSymbol: "ALGO", id: "algo" },
    { singleToken: false, symbol: "BTC/USD", baseSymbol: "BTC", id: "btc" }
  ];
  assert.equal(selectMallowMarket(markets, "ALGO")?.id, "algo");
  assert.equal(selectMallowMarket(markets, "BTC")?.id, "btc");
  assert.equal(selectMallowMarket(markets.filter((market) => market.id !== "btc"), "BTC"), undefined);
});

test("quote builder fields include the SDK object and snake_case aliases", () => {
  const fields = quoteBuilderFields({
    builderAddress: "BUILDER",
    builderFeeBps: 3n
  });
  assert.deepEqual(fields.builderFee, { builderAddress: "BUILDER", builderFeeBps: 3n });
  assert.equal(fields.builder_address, "BUILDER");
  assert.equal(fields.builder_fee_bps, 3n);
});

test("production refuses a missing Mallow builder address", () => {
  assert.throws(
    () => mallowBuilderFee({ NODE_ENV: "production" }),
    /not configured/
  );
});

test("an invalid builder address is refused", () => {
  assert.throws(
    () => mallowBuilderFee({ NODE_ENV: "test", MALLOW_BUILDER_ADDRESS: "not-an-address" }),
    /invalid/
  );
});
