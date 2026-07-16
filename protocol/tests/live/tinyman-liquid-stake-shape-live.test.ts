import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import {
  TransactionShapeRegistry,
  compileExecutableQuote
} from "../../src/execution/index.js";
import {
  createExecutionAlgodClient,
  tinymanIncreaseStakeStAlgoShape,
  tinymanMintTAlgoShape
} from "../../src/execution/shapes/tinyman/index.js";

test(
  "generates (but does not submit) a real Tinyman tALGO mint group",
  async (t) => {
    if (process.env.X402_TINYMAN_LIQUID_STAKE_SHAPE_LIVE !== "1") {
      t.skip(
        "Set X402_TINYMAN_LIQUID_STAKE_SHAPE_LIVE=1 to verify Tinyman liquid-stake shapes live."
      );
      return;
    }

    const userAddress = algosdk.generateAccount().addr.toString();
    const registry = new TransactionShapeRegistry();
    registry.register(tinymanMintTAlgoShape);

    const quote = await compileExecutableQuote(
      registry,
      tinymanMintTAlgoShape.key,
      {
        userAddress,
        amount: 1_000_000n
      },
      {
        network: "mainnet",
        algod: createExecutionAlgodClient()
      }
    );

    assert.ok(quote.transactions.length >= 2);
    assert.equal(
      quote.transactions[quote.transactions.length - 1]?.applicationCall?.appArgsText[0],
      "mint"
    );
    assert.ok(quote.transactions.every((txn) => txn.groupPresent));
  }
);

test(
  "generates (but does not submit) a real Tinyman stALGO increaseStake group",
  async (t) => {
    if (process.env.X402_TINYMAN_LIQUID_STAKE_SHAPE_LIVE !== "1") {
      t.skip(
        "Set X402_TINYMAN_LIQUID_STAKE_SHAPE_LIVE=1 to verify Tinyman liquid-stake shapes live."
      );
      return;
    }

    const userAddress = algosdk.generateAccount().addr.toString();
    const registry = new TransactionShapeRegistry();
    registry.register(tinymanIncreaseStakeStAlgoShape);

    const quote = await compileExecutableQuote(
      registry,
      tinymanIncreaseStakeStAlgoShape.key,
      {
        userAddress,
        amount: 1_000n
      },
      {
        network: "mainnet",
        algod: createExecutionAlgodClient()
      }
    );

    assert.ok(quote.transactions.length >= 2);
    assert.equal(
      quote.transactions[quote.transactions.length - 1]?.applicationCall?.appArgsText[0],
      "increase_stake"
    );
    assert.ok(quote.transactions.every((txn) => txn.groupPresent));
  }
);
