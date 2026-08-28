# Alpha Arcade Data Source

This document defines the Alpha Arcade ALPHA staking adapter contract used by canix402.

## Source Strategy

- Mode: on-chain first (staking app `3626756314`) + indexer trailing USDC inflows
- Adapter file: `src/adapters/alpha-arcade.ts`
- Positions collector: `src/services/protocol-positions.ts` (`collectAlphaArcadePositions`)
- Execution shapes: `src/execution/shapes/alpha-arcade/` (stake / unstake / claim)
- SDK: `@alpha-arcade/sdk` for constants + `getStakingPosition` reads (write APIs submit; Canix builds unsigned groups)
- ALPHA USD pricing: Tinyman Analytics `GET /assets/2726252423/`

## Normalized Opportunity

| Field | Value |
|---|---|
| `protocol` | `alpha-arcade` |
| `opportunityType` | `staking` |
| `opportunityId` | `alpha-arcade-staking-alpha` |
| `assetPair` | `ALPHA/USDC` |
| `assetIds` | `[2726252423, 31566704]` (ALPHA, USDC) |
| `yieldBasis` | `apr` |
| `apy` / `apr` | trailing 7d fee APR from USDC inflows to the pool ÷ ALPHA TVL, annualized |
| `tvlUsd` | `total_staked` × ALPHA USD |

When TVL, ALPHA price, or trailing USDC inflows are unavailable / zero, the row is omitted
(execution shapes remain quotable via the catalog).

## Positions

- Local state `staked` → `staked` when > 0 (via SDK `getStakingPosition`)
- Claimable USDC (`claimable`) → `reward` when > 0

## Environment Variables

- `X402_ALGOD_URL` / `X402_ALGOD_TOKEN` (shared)
- `X402_INDEXER_URL` / `X402_INDEXER_TOKEN` (shared; trailing APR)
- `TINYMAN_API_BASE_URL` / `TINYMAN_API_KEY` (optional; ALPHA USD)

## Known Caveats

- Yield is a share of prediction-market trading fees routed as USDC — not a fixed rate.
- Trailing APR can swing with volume; treat as an estimate only.
- Prediction-market trading (orders / RFQ) is out of scope for this adapter.

## Tests

Fixture-based normalize coverage: `tests/unit/alpha-arcade-normalize.test.ts`
plus `tests/fixtures/adapters/alpha-arcade.ts` (`npm run test:unit`). Route-level
coverage remains in `tests/integration/alpha-arcade-adapter.test.ts`.
