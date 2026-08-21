# Myth Finance Data Source

This document defines the Myth Finance dualSTAKE adapter contract used by canix402.

## Source Strategy

- Mode: SDK-assisted reads + custom algosdk v3 transaction builders
- Adapter file: `src/adapters/mythFinance.ts`
- SDK packages:
  - `@myth-finance/dualstake-ts-sdk` (registry listings, contract state, mint/redeem app calls)
  - `@myth-finance/dualstake-farm-sdk` (passive farm APR)
- Network: Mainnet only
- Domains covered: dualSTAKE liquid staking + passive farms

Batch registry listing / price-oracle ABI decodes from the Myth SDK fail under
algosdk v3, so the adapter uses:

1. `DualStake.getAvailableContracts` for app/ASA/LST ids
2. Per-app `getListing()` + `getState()` for balances and fee bps
3. `DSFarmSDK.getFarms` / `getFarmsAndAPR` for farm incentives

Mint/redeem groups are built with algosdk v3 `sender`/`receiver` fields (Myth SDK
mint helpers still target algosdk v2 `from`/`to`).

## Environment Variables

- `X402_ALGOD_URL` (shared; defaults to Algonode mainnet)
- `X402_ALGOD_TOKEN` (shared; defaults to empty)
- `TINYMAN_API_BASE_URL` / `TINYMAN_API_KEY` (ALGO USD price via Tinyman assets API)
- `MYTH_DS_REGISTRY_APP_ID` (optional; default `2933409454`)
- `MYTH_DS_FARM_APP_ID` (optional; default `2933417632`)
- `MYTH_SIMULATE_SENDER` (optional read-only sender; defaults to fee-sink address)

## Normalized Output Fields

### Staking (`opportunityType: "staking"`)

One row per dualSTAKE instance:

| Field | Value |
|---|---|
| `opportunityId` | `myth-staking-{appId}` |
| `assetPair` | `ALGO/{unitName}→{lstName}` |
| `assetIds` | `[0, asaId, lstId]` |
| `apr` | consensus APR (pre-fee) |
| `apy` | consensus APR (percentage points) net of platform + node-runner fees, plus active farm APR |
| `yieldBasis` | `apy` |
| `tvlUsd` | staked ALGO × ALGO/USD (ALGO leg only; excludes ASA inventory) |

### Farms (`opportunityType: "farm"`)

Passive incentives only — farm rewards accrue into the LST exchange rate. Users
enter/exit via mint/redeem (no separate farm stake/unstake).

| Field | Value |
|---|---|
| `opportunityId` | `myth-farm-{appId}` |
| `apy` / `apr` | farm APR in percentage points (`farmAprBps / 100`) |
| `yieldBasis` | `apr` |

Rows are emitted only when `remainingDurationSec > 0` and `farmAprBps > 0`.

## Execution Shapes

- `mainnet:myth-finance:dualstake-v1:mint:lst` (enter)
- `mainnet:myth-finance:dualstake-v1:redeem:lst` (exit)

Inputs: `userAddress`, `amount`, `appId` (also accepted as `poolAppId` from
opportunity `inputHints`).

Mint deposits ALGO + paired ASA (ASA amount derived from on-chain rate). Redeem
burns LST for ALGO + ASA. The LST is **not** 1:1 with ALGO: each unit is a
claim on mostly ALGO plus a small amount of the paired ASA (the ASA leg is set
by the on-chain mint/redeem rate and is typically a minor share of the position).

## Positions

Wallet LST balance is the source of truth for liquid-staking size
(`myth-staking-{appId}` / `myth-farm-{appId}` exits both redeem the LST).

| Field | Value |
|---|---|
| `positionType` | `staked` |
| `positionId` | `myth-finance:staked:{appId}:{lstId}` |
| `opportunityId` | `myth-staking-{appId}` |
| `assetId` / `amountRaw` | LST ASA id and wallet balance |
| `usdValue` | approximate: values the ALGO leg only (LST units × ALGO/USD). Does **not** include the small paired-ASA redeem leg. |

## Notes / Caveats

- dualSTAKE is **not** a pure ALGO LST. Mint requires ALGO + paired ASA; redeem
  returns mostly ALGO **and** a small amount of the paired ASA.
- TVL uses staked ALGO only (not ASA inventory) priced via Tinyman ALGO/USD.
- Position `usdValue` likewise prices the ALGO leg only; treat it as a lower-bound
  approximation of exit value.
- Offline contracts are still listed when TVL is positive; notes flag online status.
- Farm yield is passive; farm opportunities attach the same mint/redeem shapes.

## Tests

Fixture-based normalize coverage: `tests/unit/myth-finance-normalize.test.ts`
plus `tests/fixtures/adapters/myth-finance.ts` (`npm run test:unit`). Route-level
coverage remains in `tests/integration/myth-finance-adapter.test.ts`.
