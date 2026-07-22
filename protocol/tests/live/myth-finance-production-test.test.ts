import assert from "node:assert/strict";
import test from "node:test";

/**
 * Live smoke for Myth Finance dualSTAKE mint/redeem quote builds.
 * Enable with X402_MYTH_LIVE=1 (or X402_MYTH_EXECUTION_LIVE=1).
 * Does not submit transactions.
 */
const enabled =
  process.env.X402_MYTH_LIVE === "1" || process.env.X402_MYTH_EXECUTION_LIVE === "1";

const describeLive = enabled ? test : test.skip;

describeLive("Myth Finance live mint/redeem quote smoke", async () => {
  const { DualStake } = await import("@myth-finance/dualstake-ts-sdk");
  const algosdk = (await import("algosdk")).default;
  const { AlgorandClient } = await import("@algorandfoundation/algokit-utils");
  const {
    compileExecutableQuote,
    createExecutionRegistry
  } = await import("../../src/execution/index.js");

  const user =
    process.env.MYTH_SIMULATE_SENDER ??
    "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE";
  const algod = new algosdk.Algodv2(
    process.env.X402_ALGOD_TOKEN ?? "",
    process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud",
    ""
  );
  const algorand = AlgorandClient.fromClients({ algod });
  const contracts = await DualStake.getAvailableContracts({
    algorand,
    network: "mainnet",
    dsRegistryAppId: 2933409454n,
    tinymanAppId: 1002541853n,
    arc59RouterAppId: 2449590623n,
    sender: user
  });
  assert.ok(contracts.length > 0);
  const appId = Number(contracts[0]!.appId);
  const registry = createExecutionRegistry();
  const context = {
    network: "mainnet" as const,
    algod,
    now: () => Date.now(),
    quoteTtlMs: 30_000
  };

  const mintQuote = await compileExecutableQuote(
    registry,
    "mainnet:myth-finance:dualstake-v1:mint:lst",
    { userAddress: user, amount: "1000000", appId },
    context
  );
  assert.ok(mintQuote.transactions.length >= 3);

  const redeemQuote = await compileExecutableQuote(
    registry,
    "mainnet:myth-finance:dualstake-v1:redeem:lst",
    { userAddress: user, amount: "1000000", appId },
    context
  );
  assert.ok(redeemQuote.transactions.length >= 2);
});
