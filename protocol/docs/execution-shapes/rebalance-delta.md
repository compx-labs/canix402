# Rebalance / delta quotes

- Paid API: `POST /plans/rebalance` (0.25 USDC)
- MCP: `canix_get_rebalance_plan`
- Walletless: unsigned, **unmerged** groups. Canix does not sign or submit.

Positions are the book; opportunities are the menu. The compiler emits only the
legs that change the book — not a full unwind-and-rebuild.

## Request

Provide `address` plus at least one of:

| Field | Meaning |
| --- | --- |
| `targetWeights` | `{ opportunityId, weightBps }[]` summing to 10000. Only listed ids are in the universe; other positions are left alone. |
| `harvestIdle` | Claim worth-claiming rewards (claim desk) and treat wallet ALGO above `algoReserveMicroAlgos` (default 1 ALGO) as capital to redeploy. |

Optional: `includeClaims`, `minDeltaBps` (default 50), `constraints`, `swapSlippage`, `refresh`.

## Graph

1. **Claims** (when `harvestIdle` / `includeClaims`) — `claimAllQuotes`-compatible inputs, groups never merged.
2. **Exits** — overweight vs target uses a **partial** `amountRaw` scaled by USD; target weight 0 is a full exit. Uses `compatibleExitShapeKeys[0]` on the position.
3. **Enters** — idle ALGO (and live multi-router compose when the enter asset differs) via the same eligibility + compose path as `POST /plans`. Enter that would spend unconfirmed exit proceeds is `compileStatus: deferred`.

Dust gaps below `minDeltaBps` are skipped.

## Agent loop

1. Optional `canix_get_positions` / `canix_list_claimable`
2. `canix_get_rebalance_plan` / `POST /plans/rebalance`
3. Review `blocked[]`, step warnings, and `meta.groupsMerged === false`
4. Sign only user legs. Submit each group separately in `order` / `prerequisiteShapeKeys` before `expiresAt`.

Paying for the plan does not execute it.
