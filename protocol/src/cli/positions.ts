import algosdk from "algosdk";

import { fetchWalletPositions } from "../services/aggregate-positions.js";

interface CliArgs {
  address: string;
  compact: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await fetchWalletPositions(args.address);
  console.log(JSON.stringify(result, null, args.compact ? 0 : 2));
}

function parseArgs(argv: string[]): CliArgs {
  let address: string | undefined;
  let compact = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--address") {
      address = argv[index + 1];
      index += 1;
    } else if (arg === "--compact") {
      compact = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  if (!address) {
    throw new Error("--address is required.");
  }
  if (!algosdk.isValidAddress(address)) {
    throw new Error(`'${address}' is not a valid Algorand address.`);
  }

  return { address, compact };
}

function printUsage(): void {
  console.log(
    "Usage: npm run positions -- --address <Algorand address> [--compact]"
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`positions: ${message}`);
  printUsage();
  process.exitCode = 1;
});
