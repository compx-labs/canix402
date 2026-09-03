import assert from "node:assert/strict";

import algosdk from "algosdk";

import type { SerializedTransaction } from "../../src/execution/types.js";

/**
 * Compact, fixture-friendly view of a compiled group. Integers stay strings
 * (via serializeTransaction) and object keys are sorted so assertions stay
 * deterministic without committed golden JSON blobs.
 */
export interface GoldenGroupMember {
  type: string;
  fee: string;
  appIndex: string | null;
  amount: string | null;
  assetIndex: string | null;
  receiver: string | null;
}

export interface GoldenGroup {
  types: string[];
  members: GoldenGroupMember[];
  userSignIndexes: number[];
}

export function goldenGroupFromTransactions(
  transactions: readonly SerializedTransaction[],
  userSignIndexes?: readonly number[]
): GoldenGroup {
  return {
    types: transactions.map((txn) => txn.type),
    members: transactions.map(summarizeMember),
    userSignIndexes:
      userSignIndexes === undefined
        ? transactions.map((_, index) => index)
        : [...userSignIndexes]
  };
}

export function assertGoldenGroup(
  transactions: readonly SerializedTransaction[],
  expected: GoldenGroup,
  userSignIndexes?: readonly number[]
): void {
  assert.deepEqual(
    sortKeys(goldenGroupFromTransactions(transactions, userSignIndexes)),
    sortKeys(expected)
  );
}

export function assertEncodedGroupIsValid(encodedTransactions: readonly string[]): void {
  const transactions = encodedTransactions.map((encoded) =>
    algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64"))
  );
  if (transactions.length <= 1) {
    return;
  }
  const groupIds = transactions.map((txn) => Buffer.from(txn.group ?? []).toString("base64"));
  assert.ok(groupIds.every((groupId) => groupId.length > 0));

  const ungroupedTransactions = transactions.map((txn) =>
    algosdk.decodeUnsignedTransaction(algosdk.encodeUnsignedTransaction(txn))
  );
  ungroupedTransactions.forEach((txn) => {
    txn.group = undefined;
  });

  const computedGroupId = Buffer.from(algosdk.computeGroupID(ungroupedTransactions)).toString(
    "base64"
  );
  assert.deepEqual(groupIds, new Array(groupIds.length).fill(computedGroupId));
}

export function dumpComposerGroup(atc: algosdk.AtomicTransactionComposer): algosdk.Transaction[] {
  const txns = atc.buildGroup().map((member) => member.txn);
  for (const txn of txns) {
    txn.group = undefined;
  }
  algosdk.assignGroupID(txns);
  return txns;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function summarizeMember(txn: SerializedTransaction): GoldenGroupMember {
  return {
    type: txn.type,
    fee: txn.fee,
    appIndex: txn.applicationCall?.appIndex ?? null,
    amount: txn.payment?.amount ?? txn.assetTransfer?.amount ?? null,
    assetIndex: txn.assetTransfer?.assetIndex ?? null,
    receiver: txn.payment?.receiver ?? txn.assetTransfer?.receiver ?? null
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
