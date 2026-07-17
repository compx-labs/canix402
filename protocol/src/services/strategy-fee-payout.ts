import algosdk from "algosdk";

import {
  STRATEGY_HOLDER_FEE_SHARE_BPS,
  STRATEGY_WEIGHT_BPS_TOTAL
} from "../types/strategy-schema.js";
import {
  buildStrategyPaymentNote,
  buildStrategyPayoutNote
} from "./strategies.js";

const ACCESS_NOTE_PREFIX = "x402:v2:strategy:";
const PAYOUT_NOTE_PREFIX = "x402:v2:strategy-payout:";
const MIN_PAYOUT_MICRO_USDC = 10_000n; // 0.01 USDC

export interface StrategyAccessPayment {
  strategyId: number;
  amountMicroUsdc: bigint;
  confirmedRound: number;
  txid: string;
  payer?: string;
}

export interface HolderShareAccrual {
  strategyId: number;
  holderAddress: string;
  shareMicroUsdc: bigint;
  accessPaymentCount: number;
}

export interface WeeklyPayoutPlan {
  week: string;
  accruals: HolderShareAccrual[];
  skippedDust: HolderShareAccrual[];
  alreadyPaidStrategyIds: number[];
}

export interface StrategyFeePayoutOptions {
  indexerUrl: string;
  indexerToken?: string;
  payToAddress: string;
  payoutAddress: string;
  usdcAssetId: number;
  afterTime: string;
  beforeTime: string;
  week: string;
  dryRun?: boolean;
  resolveHolderAtRound?: (
    strategyId: number,
    round: number
  ) => Promise<string | undefined>;
  sendPayout?: (input: {
    receiver: string;
    amountMicroUsdc: bigint;
    note: string;
  }) => Promise<string>;
}

export function parseStrategyIdFromAccessNote(note: string): number | undefined {
  if (!note.startsWith(ACCESS_NOTE_PREFIX)) {
    return undefined;
  }
  const raw = note.slice(ACCESS_NOTE_PREFIX.length);
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function parseStrategyIdFromPayoutNote(
  note: string,
  week: string
): number | undefined {
  const prefix = `${PAYOUT_NOTE_PREFIX}${week}:`;
  if (!note.startsWith(prefix)) {
    return undefined;
  }
  const id = Number(note.slice(prefix.length));
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function holderShareMicroUsdc(grossMicroUsdc: bigint): bigint {
  return (grossMicroUsdc * BigInt(STRATEGY_HOLDER_FEE_SHARE_BPS)) / BigInt(STRATEGY_WEIGHT_BPS_TOTAL);
}

export function isoWeekKey(date: Date = new Date()): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function fetchStrategyAccessPayments(
  options: Pick<
    StrategyFeePayoutOptions,
    "indexerUrl" | "indexerToken" | "payToAddress" | "usdcAssetId" | "afterTime" | "beforeTime"
  >
): Promise<StrategyAccessPayment[]> {
  const base = options.indexerUrl.replace(/\/$/, "");
  const payments: StrategyAccessPayment[] = [];
  let nextToken: string | undefined;

  do {
    const url = new URL(`${base}/v2/transactions`);
    url.searchParams.set("address", options.payToAddress);
    url.searchParams.set("asset-id", String(options.usdcAssetId));
    url.searchParams.set("tx-type", "axfer");
    url.searchParams.set("after-time", options.afterTime);
    url.searchParams.set("before-time", options.beforeTime);
    url.searchParams.set("limit", "1000");
    if (nextToken) {
      url.searchParams.set("next", nextToken);
    }

    const response = await fetchWithOptionalIndexerToken(url, options.indexerToken);
    if (!response.ok) {
      throw new Error(`Indexer access scan failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      "next-token"?: string;
      transactions?: Array<{
        id?: string;
        "confirmed-round"?: number;
        sender?: string;
        note?: string;
        "asset-transfer-transaction"?: {
          amount?: number | string;
          receiver?: string;
        };
      }>;
    };

    for (const txn of payload.transactions ?? []) {
      const axfer = txn["asset-transfer-transaction"];
      if (!axfer || axfer.receiver !== options.payToAddress) {
        continue;
      }
      const note = decodeNote(txn.note);
      const strategyId = parseStrategyIdFromAccessNote(note);
      if (strategyId === undefined) {
        continue;
      }
      const payment: StrategyAccessPayment = {
        strategyId,
        amountMicroUsdc: BigInt(axfer.amount ?? 0),
        confirmedRound: Number(txn["confirmed-round"] ?? 0),
        txid: txn.id ?? ""
      };
      if (txn.sender) {
        payment.payer = txn.sender;
      }
      payments.push(payment);
    }

    nextToken = payload["next-token"];
  } while (nextToken);

  return payments;
}

export async function fetchPaidOutStrategyIds(
  options: Pick<
    StrategyFeePayoutOptions,
    "indexerUrl" | "indexerToken" | "payoutAddress" | "usdcAssetId" | "week"
  >
): Promise<Set<number>> {
  const base = options.indexerUrl.replace(/\/$/, "");
  const paid = new Set<number>();
  let nextToken: string | undefined;

  do {
    const url = new URL(`${base}/v2/accounts/${options.payoutAddress}/transactions`);
    url.searchParams.set("asset-id", String(options.usdcAssetId));
    url.searchParams.set("tx-type", "axfer");
    url.searchParams.set("limit", "1000");
    if (nextToken) {
      url.searchParams.set("next", nextToken);
    }

    const response = await fetchWithOptionalIndexerToken(url, options.indexerToken);
    if (!response.ok) {
      throw new Error(`Indexer payout scan failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      "next-token"?: string;
      transactions?: Array<{
        note?: string;
        sender?: string;
        "asset-transfer-transaction"?: { amount?: number | string };
      }>;
    };

    for (const txn of payload.transactions ?? []) {
      if (txn.sender !== options.payoutAddress) {
        continue;
      }
      const note = decodeNote(txn.note);
      const strategyId = parseStrategyIdFromPayoutNote(note, options.week);
      if (strategyId !== undefined) {
        paid.add(strategyId);
      }
    }

    nextToken = payload["next-token"];
  } while (nextToken);

  return paid;
}

export async function buildWeeklyPayoutPlan(
  options: StrategyFeePayoutOptions
): Promise<WeeklyPayoutPlan> {
  const accessPayments = await fetchStrategyAccessPayments(options);
  const alreadyPaid = await fetchPaidOutStrategyIds(options);
  const resolveHolder =
    options.resolveHolderAtRound ?? defaultResolveHolderAtRound(options);

  type MutableAccrual = {
    strategyId: number;
    holderAddress: string;
    shareMicroUsdc: bigint;
    accessPaymentCount: number;
  };

  const byKey = new Map<string, MutableAccrual>();

  for (const payment of accessPayments) {
    if (alreadyPaid.has(payment.strategyId)) {
      continue;
    }
    const holder = await resolveHolder(payment.strategyId, payment.confirmedRound);
    if (!holder) {
      continue;
    }
    const share = holderShareMicroUsdc(payment.amountMicroUsdc);
    const key = `${payment.strategyId}:${holder}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.shareMicroUsdc += share;
      existing.accessPaymentCount += 1;
    } else {
      byKey.set(key, {
        strategyId: payment.strategyId,
        holderAddress: holder,
        shareMicroUsdc: share,
        accessPaymentCount: 1
      });
    }
  }

  const accruals: HolderShareAccrual[] = [];
  const skippedDust: HolderShareAccrual[] = [];
  for (const row of byKey.values()) {
    const accrual = {
      strategyId: row.strategyId,
      holderAddress: row.holderAddress,
      shareMicroUsdc: row.shareMicroUsdc,
      accessPaymentCount: row.accessPaymentCount
    };
    if (row.shareMicroUsdc < MIN_PAYOUT_MICRO_USDC) {
      skippedDust.push(accrual);
    } else {
      accruals.push(accrual);
    }
  }

  return {
    week: options.week,
    accruals,
    skippedDust,
    alreadyPaidStrategyIds: [...alreadyPaid].sort((a, b) => a - b)
  };
}

export async function executeWeeklyPayouts(
  options: StrategyFeePayoutOptions
): Promise<{
  plan: WeeklyPayoutPlan;
  sent: Array<{ strategyId: number; receiver: string; amountMicroUsdc: string; txid: string }>;
}> {
  const plan = await buildWeeklyPayoutPlan(options);
  const send =
    options.sendPayout ??
    createDefaultSendPayout({
      mnemonic: process.env.STRATEGY_PAYOUT_MNEMONIC?.trim() ?? "",
      algodUrl: process.env.X402_ALGOD_URL?.trim() ?? "",
      algodToken: process.env.X402_ALGOD_TOKEN?.trim() ?? "",
      usdcAssetId: options.usdcAssetId,
      payoutAddress: options.payoutAddress
    });

  const sent: Array<{
    strategyId: number;
    receiver: string;
    amountMicroUsdc: string;
    txid: string;
  }> = [];

  if (options.dryRun) {
    return { plan, sent };
  }

  for (const accrual of plan.accruals) {
    const note = buildStrategyPayoutNote(options.week, accrual.strategyId);
    const txid = await send({
      receiver: accrual.holderAddress,
      amountMicroUsdc: accrual.shareMicroUsdc,
      note
    });
    sent.push({
      strategyId: accrual.strategyId,
      receiver: accrual.holderAddress,
      amountMicroUsdc: accrual.shareMicroUsdc.toString(),
      txid
    });
  }

  return { plan, sent };
}

function decodeNote(note: string | undefined): string {
  if (!note) {
    return "";
  }
  try {
    return Buffer.from(note, "base64").toString("utf8");
  } catch {
    return note;
  }
}

function defaultResolveHolderAtRound(
  options: Pick<StrategyFeePayoutOptions, "indexerUrl" | "indexerToken">
) {
  return async (strategyId: number, _round: number): Promise<string | undefined> => {
    // Indexer historical-at-round balance lookups vary by provider; v1 uses
    // current holder. Prefer round-aware resolution when available.
    void _round;
    const base = options.indexerUrl.replace(/\/$/, "");
    const url = `${base}/v2/assets/${strategyId}/balances?currency-greater-than=0`;
    const response = await fetchWithOptionalIndexerToken(url, options.indexerToken);
    if (!response.ok) {
      return undefined;
    }
    const payload = (await response.json()) as {
      balances?: Array<{ address?: string; amount?: number | string }>;
    };
    const holder = payload.balances?.find((row) => Number(row.amount ?? 0) > 0);
    return holder?.address;
  };
}

function createDefaultSendPayout(input: {
  mnemonic: string;
  algodUrl: string;
  algodToken: string;
  usdcAssetId: number;
  payoutAddress: string;
}) {
  return async (params: {
    receiver: string;
    amountMicroUsdc: bigint;
    note: string;
  }): Promise<string> => {
    if (!input.mnemonic || !input.algodUrl) {
      throw new Error("STRATEGY_PAYOUT_MNEMONIC and X402_ALGOD_URL are required to send payouts.");
    }
    const account = algosdk.mnemonicToSecretKey(input.mnemonic);
    if (account.addr.toString() !== input.payoutAddress) {
      throw new Error(
        `STRATEGY_PAYOUT_MNEMONIC address ${account.addr} does not match STRATEGY_PAYOUT_ADDRESS ${input.payoutAddress}.`
      );
    }
    const algod = new algosdk.Algodv2(input.algodToken, input.algodUrl, "");
    const suggested = await algod.getTransactionParams().do();
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: params.receiver,
      amount: params.amountMicroUsdc,
      assetIndex: BigInt(input.usdcAssetId),
      note: new TextEncoder().encode(params.note),
      suggestedParams: suggested
    });
    const signed = txn.signTxn(account.sk);
    const { txid } = await algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(algod, txid, 8);
    return txid;
  };
}

export { buildStrategyPaymentNote, buildStrategyPayoutNote, MIN_PAYOUT_MICRO_USDC };

function fetchWithOptionalIndexerToken(
  url: string | URL,
  token?: string
): Promise<Response> {
  if (token) {
    return fetch(url, { headers: { "X-Indexer-API-Token": token } });
  }
  return fetch(url);
}
