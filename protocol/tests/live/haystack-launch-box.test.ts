import assert from "node:assert/strict";
import test from "node:test";

import algosdk from "algosdk";

import { HAYSTACK_LAUNCH_APP_ID } from "../../src/execution/shapes/haystack/launch-constants.js";
import { decodeTokenInfoBox } from "../../src/execution/shapes/haystack/launch-codec.js";
import { tokenBoxName } from "../../src/execution/shapes/haystack/launch-spec.js";

test("HayLaunch mainnet token box decodes", { timeout: 30_000 }, async (t) => {
  if (process.env.X402_HAYSTACK_LAUNCH_LIVE !== "1") {
    t.skip("Set X402_HAYSTACK_LAUNCH_LIVE=1 to read one HayLaunch token box from mainnet.");
    return;
  }
  const tokenNum = Number(process.env.X402_HAYSTACK_LAUNCH_TOKEN_NUM ?? "175");
  const algod = new algosdk.Algodv2(
    process.env.X402_ALGOD_TOKEN ?? "",
    (process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud").replace(/\/$/, ""),
    ""
  );
  const box = await algod.getApplicationBoxByName(HAYSTACK_LAUNCH_APP_ID, tokenBoxName(tokenNum)).do();
  const info = decodeTokenInfoBox(box.value);
  assert.equal(info.tokenNum, tokenNum);
  assert.ok(info.name.length > 0);
  assert.ok(info.symbol.length > 0);
  assert.ok(info.initialRealTokenReserves > 0n);
});
