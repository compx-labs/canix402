import algosdk from "algosdk";

const USDC_DECIMALS = 6n;
const USDC_WHOLE_UNIT = 10n ** USDC_DECIMALS;

interface CliArgs {
  to: string;
  dryRun: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mnemonic = process.env.RECEIVER_MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error("RECEIVER_MNEMONIC is required in protocol/.env.");
  }

  const usdcAssetId = Number(process.env.X402_USDC_ASSET_ID ?? "31566704");
  if (!Number.isInteger(usdcAssetId) || usdcAssetId <= 0) {
    throw new Error(`Invalid X402_USDC_ASSET_ID '${process.env.X402_USDC_ASSET_ID}'.`);
  }

  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const from = account.addr.toString();
  const expectedPayTo = process.env.X402_PAYMENT_RECEIVER_ADDRESS?.trim();
  if (expectedPayTo && expectedPayTo !== from) {
    throw new Error(
      `RECEIVER_MNEMONIC address ${from} does not match X402_PAYMENT_RECEIVER_ADDRESS ${expectedPayTo}.`
    );
  }

  if (args.to === from) {
    throw new Error("Destination --to must differ from the pay-to (RECEIVER_MNEMONIC) address.");
  }

  const algod = createAlgodClient();
  const balanceMicro = await fetchUsdcBalanceMicro(algod, from, usdcAssetId);
  const sendMicro = (balanceMicro / USDC_WHOLE_UNIT) * USDC_WHOLE_UNIT;
  const remainderMicro = balanceMicro - sendMicro;

  const summary = {
    from,
    to: args.to,
    usdcAssetId,
    balanceUsdc: formatUsdc(balanceMicro),
    sendUsdc: formatUsdc(sendMicro),
    remainderUsdc: formatUsdc(remainderMicro),
    balanceMicroUsdc: balanceMicro.toString(),
    sendMicroUsdc: sendMicro.toString(),
    dryRun: args.dryRun
  };

  if (sendMicro === 0n) {
    console.log(
      JSON.stringify(
        {
          ...summary,
          status: "skipped",
          reason: "USDC balance rounds down to 0 whole units."
        },
        null,
        2
      )
    );
    return;
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ ...summary, status: "dry-run" }, null, 2));
    return;
  }

  const suggested = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    receiver: args.to,
    amount: sendMicro,
    assetIndex: BigInt(usdcAssetId),
    suggestedParams: suggested
  });
  const signed = txn.signTxn(account.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 8);

  console.log(JSON.stringify({ ...summary, status: "sent", txid }, null, 2));
}

function parseArgs(argv: string[]): CliArgs {
  let to: string | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--to") {
      to = argv[index + 1];
      index += 1;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  if (!to) {
    throw new Error("--to <Algorand address> is required.");
  }
  if (!algosdk.isValidAddress(to)) {
    throw new Error(`'${to}' is not a valid Algorand address.`);
  }

  return { to, dryRun };
}

function createAlgodClient(): algosdk.Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

async function fetchUsdcBalanceMicro(
  algod: algosdk.Algodv2,
  address: string,
  usdcAssetId: number
): Promise<bigint> {
  const info = await algod.accountInformation(address).do();
  const assets = (info.assets ?? []) as Array<{
    assetId?: number | bigint;
    "asset-id"?: number | bigint;
    amount: number | bigint;
  }>;

  for (const holding of assets) {
    const assetId = Number(holding.assetId ?? holding["asset-id"]);
    if (assetId === usdcAssetId) {
      return typeof holding.amount === "bigint"
        ? holding.amount
        : BigInt(Math.trunc(holding.amount));
    }
  }

  return 0n;
}

function formatUsdc(micro: bigint): string {
  const whole = micro / USDC_WHOLE_UNIT;
  const frac = micro % USDC_WHOLE_UNIT;
  return `${whole}.${frac.toString().padStart(Number(USDC_DECIMALS), "0")}`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function printUsage(): void {
  console.log(
    [
      "Usage: npm run sweep:usdc -- --to <Algorand address> [--dry-run]",
      "",
      "Sends the pay-to wallet's entire USDC balance, rounded down to whole USDC,",
      "from RECEIVER_MNEMONIC to --to. Fractional USDC remains on pay-to.",
      "",
      "Env: RECEIVER_MNEMONIC, X402_ALGOD_URL, X402_ALGOD_TOKEN,",
      "     X402_USDC_ASSET_ID (default 31566704), optional X402_PAYMENT_RECEIVER_ADDRESS"
    ].join("\n")
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sweep-usdc: ${message}`);
  printUsage();
  process.exitCode = 1;
});
