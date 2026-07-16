import algosdk from "algosdk";

import haystackStakingArc56 from "../../../haystack-staking.arc56.json" with { type: "json" };

export const HAYSTACK_STAKING_ARC56 = haystackStakingArc56;

/**
 * ABI methods from the HaystackStaking ARC-56 spec. `stakeHay` receives the HAY
 * asset transfer as its sole ABI argument (the box MBR payment is a separate
 * bare grouped payment the contract inspects, not an ABI arg).
 */
export const STAKE_HAY_METHOD = algosdk.ABIMethod.fromSignature("stakeHay(axfer)void");
/**
 * Default unstake path: unstakes HAY and claims pending USDC + HAY rewards in one call.
 * Prefer this over raw `unstakeHay(uint64)void`, which leaves rewards unclaimed.
 */
export const UNSTAKE_HAY_AND_CLAIM_METHOD = algosdk.ABIMethod.fromSignature(
  "unstakeHayAndClaim(uint64)(uint64,uint64)"
);
export const CLAIM_METHOD = algosdk.ABIMethod.fromSignature("claim()(uint64,uint64)");

export const STAKE_HAY_METHOD_SELECTOR_HEX = Buffer.from(STAKE_HAY_METHOD.getSelector()).toString(
  "hex"
);
export const UNSTAKE_HAY_AND_CLAIM_METHOD_SELECTOR_HEX = Buffer.from(
  UNSTAKE_HAY_AND_CLAIM_METHOD.getSelector()
).toString("hex");
export const CLAIM_METHOD_SELECTOR_HEX = Buffer.from(CLAIM_METHOD.getSelector()).toString("hex");

/**
 * Staker box name for a given address. The `userStake` box map uses an empty
 * prefix, so the box name is the raw 32-byte public key of the staker.
 */
export function createStakerBoxName(stakerAddress: string): Uint8Array {
  return algosdk.decodeAddress(stakerAddress).publicKey;
}
