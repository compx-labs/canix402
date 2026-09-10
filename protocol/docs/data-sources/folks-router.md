# Folks Router V2 Data Source

This document defines the Folks Router V2 swap adapter used by canix402.

Folks Finance **lending** remains a separate adapter (`folks-finance.md`).
This file is only the **DEX aggregator** (`@folks-router/js-sdk` ≥ 0.3.1).

Folks Router is an **internal quote source**. It has no public HTTP routes and
no dedicated MCP tools. Agents call Haystack-named `canix_get_quote` /
`POST /swaps/quote`, which compares Folks with the other enabled adapters.

## Source Strategy

- Mode: SDK-first, V2-only
- Service: `src/services/folks-router.ts` (`createFolksRouterService`)
- Public HTTP: none (removed `/swaps/folks/*`)
- npm: `@folks-router/js-sdk`
- APIs: `https://api.folksrouter.io/v2/` (mainnet), `https://api.folksrouter.io/testnet/v2/`
- Router app ids: mainnet `3279848327`, testnet `748314673`
- Deprecated V1 hosts (`https://api.folksrouter.io/` without `/v2`) are rejected

`FOLKS_ROUTER_API_BASE_URL` is a V1-misconfig **guard only**. The SDK is
constructed as `FolksRouterClient(network, apiKey)` and does not take a base URL.

Quotes and prepared groups are **unsigned**. Canix does not sign or submit.

## Quote / prepare flow

1. `GET /fetch/discount` via `fetchUserDiscount(address)` when a sender is supplied.
   Discount lookup failure **does not fail the quote**: Canix quotes at the
   list-price 0.1% fee (`userFeeDiscount` 0, `applied` false) so a discount
   outage cannot block a multi-router compare.
2. `GET /fetch/quote` via `fetchSwapQuote({ fromAssetId, toAssetId, amount, swapMode }, …, userFeeDiscount)`.
3. `GET /prepare/swap` via `prepareSwapTransactions(params, userAddress, slippageBps, swapQuote)` → base64 unsigned txns.

Supports Tinyman, Pact, Humble; split routing and multi-hop; ~0.1% flat output fee.

## Canix DTOs

Quotes map into `FolksSwapQuote`:

| Folks field | Canix field | Notes |
|---|---|---|
| `quoteAmount` | `quotedAmount` | Base units, decimal string |
| `txnPayload` | `txnPayload` | Opaque string; pass back unchanged |
| `priceImpact` | `priceImpact` | Unchanged |
| `microalgoTxnsFee` | `microalgoTxnsFee` | Network fee hint in microAlgos |
| router app id | `requiredAppOptIns` / `routerAppId` | Mainnet `3279848327` |
| `userFeeDiscount` | `discount.userFeeDiscount` | Percent off the 0.1% fee |

`data.discount` is always present:

- `sender` — quote address, or `null` when omitted
- `userFeeDiscount` — 0–50 integer percent
- `applied` — `true` only when sender was set and the discount was sent to `/fetch/quote`
- `tiers` — FOLKS holdings schedule (0 / 10 / 20 / 30 / 40 / 50%)

Prepared groups map into the walletless swap DTO: every member is `signer: "user"`. `routeKind` is `multi-hop` when `hopCount > 1` (`hopCount = max(1, groupSize - 2)`). `meta.executionSubmitted` stays `false`.

Slippage on `buildSwapTransactions` is a **percent** (same as Haystack, `1` = 1%). Canix converts it to Folks `slippageBps` (`1%` → `100`).

## Environment Variables

- `FOLKS_ROUTER_NETWORK` (`mainnet` default, or `testnet`)
- `FOLKS_ROUTER_API_KEY` (optional; SDK `/v2/pro` when set)
- `FOLKS_ROUTER_REFERRER_ADDRESS` (optional; falls back to `X402_PAYMENT_RECEIVER_ADDRESS`)
- `FOLKS_ROUTER_API_BASE_URL` (optional; must include `/v2`; V1-guard only)
- `X402_ALGOD_URL` / `X402_ALGOD_TOKEN` (opt-in checks)

## Known Caveats

- Quotes expire after ~30s. Refresh after submitting opt-ins.
- Folks does not pre-sign any group member. Sign every `userSignIndexes` leg locally.
- Discount is computed at quote time. Changing sender between quote and prepare is rejected when `quote.address` is set.
- Public `/swaps/*` and compose/plans include Folks in the parallel compare when
  the adapter is enabled.

## Tests

Fixture-based quote + unsigned prepare coverage:

- `tests/unit/folks-router.test.ts`
- `tests/fixtures/folks-router.ts` — FIXED_INPUT ALGO→USDC and GOLD→USDC multi-hop

Production live (service-level, no x402):

- `tests/live/folks-router-production-swap.test.ts` (`X402_FOLKS_ROUTER_SWAP_LIVE=1`)
  quotes 0.1 USDC → ALGO via `createFolksRouterService()`, submits opt-ins,
  re-quotes, prepares the unsigned group, signs every user member, and broadcasts.
