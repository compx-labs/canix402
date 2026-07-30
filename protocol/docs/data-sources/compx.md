# CompX Data Source

This document defines the CompX adapter contract used by canix402.

## Source Strategy

- Mode: SDK-first (`@compx/sdk`)
- Adapter file: `src/adapters/compx.ts`
- SDK package: `@compx/sdk`
- Network: Mainnet by default (`COMPX_NETWORK=testnet` to override)
- Domains covered: lending markets + staking pools (read-only)

## Environment Variables

- `X402_ALGOD_URL` (shared across integrations; defaults to Algonode mainnet when unset)
- `X402_ALGOD_TOKEN` (shared across integrations; defaults to empty string)
- `COMPX_NETWORK` (optional; `mainnet` or `testnet`, defaults to `mainnet`)
- `COMPX_MASTER_REPO_APP_ID` (optional override for on-chain registry discovery)
- `COMPX_PRICING_API_URL` (optional override for the CompX SDK pricing API)
- `COMPX_ONLY_ACTIVE` (optional; defaults to `true`)

Pricing is resolved through `sdk.pricing.getTokenPrices`; direct lending-oracle
calls are not used by this adapter.

## Normalized Output Fields

Each CompX row is normalized into `OpportunityRecordV1` with required user
fields:

- `apy`
- `tvlUsd`

Other emitted fields:

- `protocol`
- `opportunityType`
- `opportunityId`
- `assetPair`
- `assetIds`
- `yieldBasis` (always `apr`; CompX yields are APR-derived)
- `apr` (optional)
- `sourceTimestamp`
- `fetchedAt`
- `notes`

## Field Mapping

### Lending (`sdk.lending.getAllMarkets()`)

| CompX SDK field | Normalized field | Notes |
|---|---|---|
| `market.appId` | `opportunityId` | `compx-lending-<appId>` |
| `market.baseTokenId` + asset metadata | `assetPair` | Base asset unit name |
| `market.baseTokenId`, `market.lstTokenId` | `assetIds` | Used for wallet personalization |
| `market.supplyApy` | `apy` | Depositor yield (APR-derived) |
| (adapter policy) | `yieldBasis` | Always `apr` |
| `market.borrowApy` | `apr` | Borrow-side APR |
| `market.totalDepositsUSD` | `tvlUsd` | USD TVL from on-chain totals + oracle |
| `market.lastUpdateTimestamp` | `sourceTimestamp` | On-chain accrual timestamp |
| (adapter policy) | `opportunityType` | Always `lending` |

### Staking (`sdk.staking.getAllPools()` + `getPoolApr()`)

| CompX SDK field | Normalized field | Notes |
|---|---|---|
| `pool.appId` | `opportunityId` | `compx-staking-<appId>` |
| staked/reward asset metadata | `assetPair` | `STAKED/REWARD` or single symbol when same asset |
| `pool.stakedAssetId`, `pool.rewardAssetId` | `assetIds` | Used for wallet personalization |
| `getPoolApr(...)` result | `apy`, `apr` | APR estimate (not compound APY) |
| (adapter policy) | `yieldBasis` | Always `apr` |
| `pool.totalStaked` + on-chain decimals + SDK pricing API | `tvlUsd` | Computed in adapter |
| `pool.lastUpdateTime` | `sourceTimestamp` | On-chain pool update timestamp |
| (adapter policy) | `opportunityType` | Always `staking` |

## Decimals and Precision

- Staked and reward asset decimals are resolved from chain via algod
  (`getAssetByID` -> `params.decimals`) through the shared `resolveAssetDecimals`
  service, not from the SDK asset metadata or any hardcoded default.
- Native ALGO (asset id `0`) is not an ASA, so its decimals are hardcoded to `6`.
- Staked decimals drive TVL and reward decimals drive the APR estimate, so both
  must resolve from chain; the previous `?? 6` fallback has been removed.

## Error and Data Quality Behavior

- Algod read failure or SDK failure -> adapter throws `CompXAdapterError`.
- Lending rows with non-finite APY or non-positive TVL are filtered out.
- Staking rows with null/non-positive APR or non-computable TVL USD are filtered out.
- Staking rows whose staked or reward asset decimals cannot be resolved from algod are filtered out.
- Cross-asset staking pools without resolvable SDK pricing API USD prices are skipped.
- If all rows are filtered out, adapter throws `CompXAdapterError`.

## Rate-Limit and Reliability Notes

- Current mode is on-demand fetch per request.
- `getAllMarkets()` performs multiple on-chain reads (and may simulate APR) per market.
- Wallet positions read wallet LST holdings plus market state for supplied
  balances only. Borrow/debt is not surfaced in portfolio responses.
- CompX staking pending rewards are derived MasterChef-style as
  `stake * rewardPerToken / 1e15 - rewardDebt` from pool + staker box state, then
  priced with `sdk.pricing.getTokenPrices`.
- No retry loop is implemented in this phase.
- Asset-decimal lookups are cached for the process lifetime and batched with
  bounded concurrency to limit algod request pressure.
- No persistent opportunity cache is used yet (planned for future phases).

## Known Caveats

- CompX lending `supplyApy`/`borrowApy` are APR-derived values, not compound APY.
- Staking yield is reported as APR; cross-asset pools require CompX SDK USD pricing.
- `COMPX_ONLY_ACTIVE=true` skips inactive/migrating lending markets and inactive/expired staking pools.
- Pending staking reward math uses the stored on-chain `reward_per_token` (same as
  a claim before `updatePool` accrual); live claimable can be slightly higher
  after the contract accrues to the current timestamp.
