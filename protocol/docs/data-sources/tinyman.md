# Tinyman Data Source

This document defines the current Tinyman adapter contract used by canix402.

## Source Strategy

- Mode: API-first (pools) + on-chain consensus APR (tALGO) + restake TINY APR (stALGO)
- Adapter file: `src/adapters/tinyman.ts`
- Positions collector: `src/services/protocol-positions.ts` (`collectTinymanPositions`)
- Base URL: `TINYMAN_API_BASE_URL`
- Endpoints used:
  - Opportunities: `GET /pools/`
  - Extra / low-liquidity pools (by address): `GET /pools/{pool_address}/`
  - ALGO USD for tALGO/stALGO TVL: `GET /assets/0/` (`price_in_usd`)
  - TINY USD for stALGO APR: `GET /assets/{tiny_asset_id}/` (`price_in_usd`)
  - Wallet LP positions: `GET /pools/?liquidity_asset_ids=…`
  - Wallet farm commitments / unclaimed rewards: `GET /staking/pool-programs/?pooler_address=…&committed_only=true`
  - Reward asset USD: `GET /assets/{asset_id}/` (`price_in_usd`)
- tALGO staking also reads algod ledger supply, recent block headers (bonus + fees), and
  Tinyman stake-app state via `@tinymanorg/tinyman-js-sdk` `TinymanTAlgoClient`
- stALGO restake reads restake-app globals (`total_staked_amount`,
  `current_reward_rate_per_time`) and values stake via ALGO/tALGO ratio
- Default query profile matches Tinyman app pool listing behavior:
  - `with_statistics=true`
  - `version__in=2.0` (override with `TINYMAN_POOL_VERSIONS`)
  - `limit=100` (override with `TINYMAN_POOL_LIMIT`)
  - verified-only filtering in adapter (`TINYMAN_ONLY_VERIFIED=true` by default)
- Extra pools (default includes COMPX/ALGO
  `ZKAP7DLHJ25VTHPD3W73FGDM7VGU3DJAXL7GNUFW5CG4MIMY72EZ5GFIAI`) are fetched by
  address in parallel with the list, merged/deduped by pool address, then run
  through the same verified + APY/TVL normalize path. Extra fetch failures are
  non-fatal (list still returns). Tinyman LP execution does not need a per-pool
  app id; quotes resolve the validator app and pool from the asset pair.

## Environment Variables

- `TINYMAN_API_BASE_URL` (required in production)
- `TINYMAN_API_KEY` (optional; sent as bearer token when provided)
- `TINYMAN_POOL_VERSIONS` (optional CSV, default `2.0`)
- `TINYMAN_ONLY_VERIFIED` (optional boolean, default `true`)
- `TINYMAN_POOL_LIMIT` (optional integer-like string, default `100`)
- `TINYMAN_EXTRA_POOL_ADDRESSES` (optional CSV of Algorand pool addresses always
  fetched via `GET /pools/{address}/` in addition to the list; COMPX/ALGO is
  included by default in code)
- `X402_ALGOD_URL` / `X402_ALGOD_TOKEN` (shared; used for tALGO/stALGO staking APR/TVL)

## Normalized Output Fields

Each Tinyman row is normalized into `OpportunityRecordV1` with required user
fields:

- `apy`
- `tvlUsd`

Other emitted fields:

- `protocol`
- `opportunityType`
- `opportunityId`
- `assetPair`
- `yieldBasis` (`apy` for LP, farm, and staking outputs)
- `apr` (optional when upstream provides it; for tALGO staking this is the
  pre-fee network consensus APR)
- `sourceTimestamp`
- `fetchedAt`
- `notes` (fallback identifiers and/or staking formula caveats)

When farm incentives are present, one upstream pool can emit **two** normalized
opportunities:

- `lp` for the base pool position
- `farm` for staking/farming incentives on that same pair

Additionally, the adapter may emit one liquid-staking row:

- `staking` for Tinyman tALGO (`opportunityId: tinyman-staking-talgo`)

## Field Mapping

| Tinyman field | Normalized field | Notes |
|---|---|---|
| `address` | `opportunityId` | Suffixes `:lp` or `:farm` for uniqueness |
| `asset_1.unit_name` + `asset_2.unit_name` | `assetPair` | Falls back to `unknown/unknown` if missing |
| `annual_percentage_yield` | `apy` (`lp`) | Decimal fraction -> percentage points; required for LP output |
| (adapter policy) | `yieldBasis` | Always `apy` |
| `staking_total_annual_percentage_yield` | `apy` (`farm`) | Decimal fraction -> percentage points; farm output emitted when > 0 |
| `liquidity_in_usd` | `tvlUsd` | Required; record dropped when invalid |
| `annual_percentage_rate` | `apr` (`lp`) | Decimal fraction -> percentage points; optional |
| `staking_total_annual_percentage_rate` | `apr` (`farm`) | Decimal fraction -> percentage points; optional |
| fetch timestamp | `sourceTimestamp` | Source currently does not expose a per-row update timestamp |
| incentive presence (`staking_total_annual_percentage_*`) | `opportunityType` | Emits `farm` in addition to `lp` |

### tALGO liquid staking (`opportunityType: staking`)

| Source | Normalized field | Notes |
|---|---|---|
| (adapter policy) | `opportunityId` | Always `tinyman-staking-talgo` |
| (adapter policy) | `assetPair` / `assetIds` | `ALGO/tALGO`, `[0, 2537013734]` |
| Consensus APR helper | `apr` | `(bonus + 50% × avg fees) × blocks/year / onlineStake × 100` |
| Consensus APR × (1 − 0.08) | `apy` | Tinyman 8% protocol fee on block rewards |
| `minted_talgo` × ALGO/tALGO ratio × ALGO USD | `tvlUsd` | Circulating tALGO × ratio from stake app; USD from `GET /assets/0/` |

Consensus APR uses algod `GET /v2/ledger/supply` (`onlineStake`) and a short sample of
recent block headers (`bonus`, `feesCollected`). See `src/services/consensus-staking-apr.ts`.

## Error and Data Quality Behavior

- Non-2xx response from Tinyman pools API -> adapter throws `TinymanAdapterError`.
- Invalid JSON/transport timeout on pools -> adapter throws `TinymanAdapterError`.
- Rows missing either APY or TVL (USD) are filtered out, not partially emitted.
- Rows are filtered to verified pools by default (`TINYMAN_ONLY_VERIFIED=true`).
- Extra pool detail fetches (`GET /pools/{address}/`) that fail or return invalid
  payloads are omitted; the top-N list still returns.
- tALGO staking failures (algod / price / stake-app) omit the staking row only;
  pool opportunities still return.

## Rate-Limit and Reliability Notes

- Adapter currently performs on-demand fetches per request.
- No retry loop is implemented in this phase.
- No persistent cache is used yet (future phases will add cache strategy).
- Wallet positions do not scan the opportunity catalog. `/positions` sends the
  positive ASA ids from its shared indexer snapshot as `liquidity_asset_ids` and
  values only the LP tokens returned by that targeted query.
- Farm coverage uses a single `pool-programs` request scoped to the wallet
  (`committed_only=true`). Farm commit does not escrow LP tokens: stake equals
  the full wallet LP balance, so `/positions` does not emit a separate Tinyman
  `staked` row. Pending unpaid rewards (`pooler.rewards.pending`) are emitted as
  `reward` positions and priced with Tinyman asset USD; `rewardsUsdComplete` is
  false only when the farm or price fetch fails (or a reward lacks a USD price).

## Known Caveats

- Endpoint/field names are controlled by Tinyman and may evolve.
- Pool endpoint data maps to `lp`; farming incentives are emitted as separate
  `farm` opportunities when staking fields are present.
- Low-liquidity pools can fall outside `TINYMAN_POOL_LIMIT`; use
  `TINYMAN_EXTRA_POOL_ADDRESSES` (or the in-code defaults) to force-include them
  by address. Opportunity ids use the pool address (`{address}:lp` / `:farm`);
  the Tinyman validator app id is resolved at quote/execution time, not discovery.
- Accruing-but-not-yet-claimable `pooler.rewards.potential` is not emitted;
  only unpaid `pending` rewards are included in wallet reward totals.
- Consensus APR uses ledger online stake (not the stricter ≥30k eligible-stake
  filter) and a short fee sample; treat as an estimate.
- Tinyman stALGO restake is emitted as `tinyman-staking-stalgo` with APR derived
  from restake app `current_reward_rate_per_time` × TINY USD / staked TVL.
- `tvlUsd` and `apy` for LP/farm are trusted from source; tALGO/stALGO staking are derived.
