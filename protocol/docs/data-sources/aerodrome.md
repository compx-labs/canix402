# Aerodrome Data Source

This document defines the Aerodrome basic-pool adapter used by canix402. One farm
row per voter-whitelisted volatile or stable pool with a live gauge. Enter is
add-liquidity then gauge stake. Exit is gauge withdraw then remove-liquidity.
Slipstream concentrated liquidity, swaps, veAERO, bribes, reward claims, and
unstaked LP are out of scope.

Algorand analogue: Pact farm (two-sided LP plus stake) as unsigned Base calldata.

## Source Strategy

- Mode: on-chain LpSugar catalog + DefiLlama token prices + Router quotes at quote time
- Adapter file: `src/adapters/aerodrome.ts`
- Execution shapes: `src/execution/shapes/aerodrome/`
- Catalog: `LpSugar.all(limit, offset, 1)` on `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1`
- The deployed method takes three arguments. The two-argument form reverts. Filter `1` keeps pools whose tokens are voter-whitelisted. Walk `offset` through `count()`. A short page is not the end of the list.
- Prices: `GET https://coins.llama.fi/prices/current/base:{token},...`
- Network: Base (`chainId` 8453). Rows always carry `chain: "base"`.
- Positions: staked LP via `Gauge.balanceOf` for catalogued pools on `GET /positions`. Unclaimed AERO and unstaked LP are omitted.

## Environment Variables

- `AERODROME_SUGAR_ADDRESS` (optional; default `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1`)
- `AERODROME_SUGAR_PAGE_SIZE` (optional; default `100`, max `200`. `500` can exceed public Base RPC gas)
- `AERODROME_MIN_TVL_USD` (optional; default `50000`)
- `AERODROME_CATALOG_TTL_SEC` (optional; default `600`)
- `AERODROME_PRICE_URL` (optional; default `https://coins.llama.fi/prices/current`)
- `BASE_RPC_URL` (catalog, quotes, and positions; default `https://mainnet.base.org`)

x402 accepts Algorand USDC and, when `X402_PAY_TO_BASE` is a real address, Base USDC at the same price. Algorand stays the first accept.

## Field Mapping

`Lp.emissions` is the reward token per second. Headline APY is emissions APR on staked liquidity only. Trading fees accrue to voters, not stakers, so fee APR is not added.

| Canix field | Source |
| --- | --- |
| `protocol` | `aerodrome` |
| `chain` | `base` |
| `opportunityType` | `farm` |
| `opportunityId` | `aerodrome-farm-{pool}` (lowercase) |
| `assetPair` | priced `token0/token1` symbols |
| `apy` / `yieldBasis` | `emissions * 31536000 * emissionsUsd / stakedTvlUsd * 100`, `yieldBasis: apy` |
| `tvlUsd` | reserve value of both tokens |
| `assetAddresses` | `[token0, token1]` — never put `0x` into integer `assetIds` |
| `inputHints.poolId` | pool address |
| `notes` | stable or volatile; emissions token; fees go to voters |

Dropped rows:

- Slipstream (`type > 0`)
- `gauge_alive` false, zero emissions, or zero staked TVL
- TVL below `AERODROME_MIN_TVL_USD`
- missing token or emissions price
- factory other than `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`
- native ETH underlyings

## Execution

Unsigned calldata the client signs. Canix never collects interactive wallet signatures. The LP receiver is the quoting `userAddress`.

- Enter: `base:aerodrome:v2:deposit:gauge` — optional approves, `Router.addLiquidity`, optional LP approve, `Gauge.deposit`
- Exit: `base:aerodrome:v2:withdraw:gauge` — `Gauge.withdraw`, optional LP approve, `Router.removeLiquidity`

Router `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`. Voter `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`.

Quote-time reads reject a dead gauge, a non-basic factory, and native ETH. Mins use `quoteAddLiquidity` / `quoteRemoveLiquidity` and `slippageBps` (default 50, max 1000). Calldata `deadline` is quote time plus 20 minutes. Broadcast the group in order: the stake leg must follow add-liquidity.

## Isolation

A Sugar or price timeout must not fail the rest of `/opportunities`. `fetchOpportunitiesForProtocols` already degrades per adapter via `Promise.allSettled`. The normalized catalog is cached in-process for `AERODROME_CATALOG_TTL_SEC` because a full Sugar scan is many heavy `eth_call`s.

## Tests

- `tests/unit/aerodrome-normalize.test.ts`
- `tests/unit/aerodrome-aggregate.test.ts`
- `tests/unit/aerodrome-execution-shapes.test.ts`
- `tests/unit/aerodrome-positions.test.ts`
- `tests/fixtures/adapters/aerodrome-pools.ts`
- `tests/integration/aerodrome-execution-shapes.test.ts`
