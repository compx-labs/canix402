import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import {
  pactAddLiquidityAndFarmTwoSidedShape,
  pactFarmDeployEscrowShape,
  pactFarmStakeShape
} from "../../src/execution/shapes/pact/index.js";
import { createExecutionAlgodClient } from "../../src/execution/shapes/pact/pool-state.js";

/**
 * Live quote-only coverage for Pact farm shapes. Never signs/submits.
 *
 * Env:
 * - X402_PACT_FARM_SHAPE_LIVE=1
 * - X402_PACT_FARM_APP_ID (required)
 * - X402_PACT_FARM_USER_ADDRESS (required for stake; optional for deploy)
 * - X402_PACT_POOL_APP_ID + asset amounts for addLiquidityAndFarm (optional)
 */
function liveFarmAppId(): number | undefined {
  const raw = process.env.X402_PACT_FARM_APP_ID?.trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function liveFarmUserAddress(): string | undefined {
  const address = process.env.X402_PACT_FARM_USER_ADDRESS?.trim();
  return address === undefined || address.length !== 58 ? undefined : address;
}

function livePoolAppId(): number | undefined {
  const raw = process.env.X402_PACT_POOL_APP_ID?.trim();
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

test("generates (but does not submit) a Pact farm deployEscrow group", async (t) => {
  if (process.env.X402_PACT_FARM_SHAPE_LIVE !== "1") {
    t.skip("Set X402_PACT_FARM_SHAPE_LIVE=1 to verify Pact farm shapes live.");
    return;
  }
  const farmAppId = liveFarmAppId();
  if (farmAppId === undefined) {
    t.skip("Set X402_PACT_FARM_APP_ID to a mainnet Pact farm application id.");
    return;
  }

  const userAddress =
    liveFarmUserAddress() ?? algosdk.generateAccount().addr.toString();
  const registry = new TransactionShapeRegistry();
  registry.register(pactFarmDeployEscrowShape);

  try {
    const quote = await compileExecutableQuote(
      registry,
      pactFarmDeployEscrowShape.key,
      { userAddress, farmAppId },
      { network: "mainnet", algod: createExecutionAlgodClient() }
    );
    assert.equal(quote.transactions.length, 3);
    assert.deepEqual(
      quote.transactions.map((txn) => txn.type),
      ["pay", "appl", "appl"]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already has a Pact farm escrow/i.test(message)) {
      t.skip(`User already has escrow for farm ${farmAppId}; deploy not needed.`);
      return;
    }
    throw error;
  }
});

test("generates (but does not submit) a Pact farm stake group for an existing escrow", async (t) => {
  if (process.env.X402_PACT_FARM_SHAPE_LIVE !== "1") {
    t.skip("Set X402_PACT_FARM_SHAPE_LIVE=1 to verify Pact farm shapes live.");
    return;
  }
  const farmAppId = liveFarmAppId();
  const userAddress = liveFarmUserAddress();
  if (farmAppId === undefined || userAddress === undefined) {
    t.skip(
      "Set X402_PACT_FARM_APP_ID and X402_PACT_FARM_USER_ADDRESS (wallet with farm escrow + LP)."
    );
    return;
  }

  const registry = new TransactionShapeRegistry();
  registry.register(pactFarmStakeShape);

  const quote = await compileExecutableQuote(
    registry,
    pactFarmStakeShape.key,
    {
      userAddress,
      farmAppId,
      amount: 1n
    },
    { network: "mainnet", algod: createExecutionAlgodClient() }
  );

  assert.ok(quote.transactions.length >= 2);
  assert.equal(quote.transactions[0]?.type, "axfer");
  assert.equal(
    quote.transactions[0]?.assetTransfer?.receiver,
    quote.metadata.escrowAddress
  );
});

test("generates (but does not submit) a Pact addLiquidityAndFarm group when pool is configured", async (t) => {
  if (process.env.X402_PACT_FARM_SHAPE_LIVE !== "1") {
    t.skip("Set X402_PACT_FARM_SHAPE_LIVE=1 to verify Pact farm shapes live.");
    return;
  }
  const farmAppId = liveFarmAppId();
  const poolAppId = livePoolAppId();
  const userAddress = liveFarmUserAddress();
  if (farmAppId === undefined || poolAppId === undefined || userAddress === undefined) {
    t.skip(
      "Set X402_PACT_FARM_APP_ID, X402_PACT_POOL_APP_ID, and X402_PACT_FARM_USER_ADDRESS for addLiquidityAndFarm."
    );
    return;
  }

  const registry = new TransactionShapeRegistry();
  registry.register(pactAddLiquidityAndFarmTwoSidedShape);

  const quote = await compileExecutableQuote(
    registry,
    pactAddLiquidityAndFarmTwoSidedShape.key,
    {
      userAddress,
      farmAppId,
      poolAppId,
      assetAId: 31566704,
      assetAAmount: 100_000n,
      assetBId: 0,
      assetBAmount: 50_000n,
      maxSlippageBps: 50
    },
    { network: "mainnet", algod: createExecutionAlgodClient() }
  );

  assert.ok(quote.transactions.length >= 5);
  assert.equal(quote.transactions[2]?.applicationCall?.appArgsText[0], "ADDLIQ");
});
