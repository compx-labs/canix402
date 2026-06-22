# Data Source Documentation

This section tracks protocol-specific source contracts and normalization rules.

## Implemented Protocols

- [Tinyman](tinyman.md)
- [Pact](pact.md)

## Planned Protocols

- Folks Finance
- CompX
- Dork.fi
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

Asset ids are emitted only when present; opportunities without resolvable ids simply do
not match any wallet holdings. Native ALGO is represented as asset id `0`.
