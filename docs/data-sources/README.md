# Data Source Documentation

This section tracks protocol-specific source contracts and normalization rules.

## Implemented Protocols

- [Tinyman](tinyman.md)
- [Pact](pact.md)
- [Folks Finance](folks-finance.md)
- [CompX](compx.md)
- [Dork.fi](dorkfi.md)

## Planned Protocols

- Haystack

Each protocol document should include:

- source endpoint(s) or SDK method(s)
- field mapping into `OpportunityRecordV1`
- rate-limit and reliability assumptions
- known caveats and fallback behavior

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
