#!/usr/bin/env tsx
/**
 * Weekly strategy NFT-holder fee payouts.
 *
 * Scans Canix payTo for tagged compile access notes, computes 50% holder share,
 * skips strategyIds already paid this week (payout-wallet outflow notes), and
 * optionally sends USDC from STRATEGY_PAYOUT_ADDRESS.
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env scripts/strategy-weekly-payouts.ts --dry-run
 *   npx tsx --env-file-if-exists=.env scripts/strategy-weekly-payouts.ts
 */
import {
  buildWeeklyPayoutPlan,
  executeWeeklyPayouts,
  isoWeekKey
} from "../src/services/strategy-fee-payout.js";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const weekFlag = argv.find((arg) => arg.startsWith("--week="));
  const afterFlag = argv.find((arg) => arg.startsWith("--after="));
  const beforeFlag = argv.find((arg) => arg.startsWith("--before="));
  return {
    dryRun,
    week: weekFlag?.slice("--week=".length),
    afterTime: afterFlag?.slice("--after=".length),
    beforeTime: beforeFlag?.slice("--before=".length)
  };
}

function defaultWindow(): { afterTime: string; beforeTime: string } {
  const before = new Date();
  const after = new Date(before.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    afterTime: after.toISOString(),
    beforeTime: before.toISOString()
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const window = defaultWindow();
  const indexerUrl = process.env.X402_INDEXER_URL?.trim();
  const payToAddress = process.env.X402_PAYMENT_RECEIVER_ADDRESS?.trim();
  const payoutAddress = process.env.STRATEGY_PAYOUT_ADDRESS?.trim();
  const usdcAssetId = Number(process.env.X402_USDC_ASSET_ID ?? "31566704");

  if (!indexerUrl || !payToAddress || !payoutAddress) {
    throw new Error(
      "X402_INDEXER_URL, X402_PAYMENT_RECEIVER_ADDRESS, and STRATEGY_PAYOUT_ADDRESS are required."
    );
  }

  const options = {
    indexerUrl,
    indexerToken: process.env.X402_INDEXER_TOKEN?.trim(),
    payToAddress,
    payoutAddress,
    usdcAssetId,
    afterTime: args.afterTime ?? window.afterTime,
    beforeTime: args.beforeTime ?? window.beforeTime,
    week: args.week ?? isoWeekKey(),
    dryRun: args.dryRun
  };

  if (args.dryRun) {
    const plan = await buildWeeklyPayoutPlan(options);
    console.log(JSON.stringify(serializePlan(plan), null, 2));
    return;
  }

  const result = await executeWeeklyPayouts(options);
  console.log(
    JSON.stringify(
      {
        week: result.plan.week,
        alreadyPaidStrategyIds: result.plan.alreadyPaidStrategyIds,
        skippedDust: result.plan.skippedDust.map(serializeAccrual),
        sent: result.sent
      },
      null,
      2
    )
  );
}

function serializePlan(plan: Awaited<ReturnType<typeof buildWeeklyPayoutPlan>>) {
  return {
    week: plan.week,
    alreadyPaidStrategyIds: plan.alreadyPaidStrategyIds,
    accruals: plan.accruals.map(serializeAccrual),
    skippedDust: plan.skippedDust.map(serializeAccrual)
  };
}

function serializeAccrual(row: {
  strategyId: number;
  holderAddress: string;
  shareMicroUsdc: bigint;
  accessPaymentCount: number;
}) {
  return {
    strategyId: row.strategyId,
    holderAddress: row.holderAddress,
    shareMicroUsdc: row.shareMicroUsdc.toString(),
    accessPaymentCount: row.accessPaymentCount
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
