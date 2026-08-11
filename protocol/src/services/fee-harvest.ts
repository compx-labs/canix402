import algosdk from "algosdk";

import { getAppLogger } from "../observability/logger.js";

const USDC_DECIMALS = 6n;
const USDC_WHOLE_UNIT = 10n ** USDC_DECIMALS;

/** 30% fee share recipient. */
export const FEE_HARVEST_RECIPIENT_A =
  "THJ3BPQX3PM5NCWFVANC7D5HE3JIN2W5GMLLX3P5AON32W55VFCIBGASBI";

/** 30% fee share recipient. */
export const FEE_HARVEST_RECIPIENT_B =
  "5YCWR662A5HIOFYYS2CTIHHYBCIXESVLAOVLZ7CL27PK5SKBROCSRFIJMA";

/** 40% fee share recipient (absorbs integer remainder). */
export const FEE_HARVEST_RECIPIENT_C =
  "KPEZM2DSFHOOHG7RPDECCBTD6FRN2LPSSRJMMFVCFSIHGES4BXBJHPUBVQ";

export const FEE_HARVEST_RECIPIENTS = [
  { address: FEE_HARVEST_RECIPIENT_A, label: "30a" as const },
  { address: FEE_HARVEST_RECIPIENT_B, label: "30b" as const },
  { address: FEE_HARVEST_RECIPIENT_C, label: "40" as const }
] as const;

export interface FeeHarvestSplit {
  /** Whole USDC units after flooring the pay-to balance. */
  wholeUsdc: bigint;
  /** MicroUSDC total to send (wholeUsdc * 1e6). */
  sendMicro: bigint;
  /** MicroUSDC to recipient A (30%, floored). */
  amountAMicro: bigint;
  /** MicroUSDC to recipient B (30%, floored). */
  amountBMicro: bigint;
  /** MicroUSDC to recipient C (40% + remainder). */
  amountCMicro: bigint;
}

export type FeeHarvestStatus = "skipped" | "sent" | "dry-run";

export interface FeeHarvestTransferResult {
  address: string;
  label: "30a" | "30b" | "40";
  amountMicroUsdc: string;
  amountUsdc: string;
  txid?: string;
}

export interface FeeHarvestResult {
  status: FeeHarvestStatus;
  from: string;
  usdcAssetId: number;
  balanceMicroUsdc: string;
  balanceUsdc: string;
  sendMicroUsdc: string;
  sendUsdc: string;
  remainderMicroUsdc: string;
  remainderUsdc: string;
  note: string;
  transfers: FeeHarvestTransferResult[];
  reason?: string;
  groupId?: string;
}

export interface FeeHarvestOptions {
  dryRun?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: Date;
  env?: NodeJS.ProcessEnv;
  algod?: algosdk.Algodv2;
}

/**
 * Floor microUSDC to whole USDC units (same as sweep-usdc CLI).
 */
export function floorToWholeUsdcMicro(balanceMicro: bigint): bigint {
  return (balanceMicro / USDC_WHOLE_UNIT) * USDC_WHOLE_UNIT;
}

/**
 * Split floored whole USDC into 30/30/40. Recipient C absorbs remainder so
 * amounts always sum to `wholeUsdc`.
 */
export function splitFeeHarvestWholeUsdc(wholeUsdc: bigint): FeeHarvestSplit {
  if (wholeUsdc < 0n) {
    throw new Error("wholeUsdc must be non-negative.");
  }
  const a = (wholeUsdc * 30n) / 100n;
  const b = (wholeUsdc * 30n) / 100n;
  const c = wholeUsdc - a - b;
  return {
    wholeUsdc,
    sendMicro: wholeUsdc * USDC_WHOLE_UNIT,
    amountAMicro: a * USDC_WHOLE_UNIT,
    amountBMicro: b * USDC_WHOLE_UNIT,
    amountCMicro: c * USDC_WHOLE_UNIT
  };
}

/**
 * Build the on-chain note: `Canix402 fees YYYY-MM-DD` (UTC).
 */
export function buildFeeHarvestNote(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `Canix402 fees ${year}-${month}-${day}`;
}

export function formatUsdcFromMicro(micro: bigint): string {
  const whole = micro / USDC_WHOLE_UNIT;
  const frac = micro % USDC_WHOLE_UNIT;
  return `${whole}.${frac.toString().padStart(Number(USDC_DECIMALS), "0")}`;
}

/**
 * Harvest floored USDC from the pay-to wallet and send 30/30/40 to fee recipients
 * as an atomic axfer group with dated notes.
 */
export async function runFeeHarvest(
  options: FeeHarvestOptions = {}
): Promise<FeeHarvestResult> {
  const env = options.env ?? process.env;
  const dryRun = options.dryRun === true;
  const now = options.now ?? new Date();
  const note = buildFeeHarvestNote(now);

  const mnemonic = env.RECEIVER_MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error("RECEIVER_MNEMONIC is required for fee harvest.");
  }

  const usdcAssetId = Number(env.X402_USDC_ASSET_ID ?? "31566704");
  if (!Number.isInteger(usdcAssetId) || usdcAssetId <= 0) {
    throw new Error(`Invalid X402_USDC_ASSET_ID '${env.X402_USDC_ASSET_ID}'.`);
  }

  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const from = account.addr.toString();
  const expectedPayTo = env.X402_PAYMENT_RECEIVER_ADDRESS?.trim();
  if (expectedPayTo && expectedPayTo !== from) {
    throw new Error(
      `RECEIVER_MNEMONIC address ${from} does not match X402_PAYMENT_RECEIVER_ADDRESS ${expectedPayTo}.`
    );
  }

  for (const recipient of FEE_HARVEST_RECIPIENTS) {
    if (recipient.address === from) {
      throw new Error(
        `Fee harvest recipient ${recipient.label} must differ from the pay-to address.`
      );
    }
    if (!algosdk.isValidAddress(recipient.address)) {
      throw new Error(`Fee harvest recipient ${recipient.label} is not a valid address.`);
    }
  }

  const algod = options.algod ?? createAlgodClient(env);
  const balanceMicro = await fetchUsdcBalanceMicro(algod, from, usdcAssetId);
  const sendMicro = floorToWholeUsdcMicro(balanceMicro);
  const remainderMicro = balanceMicro - sendMicro;
  const wholeUsdc = sendMicro / USDC_WHOLE_UNIT;
  const split = splitFeeHarvestWholeUsdc(wholeUsdc);

  const transferPlan: FeeHarvestTransferResult[] = [
    {
      address: FEE_HARVEST_RECIPIENT_A,
      label: "30a",
      amountMicroUsdc: split.amountAMicro.toString(),
      amountUsdc: formatUsdcFromMicro(split.amountAMicro)
    },
    {
      address: FEE_HARVEST_RECIPIENT_B,
      label: "30b",
      amountMicroUsdc: split.amountBMicro.toString(),
      amountUsdc: formatUsdcFromMicro(split.amountBMicro)
    },
    {
      address: FEE_HARVEST_RECIPIENT_C,
      label: "40",
      amountMicroUsdc: split.amountCMicro.toString(),
      amountUsdc: formatUsdcFromMicro(split.amountCMicro)
    }
  ];

  const base: FeeHarvestResult = {
    status: "skipped",
    from,
    usdcAssetId,
    balanceMicroUsdc: balanceMicro.toString(),
    balanceUsdc: formatUsdcFromMicro(balanceMicro),
    sendMicroUsdc: sendMicro.toString(),
    sendUsdc: formatUsdcFromMicro(sendMicro),
    remainderMicroUsdc: remainderMicro.toString(),
    remainderUsdc: formatUsdcFromMicro(remainderMicro),
    note,
    transfers: transferPlan
  };

  if (sendMicro === 0n) {
    const skipped: FeeHarvestResult = {
      ...base,
      status: "skipped",
      reason: "USDC balance rounds down to 0 whole units."
    };
    getAppLogger().info({ event: "fee_harvest", ...skipped }, "Fee harvest skipped");
    return skipped;
  }

  // Drop zero-amount legs (possible when wholeUsdc is 1–2) while keeping group valid.
  const nonZeroTransfers = transferPlan.filter((t) => BigInt(t.amountMicroUsdc) > 0n);
  if (nonZeroTransfers.length === 0) {
    const skipped: FeeHarvestResult = {
      ...base,
      status: "skipped",
      reason: "Split produced no non-zero transfers."
    };
    getAppLogger().info({ event: "fee_harvest", ...skipped }, "Fee harvest skipped");
    return skipped;
  }

  if (dryRun) {
    const dry: FeeHarvestResult = { ...base, status: "dry-run", transfers: nonZeroTransfers };
    getAppLogger().info({ event: "fee_harvest", ...dry }, "Fee harvest dry-run");
    return dry;
  }

  const suggested = await algod.getTransactionParams().do();
  const noteBytes = new TextEncoder().encode(note);
  const txns = nonZeroTransfers.map((transfer) =>
    algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: transfer.address,
      amount: BigInt(transfer.amountMicroUsdc),
      assetIndex: BigInt(usdcAssetId),
      note: noteBytes,
      suggestedParams: suggested
    })
  );

  algosdk.assignGroupID(txns);
  const signed = txns.map((txn) => txn.signTxn(account.sk));
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 8);

  const groupId = Buffer.from(txns[0]!.group!).toString("base64");
  const transfersWithTxids = nonZeroTransfers.map((transfer, index) => ({
    ...transfer,
    txid: txns[index]!.txID()
  }));

  const sent: FeeHarvestResult = {
    ...base,
    status: "sent",
    transfers: transfersWithTxids,
    groupId
  };
  getAppLogger().info({ event: "fee_harvest", ...sent }, "Fee harvest sent");
  return sent;
}

function createAlgodClient(env: NodeJS.ProcessEnv): algosdk.Algodv2 {
  const server = env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = env.X402_ALGOD_TOKEN ?? "";
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

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
