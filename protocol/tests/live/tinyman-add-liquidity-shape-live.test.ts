import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import {
  createExecutionAlgodClient,
  tinymanAddLiquidityFlexibleShape
} from "../../src/execution/shapes/tinyman/index.js";

// Well-known mainnet ALGO/USDC pair; USDC (higher id) is asset1, ALGO is asset2.
const USDC_ID = 31566704;
const ALGO_ID = 0;

test(
  "generates (but does not submit) a real Tinyman v2 flexible add-liquidity group",
  async (t) => {
    if (process.env.X402_TINYMAN_SHAPE_LIVE !== "1") {
      t.skip("Set X402_TINYMAN_SHAPE_LIVE=1 to verify the Tinyman shape against live pool data.");
      return;
    }

    // No funds or opt-ins are required: the group is built and validated only,
    // never signed or submitted.
    const userAddress = algosdk.generateAccount().addr.toString();

    const registry = new TransactionShapeRegistry();
    registry.register(tinymanAddLiquidityFlexibleShape);

    const quote = await compileExecutableQuote(
      registry,
      tinymanAddLiquidityFlexibleShape.key,
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

    // A returned quote means the generated group already passed shape validation.
    assert.equal(quote.transactions.length, 3);
    assert.deepEqual(
      quote.transactions.map((txn) => txn.type),
      ["axfer", "pay", "appl"]
    );
    assert.equal(quote.transactions[0]?.assetTransfer?.assetIndex, String(USDC_ID));
    assert.deepEqual(quote.transactions[2]?.applicationCall?.appArgsText.slice(0, 2), [
      "add_liquidity",
      "flexible"
    ]);
    assert.equal(quote.encodedTransactions.length, 3);
    assert.ok(quote.transactions.every((txn) => txn.groupPresent));
  }
);
