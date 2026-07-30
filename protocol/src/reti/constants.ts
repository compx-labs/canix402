/** Mainnet Réti ValidatorRegistry application id. */
export const RETI_VALIDATOR_REGISTRY_APP_ID = 2_714_516_089;

/** Max stakers tracked in a single Réti staking pool ledger. */
export const RETI_MAX_STAKERS_PER_POOL = 200;

/** Protocol-level absolute floor (1 ALGO); validators may set a higher minEntryStake. */
export const RETI_MIN_ALGO_STAKE_PER_POOL = 1_000_000n;

export const RETI_GATING_TYPE_NONE = 0;
export const RETI_GATING_TYPE_ASSETS_CREATED_BY = 1;
export const RETI_GATING_TYPE_ASSET_ID = 2;
export const RETI_GATING_TYPE_CREATED_BY_NFD_ADDRESSES = 3;
export const RETI_GATING_TYPE_SEGMENT_OF_NFD = 4;

/** percentToValidator scale: 1_000_000 = 100%. */
export const RETI_PERCENT_TO_VALIDATOR_SCALE = 1_000_000;

export const RETI_STAKING_OPPORTUNITY_ID_PREFIX = "reti-staking-";

/** Read-only simulate sender (Algorand fee sink). */
export const RETI_SIMULATE_SENDER =
  "A7NMWS3NT3IUDMLVO26ULGXGIIOUQ3ND2TXSER6EBGRZNOBOUIQXHIBGDE";

export const RETI_ZERO_ADDRESS =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

/** Default max fee for Réti app calls that may cover inner-txn opcodes. */
export const RETI_APP_CALL_MAX_FEE_MICRO_ALGOS = 240_000n;

/**
 * Extra fee for `getStakerInfo` simulate/app calls.
 * The pool method walks the stakers box and calls `increaseOpcodeBudget`
 * (inner delete-app opups). Without surplus fee those inners fail with
 * "group fee 0.0A too small". Matches Réti UI (`extraFee: 20_000`).
 */
export const RETI_GET_STAKER_INFO_EXTRA_FEE_MICRO_ALGOS = 20_000n;
