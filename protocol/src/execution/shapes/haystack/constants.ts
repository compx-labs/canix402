/**
 * Verified mainnet constants for the Haystack single-token HAY staking app
 * (`HaystackStaking`, TxnLab). Values confirmed against on-chain global state
 * of application 3321763884.
 */

/** Mainnet HaystackStaking application id. */
export const HAYSTACK_STAKING_APP_ID = 3_321_763_884;

/** HAY utility ASA (staked asset). */
export const HAY_ASSET_ID = 3_160_000_000;

/** USDC ASA (one of two reward assets alongside HAY). */
export const USDC_ASSET_ID = 31_566_704;

/** Oracle application used by the staking contract for HAY price lookups. */
export const HAYSTACK_ORACLE_APP_ID = 3_016_268_320;

export const MIN_ALGO_FEE = 1_000n;

/**
 * Flat fee applied to the staking app call. The stake/unstake/claim methods
 * issue inner transactions (oracle calls and reward transfers), so the fee must
 * cover the outer call plus its inner transactions. `coverAppCallInnerTransactionFees`
 * recomputes the exact value at build time; this ceiling bounds it.
 */
export const DEFAULT_HAYSTACK_APP_CALL_MAX_FEE = 5_000n;

/**
 * Minimum balance for a new staker box.
 * Box map `userStake` uses an empty prefix, so the key is the raw 32-byte
 * staker address. The `UserData` value is
 * `(uint64 stake, uint64 pendingRewardsUsdc, uint128 rewardDebtUsdc, uint64 pendingRewardsHay, uint128 rewardDebtHay)`
 * = 8 + 8 + 16 + 8 + 16 = 56 bytes.
 * MBR = 2500 + 400 * (keyLen + valueLen) = 2500 + 400 * (32 + 56) = 37,700 microAlgos.
 */
export const STAKER_BOX_KEY_SIZE = 32;
export const STAKER_BOX_VALUE_SIZE = 56;
export const STAKER_BOX_MBR_MICROALGOS =
  2_500n + 400n * BigInt(STAKER_BOX_KEY_SIZE + STAKER_BOX_VALUE_SIZE);
