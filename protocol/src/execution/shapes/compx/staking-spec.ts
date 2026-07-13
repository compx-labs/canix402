import algosdk from "algosdk";

import stakingArc56 from "../../../staking.arc56.json" with { type: "json" };

export const STAKING_ARC56 = stakingArc56;

export const STAKE_METHOD = algosdk.ABIMethod.fromSignature("stake(axfer,uint64,pay)void");
export const UNSTAKE_METHOD = algosdk.ABIMethod.fromSignature("unstake(uint64)void");
export const CLAIM_REWARDS_METHOD = algosdk.ABIMethod.fromSignature("claimRewards()void");

export const STAKE_METHOD_SELECTOR_HEX = Buffer.from(STAKE_METHOD.getSelector()).toString("hex");
export const UNSTAKE_METHOD_SELECTOR_HEX = Buffer.from(UNSTAKE_METHOD.getSelector()).toString("hex");
export const CLAIM_REWARDS_METHOD_SELECTOR_HEX = Buffer.from(CLAIM_REWARDS_METHOD.getSelector()).toString(
  "hex"
);

/** Staker box prefix from ARC-56 (`st`). */
export const STAKER_BOX_PREFIX = new TextEncoder().encode("st");

/** `StakeInfoRecord` is two uint64 fields (16 bytes). */
export const STAKER_BOX_VALUE_SIZE = 16;

/**
 * Minimum balance for a new staker box: 2500 + 400 * (keyLen + valueLen).
 * Key is prefix (2) + address (32) = 34 bytes; value is 16 bytes.
 */
export const STAKER_BOX_MBR_MICROALGOS = 2500n + 400n * BigInt(34 + STAKER_BOX_VALUE_SIZE);

export function createStakerBoxName(stakerAddress: string): Uint8Array {
  const addressBytes = algosdk.decodeAddress(stakerAddress).publicKey;
  return new Uint8Array([...STAKER_BOX_PREFIX, ...addressBytes]);
}
