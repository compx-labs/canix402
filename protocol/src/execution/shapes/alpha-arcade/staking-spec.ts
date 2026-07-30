import algosdk from "algosdk";

/**
 * ABI methods matching `@alpha-arcade/sdk` `src/modules/staking.ts`.
 * No ARC-56 file is published with the SDK; these signatures are the SoT.
 */
export const OPT_IN_METHOD = new algosdk.ABIMethod({
  name: "opt_in",
  args: [],
  returns: { type: "uint8" }
});

export const STAKE_METHOD = new algosdk.ABIMethod({
  name: "stake",
  args: [],
  returns: { type: "uint64" }
});

export const UNSTAKE_METHOD = new algosdk.ABIMethod({
  name: "unstake",
  args: [{ type: "uint64", name: "amount" }],
  returns: { type: "uint64" }
});

export const CLAIM_METHOD = new algosdk.ABIMethod({
  name: "claim",
  args: [],
  returns: { type: "uint64" }
});

export const OPT_IN_METHOD_SELECTOR_HEX = Buffer.from(OPT_IN_METHOD.getSelector()).toString(
  "hex"
);
export const STAKE_METHOD_SELECTOR_HEX = Buffer.from(STAKE_METHOD.getSelector()).toString("hex");
export const UNSTAKE_METHOD_SELECTOR_HEX = Buffer.from(UNSTAKE_METHOD.getSelector()).toString(
  "hex"
);
export const CLAIM_METHOD_SELECTOR_HEX = Buffer.from(CLAIM_METHOD.getSelector()).toString("hex");
