# Data Source Documentation

This section tracks protocol-specific source contracts and normalization rules.

## Implemented Protocols

- [Tinyman](tinyman.md)
- [Pact](pact.md)
- [Folks Finance](folks-finance.md)
- [CompX](compx.md)
- [Dork.fi](dorkfi.md)
- [Myth Finance](myth-finance.md)
- [Haystack](haystack.md)
- [Réti](reti.md)
- [Alpha Arcade](alpha-arcade.md)
- [STAMM](stamm.md) (LiquiHog multi-tier AMM; HOGSWAP discovery + unsigned mint/redeem)
- [HOGSWAP LP valuation](hogswap-lp.md) (STAMM, AlgoFi, Humble positions; Tinyman/Pact overlap)
- [ASA Stats Smart Router](asastats-router.md) (quote + unsigned mixed group; partner `router:quote` / `router:group` token required)

## Planned Protocols

_(none currently)_

Each protocol document should include:

- source endpoint(s) or SDK method(s)
- field mapping into `OpportunityRecordV1`
- rate-limit and reliability assumptions
- known caveats and fallback behavior

Execution-layer construction caveats (pool discovery, opt-ins, min-balance,
slippage, liquidity limits, app upgrades) for Tinyman, Folks, Pact, CompX, and
Dork.fi live next to the shape specs in
[execution-shapes/protocol-caveats.md](../execution-shapes/protocol-caveats.md).

## Normalization unit tests

Adapter `normalize*` transforms for Tinyman, Folks Finance, Pact, CompX,
Dork.fi, Myth Finance, Haystack, Réti, Alpha Arcade, and STAMM are covered by
fixture-based tests in `protocol/tests/unit/` (recorded SDK/API shapes or
mocked SDK dependencies; no live chain, no paid x402). Run `npm run test:unit`
from repo root. See `docs/testing.md`.

## Asset ID Enrichment

To support the wallet-personalized route (`GET /opportunities/personalized`), adapters
populate the optional `assetIds` field on `OpportunityRecordV1` with the underlying
on-chain Algorand asset ids:

- Tinyman: `asset_1.id` and `asset_2.id` from the pools API.
- Pact: `primary_asset.algoid` and `secondary_asset.algoid` from the pools API.
- Folks Finance: the lending pool `assetId` from the SDK.
- CompX: lending `baseTokenId`/`lstTokenId` and staking `stakedAssetId`/`rewardAssetId` from the SDK.

Asset ids are emitted only when present; opportunities without resolvable ids simply do
not match any wallet holdings. Native ALGO is represented as asset id `0`.

## Yield Basis Contract

`OpportunityRecordV1` includes a required `yieldBasis` field so agents can
interpret what the normalized `apy` value represents:

- `apy`: the `apy` field represents a compound APY-style value from source.
- `apr`: the `apy` field carries an APR-derived value for cross-protocol consistency.

Current adapter policy:

- Tinyman: LP/farm/tALGO `apy`; stALGO restake `apr`
- Pact: `apr`
- Folks Finance: `apy`
- CompX: `apr`
- Dork.fi: `apy`
- Myth Finance: staking `apy`; farm `apr`
- Haystack: `apr`
- STAMM: listings expose TVL and fees, not APY (`apy` is `0` unknown; do not invent fee-APR)

## Asset Decimals and Precision

Decimals are treated as chain truth and never assumed:

- The shared `resolveAssetDecimals` service (`src/services/asset-decimals.ts`) reads
  decimals from algod via `getAssetByID` (`params.decimals`).
- Native ALGO (asset id `0`) is not an ASA, so its decimals are hardcoded to `6`;
  all other assets are looked up on chain.
- Any adapter that converts on-chain base units to human/USD amounts (currently
  Folks Finance TVL and CompX staking TVL/APR) must source decimals from this
  service. There is no `?? 6` or other implicit default anywhere.
- If an asset's decimals cannot be resolved, the dependent opportunity is dropped
  rather than emitted with a guessed value.
- Lookups are cached for the process lifetime (decimals are immutable per ASA) and
  batched with bounded concurrency to avoid algod rate-limit pressure. Transient
  (non-404) lookup failures are logged.

## Agent-Facing Output Precision

Yield and USD figures (`apy`, `apr`, `tvlUsd`) are formatted at the response
boundary by the shared `formatOpportunitiesForAgent` service
(`src/services/precision.ts`) before being returned from any opportunities route:

- Standard precision is **6 decimal places** (the common Algorand ASA decimal count).
- Precision is extended up to a maximum of **12 decimal places** only when rounding
  to 6 would collapse a small non-zero value to zero.
- Binary floating-point noise (e.g. `0.1 + 0.2`) is stripped as part of formatting.
- Rounding uses the decimal string form, so large USD magnitudes are not corrupted.

The precision contract is published to agents via the `x-precision` extension in
`GET /openapi.json`.

## Source Metadata

Every normalized opportunity row includes provenance fields so consumers can
judge freshness and data quality:

| Field | Meaning |
|---|---|
| `sourceTimestamp` | When the upstream source last updated the row (on-chain accrual or API row timestamp when available) |
| `fetchedAt` | When canix402 fetched and normalized the row |
| `notes` | Optional caveats about timestamp provenance, fallback identifiers, or yield estimates |

Adapters build these fields through the shared `buildSourceMetadata` service
(`src/services/source-metadata.ts`):

- When upstream exposes a per-row or on-chain update timestamp, `sourceTimestamp`
  is set from that value and `notes` carries any protocol-specific context.
- When upstream does not expose a row timestamp (Tinyman, Pact, Dork.fi), or the
  on-chain timestamp is unavailable, `sourceTimestamp` equals `fetchedAt` and
  `notes` includes a standard fetch-proxy caveat.
- When fallback identifiers are synthesized for `opportunityId` or `assetPair`,
  `notes` also includes a standard fallback caveat.

Per-protocol timestamp sources:

- **CompX**: on-chain `lastUpdateTimestamp` / `lastUpdateTime`
- **Folks Finance**: on-chain `poolInfo.interest.latestUpdate` when available
- **Tinyman, Pact, Dork.fi**: fetch time (no per-row upstream timestamp)
