import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import {
  createExecutionAlgodClient,
  tinymanRemoveLiquidityMultipleAssetsOutShape
} from "../../src/execution/shapes/tinyman/index.js";

const USDC_ID = 31566704;
const ALGO_ID = 0;

test(
  "generates (but does not submit) a real Tinyman v2 remove-liquidity group",
  async (t) => {
    if (process.env.X402_TINYMAN_SHAPE_LIVE !== "1") {
      t.skip("Set X402_TINYMAN_SHAPE_LIVE=1 to verify the Tinyman shape against live pool data.");
      return;
    }

    const userAddress = algosdk.generateAccount().addr.toString();

    const registry = new TransactionShapeRegistry();
    registry.register(tinymanRemoveLiquidityMultipleAssetsOutShape);

    const quote = await compileExecutableQuote(
      registry,
      tinymanRemoveLiquidityMultipleAssetsOutShape.key,
      {
        userAddress,
        assetAId: USDC_ID,
        assetBId: ALGO_ID,
        poolTokenAmount: 500_000n,
        maxSlippageBps: 50
      },
      {
        network: "mainnet",
        algod: createExecutionAlgodClient()
      }
    );

    assert.equal(quote.transactions.length, 2);
    assert.deepEqual(
      quote.transactions.map((txn) => txn.type),
      ["axfer", "appl"]
    );
    assert.equal(quote.transactions[0]?.assetTransfer?.receiver, quote.metadata.poolAddress);
    assert.equal(quote.transactions[2], undefined);
    assert.equal(quote.transactions[1]?.applicationCall?.appArgsText[0], "remove_liquidity");
    assert.ok(
      quote.transactions[1]?.applicationCall?.foreignAssets.includes(String(USDC_ID))
    );
    assert.ok(
      quote.transactions[1]?.applicationCall?.foreignAssets.includes(String(ALGO_ID))
    );
    assert.equal(quote.encodedTransactions.length, 2);
    assert.ok(quote.transactions.every((txn) => txn.groupPresent));
  }
);
