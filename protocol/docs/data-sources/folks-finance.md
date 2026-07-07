# Folks Finance Data Source

This document defines the current Folks Finance adapter contract used by canix402.

## Source Strategy

- Mode: SDK-first (Folks Algorand SDK)
- Adapter file: `src/adapters/folksFinance.ts`
- SDK package: `@folks-finance/algorand-sdk`
- Network: Mainnet

## Environment Variables

- `X402_ALGOD_URL` (shared across integrations; defaults to Algonode mainnet when unset)
- `X402_ALGOD_TOKEN` (shared across integrations; defaults to empty string)

## Normalized Output Fields

Each Folks row is normalized into `OpportunityRecordV1` with required user
fields:

- `apy`
- `tvlUsd`

Other emitted fields:

- `protocol`
- `opportunityType`
- `opportunityId`
- `assetPair`
- `yieldBasis` (always `apy` for Folks lending rows)
- `apr` (optional)
- `sourceTimestamp`
- `fetchedAt`
- `notes` (only when source fields are missing and fallback identifiers are used)

## Field Mapping

| Folks SDK field | Normalized field | Notes |
|---|---|---|
| `MainnetPools` key | `assetPair` | Symbol-like market label (e.g. `ALGO`, `USDC`) |
| `pool.appId` | `opportunityId` | `folks-lending-<poolAppId>` |
| `poolManagerInfo.pools[appId].depositInterestYield` | `apy` | 16-decimal fixed-point -> decimal number |
| (adapter policy) | `yieldBasis` | Always `apy` |
| `poolManagerInfo.pools[appId].depositInterestRate` | `apr` | 16-decimal fixed-point -> decimal number |
| `poolInfo.interest.totalDeposits` + oracle price | `tvlUsd` | Computed via on-chain asset decimals and 14-decimal oracle price |
| (adapter policy) | `opportunityType` | Always `lending` |

## Decimals and Precision

- Asset decimals are always resolved from chain via algod (`getAssetByID` ->
  `params.decimals`) through the shared `resolveAssetDecimals` service.
- Native ALGO (asset id `0`) is not an ASA, so its decimals are hardcoded to `6`.
- The SDK-provided `pool.assetDecimals` is no longer trusted for TVL math; the
  on-chain value is authoritative.
- If an asset's decimals cannot be resolved, the row is dropped rather than
  guessed (see below).

## Error and Data Quality Behavior

- Invalid Algod endpoint configuration or read failure -> adapter throws `FolksFinanceAdapterError`.
- Missing pool manager state or oracle price for a pool -> row is filtered out.
- Pool whose underlying asset decimals cannot be resolved from algod -> row is filtered out.
- Rows missing APY or TVL (USD) are filtered out.

## Rate-Limit and Reliability Notes

- Current mode is on-demand fetch per request.
- No retry loop is implemented in this phase.
- Asset-decimal lookups are cached for the process lifetime (decimals are
  immutable per ASA) and batched with bounded concurrency to avoid algod
  rate-limit pressure.
- No persistent opportunity cache is used yet (planned for future phases).

## Known Caveats

- SDK contract and mainnet constants can change over time with protocol upgrades.
- `assetPair` currently uses the Folks mainnet pool symbol key and is not always a true pair string.
- APY and TVL values are source-provided and will be cross-normalized further as
  additional protocols are added.
