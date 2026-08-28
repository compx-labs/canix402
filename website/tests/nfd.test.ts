import assert from "node:assert/strict";
import test from "node:test";

import {
  displayWalletLabel,
  lookupNfdName,
  nfdNameFromLookupPayload,
  shortenAlgorandAddress
} from "../src/lib/nfd.ts";

const address = "5YCWR662A5HI0FYYS2CTIHHYBCIXESVLA0VLZ7CL27PK5SKBROCSRFIJM";

test("shortenAlgorandAddress keeps first five and last five letters", () => {
  assert.equal(shortenAlgorandAddress(address), "5YCWR...RFIJM");
  assert.equal(shortenAlgorandAddress("SHORT"), "SHORT");
});

test("displayWalletLabel prefers an NFD name over the shortened address", () => {
  assert.equal(displayWalletLabel(address, "canix.algo"), "canix.algo");
  assert.equal(displayWalletLabel(address, null), "5YCWR...RFIJM");
  assert.equal(displayWalletLabel(address, undefined), "5YCWR...RFIJM");
});

test("nfdNameFromLookupPayload reads the tiny view name for the address", () => {
  assert.equal(
    nfdNameFromLookupPayload({ [address]: { name: "kieran.algo" } }, address),
    "kieran.algo"
  );
  assert.equal(nfdNameFromLookupPayload({ [address]: { name: "" } }, address), null);
  assert.equal(nfdNameFromLookupPayload({ other: { name: "x.algo" } }, address), null);
  assert.equal(nfdNameFromLookupPayload(null, address), null);
});

test("lookupNfdName returns the name on 200 and null on 404 or fetch failure", async () => {
  const found = await lookupNfdName(address, {
    apiBaseUrl: "https://api.nf.domains",
    fetchImpl: async (input) => {
      assert.equal(String(input), `https://api.nf.domains/nfd/lookup?view=tiny&address=${address}`);
      return new Response(JSON.stringify({ [address]: { name: "kieran.algo" } }), { status: 200 });
    }
  });
  assert.equal(found, "kieran.algo");

  const missing = await lookupNfdName(address, {
    fetchImpl: async () => new Response("", { status: 404 })
  });
  assert.equal(missing, null);

  const failed = await lookupNfdName(address, {
    fetchImpl: async () => {
      throw new Error("offline");
    }
  });
  assert.equal(failed, null);
});
