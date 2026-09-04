# Folks Finance Data Source

This document defines the current Folks Finance adapter contract used by canix402.

## Source Strategy

- Mode: SDK-first (Folks Algorand SDK)
- Adapter file: `src/adapters/folksFinance.ts`
- SDK package: `@folks-finance/algorand-sdk`
- Network: Mainnet
- Lending: `MainnetPools` + pool manager / oracle reads
- xALGO liquid staking: `getConsensusState` + shared consensus APR helper
  (`src/services/consensus-staking-apr.ts`)

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
- `opportunityType` (`lending` for pool markets; `staking` for xALGO)
- `opportunityId`
- `assetPair`
- `yieldBasis` (always `apy`)
- `apr` (optional; for xALGO staking this is the pre-fee network consensus APR)
- `sourceTimestamp`
- `fetchedAt`
- `notes` (context / formula caveats)

## Field Mapping

### Lending

| Folks SDK field | Normalized field | Notes |
|---|---|---|
| `MainnetPools` key | `assetPair` | Symbol-like market label (e.g. `ALGO`, `USDC`) |
| `pool.appId` | `opportunityId` | `folks-lending-<poolAppId>` |
| `poolManagerInfo.pools[appId].depositInterestYield` | `apy` | 16-decimal fixed-point decimal fraction -> percentage points |
| (adapter policy) | `yieldBasis` | Always `apy` |
| `poolManagerInfo.pools[appId].depositInterestRate` | `apr` | 16-decimal fixed-point decimal fraction -> percentage points |
| `poolManagerInfo.pools[appId].variableBorrowInterestYield` | `borrowApr` / `risk.borrowApr` | Variable borrow cost as percentage points |
| `poolInfo.variableBorrow.totalVariableBorrowAmount` + `stableBorrow.totalStableBorrowAmount` / `interest.totalDeposits` | `risk.utilization` | Percentage points; omitted when deposits are zero |
| `poolInfo.interest.totalDeposits` + oracle price | `tvlUsd` | Computed via on-chain asset decimals and 14-decimal oracle price |
| (adapter policy) | `opportunityType` | `lending` |

### Wallet positions (`GET /positions`)

| Position | Source | Notes |
|---|---|---|
| `supplied` (deposit escrow) | Deposit holdings (indexer) | Exit via withdraw escrow |
| `supplied` (loan collateral) | Indexer escrow discovery + algod `retrieveUserLoanInfo` collaterals | Manage: borrow/sync; exit: reduce collateral |
| `debt` | Indexer escrow discovery + algod `retrieveUserLoanInfo` borrows | Exit via `repay:withTxn`; appears promptly after `borrow:variable` once algod reflects escrow local state |

Loan escrow discovery still uses indexer note search (`retrieveLoansLocalState`).
Outstanding debt and collateral balances are read via algod so clients do not need
to wait for indexer catch-up or synthesize debt locally after borrow. Unpriced debt
keeps `usdValue: null` with a caveat rather than omitting the liability.

Credit execution shapes: `setup:loanEscrow`, `setup:addCollateral`, `collateral:sync`, `borrow:variable`, `repay:withTxn`, `collateral:reduce`.

### xALGO liquid staking (`opportunityType: staking`)

| Source | Normalized field | Notes |
|---|---|---|
| (adapter policy) | `opportunityId` | Always `folks-staking-xalgo` |
| (adapter policy) | `assetPair` / `assetIds` | `ALGO/xALGO`, `[0, xAlgoId]` |
| Consensus APR helper | `apr` | `(bonus + 50% × avg fees) × blocks/year / onlineStake × 100` |
| Consensus APR × (1 − fee) | `apy` | Folks `ConsensusState.fee` as 16-decimal fraction |
| `ConsensusState.algoBalance` + ALGO oracle price | `tvlUsd` | Same 14-decimal oracle USD math as lending |

Consensus APR uses algod `GET /v2/ledger/supply` (`onlineStake`) and a short sample of
recent block headers (`bonus`, `feesCollected`).

## Decimals and Precision

- Asset decimals are always resolved from chain via algod (`getAssetByID` ->
  `params.decimals`) through the shared `resolveAssetDecimals` service.
- Native ALGO (asset id `0`) is not an ASA, so its decimals are hardcoded to `6`.
- The SDK-provided `pool.assetDecimals` is no longer trusted for TVL math; the
  on-chain value is authoritative.
- If an asset's decimals cannot be resolved, the lending row is dropped rather than
  guessed (see below).

## Error and Data Quality Behavior

- Invalid Algod endpoint configuration or read failure -> adapter throws `FolksFinanceAdapterError`.
- Missing pool manager state or oracle price for a pool -> lending row is filtered out.
- Pool whose underlying asset decimals cannot be resolved from algod -> lending row is filtered out.
- Lending rows missing APY or TVL (USD) are filtered out.
- xALGO staking failures (consensus state / APR / oracle) omit the staking row only;
  lending opportunities still return (adapter still requires ≥1 lending row).

## Rate-Limit and Reliability Notes

- Current mode is on-demand fetch per request.
- No retry loop is implemented in this phase.
- Asset-decimal lookups are cached for the process lifetime (decimals are
  immutable per ASA) and batched with bounded concurrency to avoid algod
  rate-limit pressure.
- No persistent opportunity cache is used yet (planned for future phases).

## Known Caveats

- SDK contract and mainnet constants can change over time with protocol upgrades.
- `assetPair` for lending currently uses the Folks mainnet pool symbol key and is
  not always a true pair string.
- Consensus APR uses ledger online stake (not the stricter ≥30k eligible-stake
  filter) and a short fee sample; treat as an estimate.
- Folks delayed stake / stake-and-deposit are out of scope for discovery in this phase.
- Lending APY/TVL are SDK-provided; xALGO staking APY/TVL are derived.
- Transaction construction (escrow setup order, 0.25 / 0.1 ALGO MBR, OpUp,
  escrow key metadata):
  [execution-shapes/protocol-caveats.md](../execution-shapes/protocol-caveats.md#folks-finance).

## Tests

Fixture-based normalize coverage: `tests/unit/folks-finance-normalize.test.ts`
plus `tests/fixtures/adapters/folks-sdk.ts` (`npm run test:unit`). Route-level
coverage remains in `tests/integration/folks-finance-adapter.test.ts`.
