/**
 * Verified mainnet constants for the Alpha Arcade ALPHA fee-sharing staking
 * pool. Defaults match `@alpha-arcade/sdk` (`DEFAULT_STAKING_APP_ID` /
 * `DEFAULT_ALPHA_ASSET_ID`).
 */

/** Mainnet ALPHA staking pool application id. */
export const ALPHA_ARCADE_STAKING_APP_ID = 3_626_756_314;

/** ALPHA ASA (staked asset, 6 decimals). */
export const ALPHA_ASSET_ID = 2_726_252_423;

/** USDC ASA (reward asset). */
export const USDC_ASSET_ID = 31_566_704;

export const MIN_ALGO_FEE = 1_000n;

/**
 * Flat fee on unstake/claim app calls to cover the inner ASA transfer
 * (matches `@alpha-arcade/sdk` staking module).
 */
export const ALPHA_ARCADE_INNER_TXN_FLAT_FEE = 2_000n;

/**
 * Approximate free ALGO needed for a first-time staker (app local-state MBR +
 * fees). Documented by the Alpha Arcade SDK; Canix surfaces it as a warning.
 */
export const FIRST_STAKE_ALGO_RESERVE_MICROALGOS = 238_500n;
