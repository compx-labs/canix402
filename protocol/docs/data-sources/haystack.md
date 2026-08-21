# Haystack Data Source

This document defines the Haystack staking adapter contract used by canix402.

## Source Strategy

- Mode: on-chain first (HaystackStaking app `3321763884`)
- Adapter file: `src/adapters/haystack.ts`
- Positions collector: `src/services/protocol-positions.ts` (`collectHaystackPositions`)
- Execution shapes: `src/execution/shapes/haystack/` (stake / unstake / claim)
- HAY USD pricing: Tinyman Analytics `GET /assets/3160000000/`

## Normalized Opportunity

| Field | Value |
|---|---|
| `protocol` | `haystack` |
| `opportunityType` | `staking` |
| `opportunityId` | `haystack-staking-hay` |
| `assetPair` | `HAY/USDC+HAY` |
| `assetIds` | `[3160000000, 31566704]` (HAY, USDC) |
| `yieldBasis` | `apr` |
| `apy` / `apr` | sum of on-chain `emaAPRUsdc` + `emaAPRHay` (1e6 = 1%) |
| `tvlUsd` | `staked` × HAY USD |

Paused pools (`paus != 0`) are omitted.

## Positions

- Staker box `userStake` → `staked` when `stake > 0`
- Box-decoded `pendingRewardsUsdc` / `pendingRewardsHay` → `reward` rows
- Box pending may lag live accrual until the next drip/claim

## Environment Variables

- `X402_ALGOD_URL` / `X402_ALGOD_TOKEN` (shared)
- `TINYMAN_API_BASE_URL` / `TINYMAN_API_KEY` (optional; HAY USD)

## Known Caveats

- Dual-reward APR is the sum of USDC and HAY EMA components; treat as an estimate.
- Swap routes (`/swaps/*`) are a separate Haystack surface and are not part of this adapter.

## Tests

Fixture-based normalize coverage: `tests/unit/haystack-normalize.test.ts` plus
`tests/fixtures/adapters/haystack.ts` (`npm run test:unit`). Route-level coverage
remains in `tests/integration/haystack-adapter.test.ts`.
