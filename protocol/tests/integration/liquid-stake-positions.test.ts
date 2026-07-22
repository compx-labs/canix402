import assert from "node:assert/strict";
import test from "node:test";

import { MainnetConsensusConfig } from "@folks-finance/algorand-sdk";

import {
  collectFolksFinancePositions,
  collectMythFinancePositions,
  collectTinymanPositions
} from "../../src/services/protocol-positions.js";
import { TALGO_ASSET_ID, STALGO_ASSET_ID } from "../../src/execution/shapes/tinyman/liquid-stake-state.js";
import type { WalletSnapshot } from "../../src/services/wallet-snapshot.js";

const XALGO_ID = Number(MainnetConsensusConfig.xAlgoId);
const TALGO_ID = TALGO_ASSET_ID.mainnet;
const STALGO_ID = STALGO_ASSET_ID.mainnet;

function snapshotWithAssets(
  assets: Array<{ assetId: number; amount: bigint }>
): WalletSnapshot {
  const address = "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE";
  const holdings = assets.map((asset) => ({
    assetId: asset.assetId,
    amount: asset.amount
  }));
  return {
    address,
    amount: 1_000_000n,
    assets: holdings,
    appsLocalState: [],
    accountInfo: {
      address,
      amount: 1_000_000,
      assets: holdings.map((holding) => ({
        "asset-id": holding.assetId,
        amount: Number(holding.amount)
      })),
      "apps-local-state": []
    }
  };
}

test("Tinyman positions include wallet tALGO as staked", async () => {
  const result = await collectTinymanPositions(
    "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE",
    snapshotWithAssets([{ assetId: TALGO_ID, amount: 2_500_000n }])
  );

  const talgo = result.positions.find(
    (position) =>
      position.positionType === "staked" && position.assetId === TALGO_ID
  );
  assert.ok(talgo);
  assert.equal(talgo.amountRaw, "2500000");
  assert.equal(talgo.opportunityId, "tinyman-staking-talgo");
  assert.match(talgo.notes ?? "", /Wallet tALGO balance/);
});

test("Tinyman positions include wallet stALGO as staked", async () => {
  const result = await collectTinymanPositions(
    "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE",
    snapshotWithAssets([{ assetId: STALGO_ID, amount: 4_000_000n }])
  );

  const stalgo = result.positions.find(
    (position) =>
      position.positionType === "staked" && position.assetId === STALGO_ID
  );
  assert.ok(stalgo);
  assert.equal(stalgo.amountRaw, "4000000");
  assert.equal(stalgo.opportunityId, "tinyman-staking-stalgo");
  assert.match(stalgo.notes ?? "", /Wallet stALGO balance/);
});

test("Folks positions include wallet xALGO as staked", async () => {
  const result = await collectFolksFinancePositions(
    "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE",
    snapshotWithAssets([{ assetId: XALGO_ID, amount: 3_000_000n }])
  );

  const xalgo = result.positions.find(
    (position) =>
      position.positionType === "staked" && position.assetId === XALGO_ID
  );
  assert.ok(xalgo);
  assert.equal(xalgo.amountRaw, "3000000");
  assert.equal(xalgo.opportunityId, "folks-staking-xalgo");
  assert.match(xalgo.notes ?? "", /Wallet xALGO balance/);
});

test("Myth positions include wallet dualSTAKE LST balances as staked", async () => {
  // Uses live registry; skip when algod is rate-limited by asserting no throw and
  // either empty (no matching LST held) or staked rows when the wallet holds an LST.
  const result = await collectMythFinancePositions(
    "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE",
    snapshotWithAssets([{ assetId: 3028084000, amount: 1_250_000n }])
  );

  assert.ok(Array.isArray(result.positions));
  const myth = result.positions.find(
    (position) =>
      position.protocol === "myth-finance" &&
      position.positionType === "staked" &&
      position.assetId === 3028084000
  );
  if (result.warnings.some((warning) => warning.includes("registry unavailable"))) {
    return;
  }
  assert.ok(myth);
  assert.equal(myth.amountRaw, "1250000");
  assert.equal(myth.opportunityId, "myth-staking-3028076093");
});
