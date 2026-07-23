# Réti Open Pooling Data Source

This document defines the Réti consensus staking adapter used by canix402.

## Source Strategy

- Mode: algosdk ABI simulate reads against the mainnet ValidatorRegistry
- Adapter file: `src/adapters/reti.ts`
- Shared ABI helpers: `src/reti/abi.ts`, `src/reti/constants.ts`
- Network: Mainnet only
- Domains covered: validator-level ALGO staking (pools allocate under each validator)

Réti is **not** Folks Finance. It is Algorand Foundation / TxnLab open pooling
(mainnet registry app id `2714516089`).

## Environment Variables

- `X402_ALGOD_URL` (shared; defaults to Algonode mainnet)
- `X402_ALGOD_TOKEN` (shared; defaults to empty)
- `TINYMAN_API_BASE_URL` / `TINYMAN_API_KEY` (ALGO USD price via Tinyman assets API)
- `RETI_VALIDATOR_REGISTRY_APP_ID` (optional; default `2714516089`)

## Normalized Output Fields

### Staking (`opportunityType: "staking"`)

One row **per validator** (not per pool):

| Field | Value |
|---|---|
| `opportunityId` | `reti-staking-{validatorId}` |
| `assetPair` | `ALGO` |
| `assetIds` | `[0]` |
| `yieldBasis` | `apr` |
| `apy` / `apr` | Consensus APR net of validator commission (`percentToValidator`) |
| `tvlUsd` | `totalAlgoStaked` × ALGO USD |
| `entryRequirements` | `minAmount` + optional token/NFD `gates` |
| `capacity` | rolled-up pool slots / ALGO room + `acceptingStake` |

### Entry requirements

Published from immutable validator config:

- `minAmount`: `{ assetId: 0, amount: minEntryStake }` (microAlgos decimal string)
- `gates`:
  - `asa` — up to 4 ASA ids (`gateMatch: "any"`)
  - `asa-creator` — creator address + optional min balance
  - `nfd-linked-creators` / `nfd-root-segment` — NFD app id as string
- `eligibilityFullyCheckable`: `false` when NFD/creator gates are present

Discovery filters are soft; quote-time on-chain checks are authoritative.

### Capacity

- `stakerSlotsRemaining`: Σ max(0, 200 − pool.totalStakers)
- `algoRoomMicroAlgos`: Σ max(0, maxStakePerPool − pool.totalAlgoStaked)
- `acceptingStake`: false when sunset, no pools, no slots, or no ALGO room

## Execution

| Shape | Role | Key inputs |
|---|---|---|
| `mainnet:reti:v1:stake:algo` | enter | `userAddress`, `validatorId`, `amount`, optional `valueToVerify` |
| `mainnet:reti:v1:unstake:algo` | exit (positions) | `userAddress`, `validatorId`, `poolAppId`, `amount` |

Stake builds: gas×2 + ALGO payment to registry + `addStake` (+ optional reward ASA opt-in).
Unstake builds: gas×2 + `removeStake` on the pool app (+ optional reward ASA opt-in).

## Positions

One `staked` position per pool ledger entry:

- `positionId`: `reti:staked:{validatorId}:{poolAppId}`
- `opportunityId`: `reti-staking-{validatorId}`
- `inputHints`: `{ validatorId, poolAppId, assetId: 0 }`
- Exit shape: `mainnet:reti:v1:unstake:algo`

Pending reward-token balances surface as `reward` positions when present.

## Out of Scope

- Full NFD resolution for personalized eligibility (gates are published; soft-match skips NFD/creator-only validators)
- Epoch payout / commission claim shapes for validators
- Testnet / localnet registry targets
