import algosdk, { Transaction } from "algosdk";

import {
  executeHogswapQuote,
  HogswapClientError,
  HogswapMissingOptInError,
  HogswapQuoteExpiredError,
  HOGSWAP_QUOTE_TTL_MS,
  type HogswapExecuteResult,
  type HogswapQuote
} from "../../../services/hogswap-client.js";
import { ShapeBuildError, ShapeStateError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import { HIGH_SLIPPAGE_BPS } from "./parse-input.js";
import type {
  SerializedTransaction,
  ShapeBuildContext,
  ShapeValidationResult
} from "../../types.js";

const STALE_QUOTE_WARNING =
  "HOGSWAP quotes expire in ~30s (stale-quote). Submit before expiresAt; after opt-in confirmation, re-quote.";

const LP_OPT_IN_WARNING =
  "Wallet must already be opted into the STAMM LP ASA before /execute. Opt-in is a separate group and is never merged.";

export interface StammHogswapLpState {
  quote: HogswapQuote;
  execute: HogswapExecuteResult;
  transactions: Transaction[];
}

interface StammHogswapGroupDependencies {
  executeQuote: typeof executeHogswapQuote;
}

let groupDependencyOverrides: Partial<StammHogswapGroupDependencies> | undefined;

export function setStammHogswapGroupDependenciesForTests(
  overrides?: Partial<StammHogswapGroupDependencies>
): void {
  groupDependencyOverrides = overrides;
}

function resolveGroupDependencies(): StammHogswapGroupDependencies {
  return {
    executeQuote: executeHogswapQuote,
    ...groupDependencyOverrides
  };
}

export async function executeQuotedGroup(
  context: ShapeBuildContext,
  quote: HogswapQuote,
  userAddress: string
): Promise<{ execute: HogswapExecuteResult; transactions: Transaction[] }> {
  const now = context.now?.() ?? Date.now();
  const ageMs = now - quote.quotedAtMs;
  if (ageMs >= (context.quoteTtlMs ?? HOGSWAP_QUOTE_TTL_MS)) {
    throw new ShapeStateError(
      "HOGSWAP LP quote expired before execute (stale-quote). Request a fresh quote.",
      { details: { quoteId: quote.quoteId, ageMs } }
    );
  }

  let execute: HogswapExecuteResult;
  try {
    execute = await resolveGroupDependencies().executeQuote(quote.quoteId, userAddress);
  } catch (error) {
    throw mapHogswapExecuteError(error);
  }

  let transactions: Transaction[];
  try {
    transactions = normalizeTransactions(
      execute.unsignedGroup.map((member) =>
        algosdk.decodeUnsignedTransaction(Buffer.from(member.txnB64, "base64"))
      )
    );
  } catch (error) {
    throw new ShapeBuildError("Failed to decode HOGSWAP unsigned LP group.", {
      cause: error
    });
  }

  return { execute, transactions };
}

export function mapHogswapQuoteError(error: unknown): ShapeStateError {
  if (error instanceof ShapeStateError) {
    return error;
  }
  if (error instanceof HogswapMissingOptInError) {
    const assets =
      error.assetIds.length > 0 ? ` Missing opt-in for asset(s): ${error.assetIds.join(", ")}.` : "";
    return new ShapeStateError(
      `HOGSWAP LP quote failed because the wallet is missing a required ASA opt-in.${assets} Opt-in first, then re-quote.`,
      { cause: error, details: { assetIds: error.assetIds } }
    );
  }
  if (error instanceof HogswapQuoteExpiredError) {
    return new ShapeStateError(
      "HOGSWAP LP quote expired (stale-quote). Request a fresh quote.",
      { cause: error }
    );
  }
  if (error instanceof HogswapClientError) {
    return new ShapeStateError(`HOGSWAP LP quote failed: ${error.message}`, {
      cause: error,
      details: { status: error.status }
    });
  }
  return new ShapeStateError("Failed to quote STAMM LP via HOGSWAP.", { cause: error });
}

export function mapHogswapExecuteError(error: unknown): ShapeStateError | ShapeBuildError {
  if (error instanceof ShapeStateError || error instanceof ShapeBuildError) {
    return error;
  }
  if (error instanceof HogswapMissingOptInError) {
    const assets =
      error.assetIds.length > 0 ? ` Missing opt-in for asset(s): ${error.assetIds.join(", ")}.` : "";
    return new ShapeStateError(
      `HOGSWAP LP execute failed because the wallet is missing a required ASA opt-in.${assets} Opt-in first, then re-quote.`,
      { cause: error, details: { assetIds: error.assetIds } }
    );
  }
  if (error instanceof HogswapQuoteExpiredError) {
    return new ShapeStateError(
      "HOGSWAP LP quote expired before execute (stale-quote). Request a fresh quote.",
      { cause: error }
    );
  }
  if (error instanceof HogswapClientError) {
    return new ShapeBuildError(`HOGSWAP LP execute failed: ${error.message}`, {
      cause: error,
      details: { status: error.status }
    });
  }
  return new ShapeBuildError("Failed to build STAMM LP group via HOGSWAP.", { cause: error });
}

export function stammLpBuildWarnings(input: {
  maxSlippageBps: number;
  quoteAgeMs: number;
  quoteTtlMs: number;
}): string[] {
  const warnings = [LP_OPT_IN_WARNING, STALE_QUOTE_WARNING];
  if (input.maxSlippageBps >= HIGH_SLIPPAGE_BPS) {
    warnings.push(
      `Tolerated slippage is high (${input.maxSlippageBps} bps); confirm this is intentional.`
    );
  }
  if (input.quoteAgeMs > input.quoteTtlMs / 2) {
    warnings.push(
      `HOGSWAP quote is ${Math.round(input.quoteAgeMs / 1000)}s old; submit before expiry or re-quote.`
    );
  }
  return warnings;
}

export function validateStammHogswapGroup(
  group: readonly SerializedTransaction[],
  input: { userAddress: string },
  state: StammHogswapLpState
): ShapeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (group.length === 0) {
    errors.push("Expected a non-empty HOGSWAP unsigned group.");
    return { valid: false, errors, warnings };
  }

  if (group.length > 1 && group.some((txn) => !txn.groupPresent)) {
    errors.push("All transactions must belong to a single atomic group.");
  }

  for (const [index, txn] of group.entries()) {
    if (txn.sender !== input.userAddress) {
      errors.push(`Transaction ${index + 1} sender must be the user address.`);
    }
  }

  const appCalls = group.filter((txn) => txn.type === "appl" && txn.applicationCall);
  if (appCalls.length === 0) {
    errors.push("Group must include at least one application call targeting the current HOGSWAP router.");
  } else {
    const routerIds = new Set(
      appCalls.map((txn) => txn.applicationCall?.appIndex).filter((id): id is string => Boolean(id))
    );
    if (!routerIds.has(String(state.execute.routerAppId))) {
      errors.push(
        `Group application call must target the HOGSWAP router from /execute (${state.execute.routerAppId}).`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
