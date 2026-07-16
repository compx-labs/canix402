import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import {
  createExecutionAlgodClient,
  tinymanAddLiquidityAndFarmFlexibleShape,
  tinymanFarmCommitShape
} from "../../src/execution/shapes/tinyman/index.js";

// Well-known mainnet ALGO/USDC pair; USDC (higher id) is asset1, ALGO is asset2.
const USDC_ID = 31566704;
const ALGO_ID = 0;

/**
 * Farm program metadata is resolved from Tinyman's staking-program API. Quotes
 * are only generated and validated here, never signed/submitted. Existing LP
 * commit quotes still need an existing wallet address because the shape checks
 * the LP-token balance before building.
 */
function liveFarmUserAddress(): string | undefined {
  const address = process.env.X402_TINYMAN_FARM_USER_ADDRESS;
  return address === undefined || address.length !== 58 ? undefined : address;
}

test(
  "generates (but does not submit) a real Tinyman farm commit group for an existing LP position",
  async (t) => {
    if (process.env.X402_TINYMAN_FARM_SHAPE_LIVE !== "1") {
      t.skip("Set X402_TINYMAN_FARM_SHAPE_LIVE=1 to verify the Tinyman farm shape live.");
      return;
    }
    const userAddress = liveFarmUserAddress();
    if (userAddress === undefined) {
      t.skip("Set X402_TINYMAN_FARM_USER_ADDRESS to a wallet that holds the farm LP token.");
      return;
    }

    const registry = new TransactionShapeRegistry();
    registry.register(tinymanFarmCommitShape);

    const quote = await compileExecutableQuote(
      registry,
      tinymanFarmCommitShape.key,
      {
        userAddress,
        assetAId: USDC_ID,
        assetBId: ALGO_ID,
        commitAmount: 1_000n
      },
      {
        network: "mainnet",
        algod: createExecutionAlgodClient()
      }
    );

    assert.equal(quote.transactions.length, 1);
    assert.equal(quote.transactions[0]?.type, "appl");
    assert.equal(quote.transactions[0]?.applicationCall?.appArgsText[0], "commit");
  }
);

test(
  "generates (but does not submit) a real Tinyman add-liquidity-plus-farm flexible group",
  async (t) => {
    if (process.env.X402_TINYMAN_FARM_SHAPE_LIVE !== "1") {
      t.skip("Set X402_TINYMAN_FARM_SHAPE_LIVE=1 to verify the Tinyman farm shape live.");
      return;
    }
    const userAddress = algosdk.generateAccount().addr.toString();
    const registry = new TransactionShapeRegistry();
    registry.register(tinymanAddLiquidityAndFarmFlexibleShape);

    const quote = await compileExecutableQuote(
      registry,
      tinymanAddLiquidityAndFarmFlexibleShape.key,
      {
        userAddress,
        assetAId: USDC_ID,
        assetAAmount: 1_000_000n,
        assetBId: ALGO_ID,
        assetBAmount: 1_000_000n,
        maxSlippageBps: 50
      },
      {
        network: "mainnet",
        algod: createExecutionAlgodClient()
      }
    );

    // 3 add-liquidity transactions followed by the farm commit, all in one group.
    assert.equal(quote.transactions.length, 4);
    assert.deepEqual(
      quote.transactions.map((txn) => txn.type),
      ["axfer", "pay", "appl", "appl"]
    );
    assert.equal(quote.transactions[3]?.applicationCall?.appArgsText[0], "commit");
    assert.ok(quote.transactions.every((txn) => txn.groupPresent));
  }
);
