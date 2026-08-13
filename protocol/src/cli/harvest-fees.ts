import {
  FEE_HARVEST_RECIPIENTS,
  runFeeHarvest
} from "../services/fee-harvest.js";

interface CliArgs {
  dryRun: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.RECEIVER_MNEMONIC?.trim()) {
    throw new Error("RECEIVER_MNEMONIC is required in protocol/.env.");
  }

  const result = await runFeeHarvest({ dryRun: args.dryRun });
  console.log(JSON.stringify(result, null, 2));

  if (result.status === "skipped") {
    process.exitCode = 0;
  }
}

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  return { dryRun };
}

function printUsage(): void {
  const recipients = FEE_HARVEST_RECIPIENTS.map(
    (r) => `  ${r.label}: ${r.address}`
  ).join("\n");

  console.log(
    [
      "Usage: npm run harvest:fees -- [--dry-run]",
      "",
      "Mainnet only. Floors the pay-to wallet USDC balance (ASA 31566704) to",
      "whole units and sends 30/30/40 to the fee recipients as an atomic axfer",
      "group (same as the weekly cron). Refuses testnet/localnet algod URLs.",
      "",
      "Recipients:",
      recipients,
      "",
      "Env: RECEIVER_MNEMONIC, optional X402_ALGOD_URL (mainnet), X402_ALGOD_TOKEN,",
      "     optional X402_PAYMENT_RECEIVER_ADDRESS"
    ].join("\n")
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`harvest-fees: ${message}`);
  printUsage();
  process.exitCode = 1;
});
