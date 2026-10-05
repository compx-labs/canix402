import assert from "node:assert/strict";
import test from "node:test";
import { humanSetupPrompt } from "../src/lib/human-prompt.ts";

test("human setup prompt tells the agent to create and operate the wallet", () => {
  const prompt = humanSetupPrompt("https://canix402-mcp.compx.io/mcp");

  assert.match(prompt, /https:\/\/canix402-mcp\.compx\.io\/mcp/);
  assert.match(prompt, /algosdk generateAccount/);
  assert.match(prompt, /You own the wallet/);
  assert.match(prompt, /pay and sign it yourself/);
  assert.match(prompt, /do not ask me to create the wallet in Pera/);
  assert.equal(prompt.includes("seed phrase, private key, or mnemonic in its config"), true);
});
