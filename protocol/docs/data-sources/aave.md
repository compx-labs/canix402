# Aave V3 Data Source

This document defines the Aave V3 Base adapter used by canix402. One lending
row per reserve. Supply, withdraw, variable borrow, and variable repay are
unsigned Pool calls. Stable-rate borrow, eMode, flash loans, isolation-mode
ceilings, credit delegation, and Permit are out of scope.

Algorand analogue: CompX/Folks lending without Folks escrow setup.

## Source Strategy

- Mode: GraphQL catalog + on-chain reserve configuration at quote time
- Adapter file: `src/adapters/aave.ts`
- Execution shapes: `src/execution/shapes/aave/`
- Discovery: `POST https://api.v3.aave.com/graphql`
- Query: `markets(request: { chainIds: [8453] })` reserves on Pool `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`
- Network: Base (`chainId` 8453). Rows always carry `chain: "base"`.
- Positions: aToken and variable-debt balances for a Base `0x` address on `GET /positions`. Health factor comes from Pool `getUserAccountData` and is omitted when the account has no debt.

## Environment Variables

- `AAVE_GRAPHQL_URL` (optional; default `https://api.v3.aave.com/graphql`)
- `BASE_RPC_URL` (quotes and positions; default `https://mainnet.base.org`)

x402 accepts Algorand USDC and, when `X402_PAY_TO_BASE` is a real address, Base USDC at the same price. Algorand stays the first accept.

## Field Mapping

Yield fields on the GraphQL API are fractions (`0.038` = 3.8%). Canix stores percents (`fraction × 100`), same as Morpho.

| Canix field | Source |
| --- | --- |
| `protocol` | `aave` |
| `chain` | `base` |
| `opportunityType` | `lending` |
| `opportunityId` | `aave-lending-{underlying}` (lowercase) |
| `assetPair` | `underlyingToken.symbol` |
| `apy` / `yieldBasis` | `supplyInfo.apy.value` × 100, `yieldBasis: apy` |
| `borrowApr` | `borrowInfo.apy.value` × 100 when `borrowingState` is `ENABLED`; omitted otherwise |
| `tvlUsd` | `size.usd` |
| `risk.utilization` | `borrowInfo.utilizationRate.value` × 100 |
| `risk.ltv` | `supplyInfo.maxLTV.value` × 100 |
| `risk.liquidationThreshold` | `supplyInfo.liquidationThreshold.value` × 100 |
| `risk.healthFactor` | omitted on the anonymous catalog |
| `assetAddresses` | `[underlying]` — never put `0x` into integer `assetIds` |
| `inputHints.poolId` | underlying ERC-20 |
| `inputHints.assetAddress` | underlying ERC-20 |

Dropped rows:

- `isFrozen` or `isPaused`
- `size.usd <= 0` or missing `supplyInfo.apy`
- zero supply APY when borrowing is not `ENABLED` (collateral-only)
- native ETH underlyings
- non-Base markets

## Execution

Unsigned calldata the client signs. Canix never collects interactive wallet signatures. `onBehalfOf` and the withdraw receiver are the quoting `userAddress`.

- Enter: `base:aave:v3:supply:erc20` — optional ERC-20 `approve(pool, amount)` then `supply`
- Exit: `base:aave:v3:withdraw:erc20`
- Manage (supplied position): `base:aave:v3:borrow:variable` — interest-rate mode `2`
- Exit (debt position): `base:aave:v3:repay:variable` — optional approve then `repay` at mode `2`

Quote-time `getConfiguration` rejects paused, frozen, or inactive reserves. Borrow also requires borrowing enabled.

## Isolation

An Aave GraphQL timeout must not fail the rest of `/opportunities`. `fetchOpportunitiesForProtocols` already degrades per adapter via `Promise.allSettled`.

## Tests

- `tests/unit/aave-normalize.test.ts`
- `tests/unit/aave-aggregate.test.ts`
- `tests/unit/aave-execution-shapes.test.ts`
- `tests/unit/aave-positions.test.ts`
- `tests/fixtures/adapters/aave-reserves.ts`
- `tests/integration/aave-execution-shapes.test.ts`
