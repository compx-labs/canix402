import algosdk, { Algodv2 } from "algosdk";
import { abi, CONTRACT } from "ulujs";

import { ShapeBuildError } from "../../errors.js";
import {
  DORKFI_ALGORAND_BEACON_APP_ID,
  DORKFI_ALGORAND_ORACLE_APP_ID
} from "./constants.js";
import type { DorkFiLendingMarketState } from "./market-state.js";
import lendingPoolAbi from "./lending-pool-abi.json" with { type: "json" };
import {
  decodeUnsignedTransactions,
  encodeNote,
  poolAddressString,
  rejectUnexpectedTransactionCount
} from "./shared.js";

export interface BuildDorkFiDepositParams {
  algod: Algodv2;
  userAddress: string;
  amount: bigint;
  state: DorkFiLendingMarketState;
}

export interface BuildDorkFiWithdrawParams {
  algod: Algodv2;
  userAddress: string;
  nTokenAmount: bigint;
  state: DorkFiLendingMarketState;
}

export interface BuildDorkFiBorrowParams {
  algod: Algodv2;
  userAddress: string;
  amount: bigint;
  state: DorkFiLendingMarketState;
}

export interface BuildDorkFiRepayParams {
  algod: Algodv2;
  userAddress: string;
  amount: bigint;
  state: DorkFiLendingMarketState;
}

function makeSigner(userAddress: string): { addr: string; sk: Uint8Array } {
  return { addr: userAddress, sk: new Uint8Array() };
}

function makeBuilders(params: {
  algod: Algodv2;
  state: DorkFiLendingMarketState;
  userAddress: string;
}): {
  ci: CONTRACT;
  lending: CONTRACT;
  token: CONTRACT;
} {
  const signer = makeSigner(params.userAddress);
  const lendingABI = { ...lendingPoolAbi, events: [] as never[] };

  return {
    ci: new CONTRACT(params.state.poolAppId, params.algod, undefined, abi.custom, signer),
    lending: new CONTRACT(
      params.state.poolAppId,
      params.algod,
      undefined,
      lendingABI,
      signer,
      true,
      false,
      true
    ),
    token: new CONTRACT(
      params.state.marketAppId,
      params.algod,
      undefined,
      abi.nt200,
      signer,
      true,
      false,
      true
    )
  };
}

function configureCustomGroup(
  ci: CONTRACT,
  buildN: Record<string, unknown>[],
  fee = 20_000
): void {
  ci.setFee(fee);
  ci.setEnableGroupResourceSharing(true);
  ci.setExtraTxns(buildN);
  ci.setBeaconId(DORKFI_ALGORAND_BEACON_APP_ID);
}

export async function buildDorkFiAsaDepositTransactions(
  params: BuildDorkFiDepositParams
): Promise<algosdk.Transaction[]> {
  const { ci, lending, token } = makeBuilders({
    algod: params.algod,
    state: params.state,
    userAddress: params.userAddress
  });
  const poolAddr = poolAddressString(params.state.poolAppId);
  const approveAmount = params.amount + params.amount / 10n;
  const foreignApps = [DORKFI_ALGORAND_ORACLE_APP_ID];

  let customTx: { success?: boolean; txns?: string[] } | undefined;

  for (const [p1, p2, p3] of [
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 1],
    [1, 1, 1]
  ] as const) {
    const buildN: Record<string, unknown>[] = [];

    const payment = p1 > 0 ? 28_501 : 0;
    const depositTxn = (await token.deposit(params.amount)).obj as Record<string, unknown>;
    buildN.push({
      ...depositTxn,
      payment,
      aamt: params.amount,
      xaid: params.state.assetId,
      note: encodeNote("nt200 deposit")
    });

    const approveTxn = (await token.arc200_approve(poolAddr, approveAmount)).obj as Record<
      string,
      unknown
    >;
    buildN.push({
      ...approveTxn,
      payment: p2 > 0 ? 28_502 : 0,
      note: encodeNote("arc200 approve")
    });

    const lendingPayment = p3 > 0 ? 900_000 : 100_000;
    const lendingDepositTxn = (await lending.deposit(params.state.marketAppId, params.amount))
      .obj as Record<string, unknown>;
    buildN.push({
      ...lendingDepositTxn,
      payment: lendingPayment,
      note: encodeNote("lending deposit"),
      foreignApps
    });

    configureCustomGroup(ci, buildN);
    customTx = (await ci.custom()) as { success?: boolean; txns?: string[] };
    if (customTx.success) {
      break;
    }
  }

  if (!customTx?.success || !customTx.txns) {
    throw new ShapeBuildError("Failed to build Dork.fi ASA deposit transaction group.");
  }

  const transactions = decodeUnsignedTransactions(customTx.txns);
  rejectUnexpectedTransactionCount(transactions.length, 2, 16);
  return transactions;
}

export async function buildDorkFiAsaWithdrawTransactions(
  params: BuildDorkFiWithdrawParams
): Promise<algosdk.Transaction[]> {
  const { ci, lending, token } = makeBuilders({
    algod: params.algod,
    state: params.state,
    userAddress: params.userAddress
  });

  const buildN: Record<string, unknown>[] = [];

  const withdrawTxn = (await lending.withdraw(params.state.marketAppId, params.nTokenAmount))
    .obj as Record<string, unknown>;
  buildN.push({
    ...withdrawTxn,
    payment: 100_000,
    note: encodeNote("lending withdraw")
  });

  const unwrapTxn = (await token.withdraw(params.nTokenAmount)).obj as Record<string, unknown>;
  buildN.push({
    ...unwrapTxn,
    note: encodeNote("nt200 withdraw")
  });

  configureCustomGroup(ci, buildN);
  const customTx = (await ci.custom()) as { success?: boolean; txns?: string[] };

  if (!customTx.success || !customTx.txns) {
    throw new ShapeBuildError("Failed to build Dork.fi ASA withdraw transaction group.");
  }

  const transactions = decodeUnsignedTransactions(customTx.txns);
  rejectUnexpectedTransactionCount(transactions.length, 2, 16);
  return transactions;
}

export async function buildDorkFiAsaBorrowTransactions(
  params: BuildDorkFiBorrowParams
): Promise<algosdk.Transaction[]> {
  const { ci, lending, token } = makeBuilders({
    algod: params.algod,
    state: params.state,
    userAddress: params.userAddress
  });
  const foreignApps = [DORKFI_ALGORAND_ORACLE_APP_ID];

  let customTx: { success?: boolean; txns?: string[] } | undefined;

  for (const [p1, p2] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ] as const) {
    const buildN: Record<string, unknown>[] = [];

    if (p1 > 0) {
      const createBoxTxn = (await token.createBalanceBox(params.userAddress))
        .obj as Record<string, unknown>;
      buildN.push({
        ...createBoxTxn,
        payment: 28_500,
        note: encodeNote("nt200 createBalanceBox")
      });
    }

    const borrowPayment = p2 > 0 ? 900_000 : 100_000;
    const borrowTxn = (await lending.borrow(params.state.marketAppId, params.amount))
      .obj as Record<string, unknown>;
    buildN.push({
      ...borrowTxn,
      payment: borrowPayment,
      note: encodeNote("lending borrow"),
      foreignApps
    });

    const unwrapTxn = (await token.withdraw(params.amount)).obj as Record<string, unknown>;
    buildN.push({
      ...unwrapTxn,
      note: encodeNote("nt200 withdraw")
    });

    configureCustomGroup(ci, buildN);
    customTx = (await ci.custom()) as { success?: boolean; txns?: string[] };
    if (customTx.success) {
      break;
    }
  }

  if (!customTx?.success || !customTx.txns) {
    throw new ShapeBuildError("Failed to build Dork.fi ASA borrow transaction group.");
  }

  const transactions = decodeUnsignedTransactions(customTx.txns);
  rejectUnexpectedTransactionCount(transactions.length, 2, 16);
  return transactions;
}

export async function buildDorkFiAsaRepayTransactions(
  params: BuildDorkFiRepayParams
): Promise<algosdk.Transaction[]> {
  const { ci, lending, token } = makeBuilders({
    algod: params.algod,
    state: params.state,
    userAddress: params.userAddress
  });
  const poolAddr = poolAddressString(params.state.poolAppId);

  let customTx: { success?: boolean; txns?: string[] } | undefined;

  for (const [p1, p2] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ] as const) {
    const buildN: Record<string, unknown>[] = [];

    if (p1 > 0) {
      const createBoxTxn = (await token.createBalanceBox(params.userAddress))
        .obj as Record<string, unknown>;
      buildN.push({
        ...createBoxTxn,
        payment: 28_501,
        note: encodeNote("nt200 createBalanceBox")
      });
    }

    const depositTxn = (await token.deposit(params.amount)).obj as Record<string, unknown>;
    buildN.push({
      ...depositTxn,
      aamt: params.amount,
      xaid: params.state.assetId,
      note: encodeNote("nt200 deposit")
    });

    const approveTxn = (await token.arc200_approve(poolAddr, params.amount)).obj as Record<
      string,
      unknown
    >;
    buildN.push({
      ...approveTxn,
      payment: p2 > 0 ? 28_502 : 0,
      note: encodeNote("arc200 approve")
    });

    const repayTxn = (await lending.repay(params.state.marketAppId, params.amount)).obj as Record<
      string,
      unknown
    >;
    buildN.push({
      ...repayTxn,
      payment: 100_000,
      note: encodeNote("lending repay")
    });

    configureCustomGroup(ci, buildN, 100_000);
    customTx = (await ci.custom()) as { success?: boolean; txns?: string[] };
    if (customTx.success) {
      break;
    }
  }

  if (!customTx?.success || !customTx.txns) {
    throw new ShapeBuildError("Failed to build Dork.fi ASA repay transaction group.");
  }

  const transactions = decodeUnsignedTransactions(customTx.txns);
  rejectUnexpectedTransactionCount(transactions.length, 2, 16);
  return transactions;
}
