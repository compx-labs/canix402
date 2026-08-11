import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFeeHarvestNote,
  floorToWholeUsdcMicro,
  formatUsdcFromMicro,
  splitFeeHarvestWholeUsdc
} from "../../src/services/fee-harvest.js";
import {
  FEE_HARVEST_CRON_EXPRESSION,
  isFeeHarvestEnabled
} from "../../src/jobs/fee-harvest-cron.js";

test("floorToWholeUsdcMicro matches sweep-usdc whole-unit flooring", () => {
  assert.equal(floorToWholeUsdcMicro(0n), 0n);
  assert.equal(floorToWholeUsdcMicro(999_999n), 0n);
  assert.equal(floorToWholeUsdcMicro(1_000_000n), 1_000_000n);
  assert.equal(floorToWholeUsdcMicro(6_250_000n), 6_000_000n);
  assert.equal(floorToWholeUsdcMicro(10_999_999n), 10_000_000n);
});

test("splitFeeHarvestWholeUsdc applies 30/30/40 with remainder on C", () => {
  const six = splitFeeHarvestWholeUsdc(6n);
  assert.equal(six.amountAMicro, 1_000_000n);
  assert.equal(six.amountBMicro, 1_000_000n);
  assert.equal(six.amountCMicro, 4_000_000n);
  assert.equal(
    six.amountAMicro + six.amountBMicro + six.amountCMicro,
    six.sendMicro
  );

  const ten = splitFeeHarvestWholeUsdc(10n);
  assert.equal(ten.amountAMicro, 3_000_000n);
  assert.equal(ten.amountBMicro, 3_000_000n);
  assert.equal(ten.amountCMicro, 4_000_000n);

  const zero = splitFeeHarvestWholeUsdc(0n);
  assert.equal(zero.sendMicro, 0n);
  assert.equal(zero.amountAMicro, 0n);
  assert.equal(zero.amountBMicro, 0n);
  assert.equal(zero.amountCMicro, 0n);

  const one = splitFeeHarvestWholeUsdc(1n);
  assert.equal(one.amountAMicro, 0n);
  assert.equal(one.amountBMicro, 0n);
  assert.equal(one.amountCMicro, 1_000_000n);
});

test("buildFeeHarvestNote uses UTC YYYY-MM-DD", () => {
  assert.equal(
    buildFeeHarvestNote(new Date("2026-08-12T23:30:00.000Z")),
    "Canix402 fees 2026-08-12"
  );
  assert.equal(
    buildFeeHarvestNote(new Date("2026-01-05T00:00:00.000Z")),
    "Canix402 fees 2026-01-05"
  );
});

test("formatUsdcFromMicro pads fractional microUSDC", () => {
  assert.equal(formatUsdcFromMicro(6_250_000n), "6.250000");
  assert.equal(formatUsdcFromMicro(0n), "0.000000");
});

test("fee harvest cron is Wednesday 00:00 UTC and gates on RECEIVER_MNEMONIC", () => {
  assert.equal(FEE_HARVEST_CRON_EXPRESSION, "0 0 * * 3");
  assert.equal(isFeeHarvestEnabled({}), false);
  assert.equal(
    isFeeHarvestEnabled({
      RECEIVER_MNEMONIC: "abandon abandon abandon"
    }),
    true
  );
});
