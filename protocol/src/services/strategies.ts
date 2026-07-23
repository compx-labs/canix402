import algosdk from "algosdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  compileExecutableQuote,
  createExecutionAlgodClient,
  executionRegistry
} from "../execution/index.js";
import type { ExecutableQuote } from "../execution/types.js";
import {
  STRATEGY_HOLDER_FEE_SHARE_BPS,
  STRATEGY_REVISE_COOLDOWN_MS,
  STRATEGY_WEIGHT_BPS_TOTAL,
  type StrategyCompileBody,
  type StrategyDocument,
  type StrategyLeg,
  type StrategyListQuery,
  type StrategyPublishBody,
  type StrategyReviseBody
} from "../types/strategy-schema.js";
import { resolvePublicBaseUrl } from "../constants/public-url.js";
import {
  createStrategyStoreFromEnv,
  type StrategyStore
} from "./strategy-store.js";

export class StrategyValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "STRATEGY_VALIDATION_ERROR";

  constructor(
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "StrategyValidationError";
  }
}

export class StrategyNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "STRATEGY_NOT_FOUND";

  constructor(strategyId: number) {
    super(`Strategy ${strategyId} was not found.`);
    this.name = "StrategyNotFoundError";
  }
}

export class StrategyForbiddenError extends Error {
  readonly statusCode = 403;
  readonly code = "STRATEGY_FORBIDDEN";

  constructor(message: string) {
    super(message);
    this.name = "StrategyForbiddenError";
  }
}

export class StrategyConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "STRATEGY_CONFLICT";

  constructor(message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "StrategyConflictError";
  }
}

export interface StrategyServiceOptions {
  store?: StrategyStore;
  now?: () => Date;
  mintStrategyNft?: (input: {
    name: string;
    unitName: string;
    creatorAddress: string;
  }) => Promise<number>;
  resolveNftHolder?: (strategyId: number) => Promise<string | undefined>;
}

let singleton: StrategyService | undefined;

export function getStrategyService(): StrategyService {
  singleton ??= new StrategyService();
  return singleton;
}

/** Test-only: clear the process singleton so env/store wiring can be re-bound. */
export function resetStrategyServiceForTests(): void {
  singleton = undefined;
}

export class StrategyService {
  private readonly store: StrategyStore;
  private readonly now: () => Date;
  private readonly mintStrategyNft: StrategyServiceOptions["mintStrategyNft"];
  private readonly resolveNftHolder: StrategyServiceOptions["resolveNftHolder"];

  constructor(options: StrategyServiceOptions = {}) {
    this.store = options.store ?? createStrategyStoreFromEnv();
    this.now = options.now ?? (() => new Date());
    this.mintStrategyNft = options.mintStrategyNft ?? defaultMintStrategyNft;
    this.resolveNftHolder = options.resolveNftHolder ?? defaultResolveNftHolder;
  }

  validateLegs(legs: StrategyLeg[]): void {
    const weightSum = legs.reduce((sum, leg) => sum + leg.weightBps, 0);
    if (weightSum !== STRATEGY_WEIGHT_BPS_TOTAL) {
      throw new StrategyValidationError(
        `Strategy leg weightBps must sum to ${STRATEGY_WEIGHT_BPS_TOTAL}.`,
        { weightSum, expected: STRATEGY_WEIGHT_BPS_TOTAL }
      );
    }

    for (const [index, leg] of legs.entries()) {
      if (!executionRegistry.has(leg.shapeKey)) {
        throw new StrategyValidationError(
          `Unknown or unverified shapeKey at legs[${index}].`,
          { shapeKey: leg.shapeKey, legIndex: index }
        );
      }
      if (!leg.opportunityId && (!leg.venueIds || leg.venueIds.length === 0)) {
        throw new StrategyValidationError(
          `legs[${index}] must include opportunityId or venueIds.`,
          { legIndex: index }
        );
      }
    }
  }

  async publish(body: StrategyPublishBody): Promise<StrategyDocument> {
    assertNoRawTransactions(body as Record<string, unknown>);
    this.validateLegs(body.legs);

    if (!algosdk.isValidAddress(body.creatorAddress)) {
      throw new StrategyValidationError("creatorAddress is not a valid Algorand address.");
    }

    const unitName = deriveUnitName(body.name);
    const strategyId = await this.mintStrategyNft!({
      name: body.name.slice(0, 32),
      unitName,
      creatorAddress: body.creatorAddress
    });

    const timestamp = this.now().toISOString();
    const document: StrategyDocument = {
      schemaVersion: 1,
      strategyId,
      creatorAddress: body.creatorAddress,
      createdAt: timestamp,
      lastRevisedAt: timestamp,
      name: body.name,
      description: body.description,
      tags: body.tags ?? [],
      status: "published",
      legs: body.legs,
      holderFeeShareBps: STRATEGY_HOLDER_FEE_SHARE_BPS
    };

    await this.store.put(document);
    return document;
  }

  async revise(
    strategyId: number,
    body: StrategyReviseBody
  ): Promise<StrategyDocument> {
    assertNoRawTransactions(body as Record<string, unknown>);
    this.validateLegs(body.legs);

    const existing = await this.store.get(strategyId);
    if (!existing) {
      throw new StrategyNotFoundError(strategyId);
    }
    if (existing.status === "archived") {
      throw new StrategyForbiddenError("Archived strategies cannot be revised.");
    }

    if (!algosdk.isValidAddress(body.holderAddress)) {
      throw new StrategyValidationError("holderAddress is not a valid Algorand address.");
    }

    const holder = await this.resolveNftHolder!(strategyId);
    if (!holder || holder !== body.holderAddress) {
      throw new StrategyForbiddenError(
        "Only the current strategy NFT holder may revise this strategy."
      );
    }

    const lastRevisedMs = Date.parse(existing.lastRevisedAt);
    const elapsed = this.now().getTime() - lastRevisedMs;
    if (Number.isFinite(lastRevisedMs) && elapsed < STRATEGY_REVISE_COOLDOWN_MS) {
      const nextEligibleAt = new Date(lastRevisedMs + STRATEGY_REVISE_COOLDOWN_MS).toISOString();
      throw new StrategyConflictError(
        "Strategy revise cooldown has not elapsed (14 days per strategyId).",
        {
          lastRevisedAt: existing.lastRevisedAt,
          nextEligibleAt,
          cooldownMs: STRATEGY_REVISE_COOLDOWN_MS
        }
      );
    }

    const revised: StrategyDocument = {
      ...existing,
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      tags: body.tags ?? existing.tags,
      legs: body.legs,
      lastRevisedAt: this.now().toISOString(),
      holderFeeShareBps: STRATEGY_HOLDER_FEE_SHARE_BPS
    };

    await this.store.put(revised);
    return revised;
  }

  async get(strategyId: number): Promise<StrategyDocument> {
    const document = await this.store.get(strategyId);
    if (!document) {
      throw new StrategyNotFoundError(strategyId);
    }
    return document;
  }

  async list(query: StrategyListQuery = {}): Promise<{
    items: StrategyDocument[];
    total: number;
  }> {
    const ids = await this.store.listIds();
    const documents: StrategyDocument[] = [];
    for (const id of ids) {
      const document = await this.store.get(id);
      if (!document) {
        continue;
      }
      if (query.status && document.status !== query.status) {
        continue;
      }
      if (
        query.creatorAddress &&
        document.creatorAddress !== query.creatorAddress
      ) {
        continue;
      }
      if (query.tag && !document.tags.includes(query.tag)) {
        continue;
      }
      if (document.status === "archived" && query.status !== "archived") {
        continue;
      }
      if (document.status === "suspended" && query.status !== "suspended") {
        continue;
      }
      documents.push(document);
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    return {
      total: documents.length,
      items: documents.slice(offset, offset + limit)
    };
  }

  async compile(
    strategyId: number,
    body: StrategyCompileBody
  ): Promise<{
    strategy: StrategyDocument;
    quotes: ExecutableQuote[];
    feeDisclosure: {
      holderFeeShareBps: number;
      accessFeeNote: string;
      payoutCadence: string;
    };
  }> {
    const strategy = await this.get(strategyId);
    if (strategy.status === "suspended" || strategy.status === "archived") {
      throw new StrategyForbiddenError(
        `Strategy ${strategyId} is ${strategy.status} and cannot be compiled.`
      );
    }

    if (!algosdk.isValidAddress(body.userAddress)) {
      throw new StrategyValidationError("userAddress is not a valid Algorand address.");
    }

    const totalAmount = BigInt(body.amount);
    if (totalAmount <= 0n) {
      throw new StrategyValidationError("amount must be a positive integer string.");
    }

    const context = {
      network: "mainnet" as const,
      algod: createExecutionAlgodClient()
    };

    const quotes: ExecutableQuote[] = [];
    let allocated = 0n;

    for (let legIndex = 0; legIndex < strategy.legs.length; legIndex += 1) {
      const leg = strategy.legs[legIndex]!;
      const isLast = legIndex === strategy.legs.length - 1;
      const legAmount = isLast
        ? totalAmount - allocated
        : (totalAmount * BigInt(leg.weightBps)) / BigInt(STRATEGY_WEIGHT_BPS_TOTAL);
      allocated += legAmount;

      const override = body.legInputs?.find((entry) => entry.legIndex === legIndex);
      const input: Record<string, unknown> = {
        userAddress: body.userAddress,
        amount: legAmount.toString(),
        ...(leg.opportunityId ? { opportunityId: leg.opportunityId } : {}),
        ...(leg.venueIds ? { venueIds: leg.venueIds } : {}),
        ...(override?.input ?? {})
      };

      quotes.push(
        await compileExecutableQuote(
          executionRegistry,
          leg.shapeKey,
          input,
          context
        )
      );
    }

    return {
      strategy,
      quotes,
      feeDisclosure: {
        holderFeeShareBps: STRATEGY_HOLDER_FEE_SHARE_BPS,
        accessFeeNote: buildStrategyPaymentNote(strategyId),
        payoutCadence:
          "50% of this compile access fee is paid weekly to the strategy NFT holder."
      }
    };
  }
}

export function buildStrategyPaymentNote(strategyId: number): string {
  return `x402:v2:strategy:${strategyId}`;
}

export function buildStrategyPayoutNote(
  week: string,
  strategyId: number
): string {
  return `x402:v2:strategy-payout:${week}:${strategyId}`;
}

function assertNoRawTransactions(body: Record<string, unknown>): void {
  for (const key of ["encodedTransactions", "transactions", "paymentGroup"]) {
    if (key in body && body[key] !== undefined) {
      throw new StrategyValidationError(
        "Raw or pre-built transaction groups are not allowed in strategy payloads.",
        { field: key }
      );
    }
  }
}

function deriveUnitName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (cleaned.length === 0) {
    return "CXS";
  }
  return cleaned.slice(0, 8);
}

async function defaultMintStrategyNft(input: {
  name: string;
  unitName: string;
  creatorAddress: string;
}): Promise<number> {
  const mnemonic = process.env.STRATEGY_MINT_MNEMONIC?.trim();
  const algodUrl = process.env.X402_ALGOD_URL?.trim();
  if (!mnemonic || !algodUrl) {
    return allocateLocalStubStrategyId();
  }

  const account = algosdk.mnemonicToSecretKey(mnemonic);
  const algod = new algosdk.Algodv2(
    process.env.X402_ALGOD_TOKEN?.trim() ?? "",
    algodUrl,
    ""
  );
  const suggested = await algod.getTransactionParams().do();
  const publicBase = resolvePublicBaseUrl();

  // Placeholder URL; rewritten mentally as strategies/{id} after mint — ASA url
  // max 96 bytes, so keep a stable ARC-3 template path.
  const createTxn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
    sender: account.addr,
    total: 1,
    decimals: 0,
    defaultFrozen: false,
    unitName: input.unitName,
    assetName: input.name.slice(0, 32),
    manager: account.addr.toString(),
    reserve: account.addr.toString(),
    assetURL: `${publicBase}/strategies#arc3`,
    suggestedParams: suggested
  });

  const signed = createTxn.signTxn(account.sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  const confirmed = await algosdk.waitForConfirmation(algod, txid, 8);
  const assetIndex = confirmed.assetIndex;
  if (assetIndex === undefined || assetIndex === 0n) {
    throw new Error("Strategy NFT mint did not return an asset index.");
  }

  const strategyId = Number(assetIndex);

  // Transfer NFT to creator when mint authority differs from creator.
  if (account.addr.toString() !== input.creatorAddress) {
    const optInParams = await algod.getTransactionParams().do();
    // Creator must already be opted in; mint service transfers when possible.
    const xfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: account.addr,
      receiver: input.creatorAddress,
      amount: 1,
      assetIndex: BigInt(strategyId),
      suggestedParams: optInParams
    });
    const signedXfer = xfer.signTxn(account.sk);
    await algod.sendRawTransaction(signedXfer).do();
  }

  return strategyId;
}

async function allocateLocalStubStrategyId(): Promise<number> {
  const path =
    process.env.STRATEGY_STUB_ID_PATH?.trim() ||
    join(process.env.STRATEGY_DATA_DIR?.trim() || "data/strategies", "next-id.json");
  await mkdir(dirname(path), { recursive: true });
  let nextId = 900_000 + Math.floor(Math.random() * 50_000);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { nextId?: number };
    if (typeof parsed.nextId === "number" && parsed.nextId > 0) {
      nextId = parsed.nextId;
    }
  } catch {
    // first run
  }
  await writeFile(path, JSON.stringify({ nextId: nextId + 1 }, null, 2), "utf8");
  return nextId;
}

async function defaultResolveNftHolder(
  strategyId: number
): Promise<string | undefined> {
  const indexerUrl = process.env.X402_INDEXER_URL?.trim();
  if (!indexerUrl) {
    // Local/dev: treat creator as holder when indexer is unavailable.
    const store = createStrategyStoreFromEnv();
    const document = await store.get(strategyId);
    return document?.creatorAddress;
  }

  const token = process.env.X402_INDEXER_TOKEN?.trim() ?? "";
  const url = `${indexerUrl.replace(/\/$/, "")}/v2/assets/${strategyId}/balances?currency-greater-than=0`;
  const response = token
    ? await fetch(url, { headers: { "X-Indexer-API-Token": token } })
    : await fetch(url);
  if (!response.ok) {
    return undefined;
  }
  const payload = (await response.json()) as {
    balances?: Array<{ address?: string; amount?: number | string }>;
  };
  const holder = payload.balances?.find((row) => {
    const amount = Number(row.amount ?? 0);
    return amount > 0 && typeof row.address === "string";
  });
  return holder?.address;
}
