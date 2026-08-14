# Claim desk, debt-aware positions, and Tinyman COMPX/ALGO

**Date:** 14 August 2026

Walletless harvest flow for accrued DeFi rewards, more accurate executable borrow/debt rows on `/positions`, and a force-include for the Tinyman COMPX/ALGO LP pool so agents can discover and quote it even when it falls outside the top-N Tinyman Analytics list. Canix never holds keys or submits transactions.

## What shipped

### Tinyman COMPX/ALGO LP

Tinyman discovery only pulls the top `TINYMAN_POOL_LIMIT` pools (default 100). The verified COMPX/ALGO v2 pool often sits below that cut because of lower liquidity, so it never appeared in Tinyman opportunities.

The adapter now also fetches pinned pools by address via `GET /pools/{address}/`, merges/dedupes with the list, and runs them through the same verified + APY/TVL normalize path. Extra-fetch failures are non-fatal.

| Field | Value |
| --- | --- |
| Pool address | `ZKAP7DLHJ25VTHPD3W73FGDM7VGU3DJAXL7GNUFW5CG4MIMY72EZ5GFIAI` |
| `opportunityId` | `ZKAP7…:lp` |
| Assets | COMPX `1732165149` / ALGO `0` |
| Agent hints | `executionShapes[].inputHints`: `assetAId`, `assetBId`, `poolId` (pool address) |

No per-pool app id is required: Tinyman LP quotes still resolve the validator app and pool from the asset pair at execution time. Optional env `TINYMAN_EXTRA_POOL_ADDRESSES` (CSV) adds more addresses; COMPX/ALGO is included by default in code.

Find it via `GET /opportunities/search?platform=tinyman&assetIds=1732165149` (or MCP `canix_search_opportunities`). Default APY-ranked pages are unchanged.

### Claim desk

Paid `GET /positions/claimable?address=` projects existing reward rows (plus Tinyman stALGO) into a claim desk: USD value, conservative network-fee / `worthClaiming` hints, allowlisted claim `shapeKey`s, and ready-to-POST quote inputs.

Compile with the existing compiler: pass `claimAllQuotes` (or selected per-row quotes) to `POST /execution/quotes`. Each `quotes[]` item becomes its own unsigned group; groups are never merged. MCP exposes the same loop as `canix_list_claimable` → `canix_get_execution_quote`.

### Debt-aware positions

`GET /positions` / `canix_get_positions` now surfaces executable liabilities more honestly:

| Protocol | Change |
| --- | --- |
| **DorkFi** | Emits `dorkfi:debt:{marketAppId}` from on-chain `get_user` / borrow principal (not wallet UNIT). Exit: `mainnet:dorkfi:v1:repay:asa`. Pool-level `debt-usd` remains informational. |
| **CompX** | Fixes under-reported `amountRaw` / USD by converting SDK human-unit `borrowed` via `standardToMicro`. |
| **Folks** | Discovers loan escrows via indexer, then reads loan/debt state via **algod** so debt appears promptly after `borrow:variable` (no client wait/synthesis). Escrow/pool `inputHints` unchanged. |

If debt cannot be priced, the row is kept with `usdValue: null` and a clear caveat — omission is worse for NAV. When a debt-capable collector (Folks, CompX, DorkFi) fails, `totals.borrowedUsd` is null rather than a falsely complete zero.

## Pricing

| Step | Route / tool | Price |
| --- | --- | --- |
| List claimable | `GET /positions/claimable` / `canix_list_claimable` | **0.001 USDC** |
| Positions | `GET /positions` / `canix_get_positions` | existing positions price |
| Compile | `POST /execution/quotes` / `canix_get_execution_quote` | **0.10 USDC** flat per request |

Caddy env: `X402_PRICE_POSITIONS_CLAIMABLE_USDC=0.001` (1000 micro-USDC). Set it on both the gateway and protocol components so discovery matches the gate.

## Coverage

**Claim desk:** Tinyman farm, Tinyman stALGO TINY claim, CompX staking, Pact farm, Haystack, Alpha Arcade. Réti is not included. Haystack USDC+HAY and Pact multi-ASA farms share one `claimKey` / compile entry each.

Fee hints compare reward USD to estimated network fees only; they are not a simulation. Synthetic stALGO rows (TINY amount unknown) are excluded from wallet `claimableUsd` / `worthClaimingUsd` completeness.

**Debt:** CompX, Folks Finance, and DorkFi executable debt rows as above.

## Agent loop

### Claim

1. Optional `GET /positions` / `canix_get_positions`
2. `GET /positions/claimable` / `canix_list_claimable`
3. Filter by `worthClaiming` / `claimKey`
4. `POST /execution/quotes` with `claimAllQuotes` or selected quotes
5. Sign and submit locally (Tinyman farm claims use Analytics cosign, not raw algod submit)

### Repay debt

1. `GET /positions` / `canix_get_positions` — use `positionType: "debt"` rows and `compatibleExitShapeKeys`
2. `POST /execution/quotes` with the repay `shapeKey` and position `inputHints` / `amountRaw`
3. Sign and submit locally
