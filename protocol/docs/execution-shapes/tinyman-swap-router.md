# Tinyman v2 Swap Router

- Shape keys: `mainnet:tinyman:v2:swap:fixedInput`, `mainnet:tinyman:v2:swap:fixedOutput`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/tinyman/swap-router.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)
- Walletless: unsigned groups only. Canix does not sign or submit.

Tinyman Swap Router is **Tinyman-pool only**. It is not a cross-DEX aggregator.
Cross-router compare (Haystack, HOGSWAP, Pact, Folks) is a separate meta-quote
path.

## What this shape does

For a fixed-input or fixed-output swap, Canix:

1. Asks Tinyman’s off-chain Swap Router (`getSwapRoute` / quotes-v3) for the
   best Tinyman-pool route (1-hop or 2-hop).
2. Quotes the single-pool Tinyman v2 path for the same pair, when a ready pool
   exists.
3. Picks the **better net return** (higher expected out for fixed-input; lower
   expected in for fixed-output). Ties prefer the single-pool path (fewer
   transactions).
4. Builds an **unsigned** group via the JS SDK (`generateSwapRouterTxns` or
   `Swap.v2.generateTxns`).

`metadata.path` is `"router"` or `"direct"`. When the single-pool path wins,
`metadata.fallbackReason` is `single-pool-better`, `tied-prefer-single-pool`,
or `router-unavailable`. When no ready v2 pool exists, the router is used with
`fallbackReason: "no-single-pool"`.

## Required inputs

- `userAddress`
- `assetInId`
- `assetOutId`
- `amount` (base units; input amount for `fixedInput`, output amount for `fixedOutput`)
- `maxSlippageBps` (integer `0–10000`)

Example:

```json
{
  "shapeKey": "mainnet:tinyman:v2:swap:fixedInput",
  "input": {
    "userAddress": "WALLET_ADDRESS",
    "assetInId": 1732165149,
    "assetOutId": 0,
    "amount": "1000000",
    "maxSlippageBps": 50
  }
}
```
<!-- pragma: allowlist secret -->

The response includes `data.encodedTransactions` (base64 msgpack),
`data.transactions`, `data.expiresAt`, and `meta.executionSubmitted: false`.

## Expected transaction group

### Swap Router (winner)

Outer group from the Tinyman quotes-v3 recipe (typically input transfer/pay +
router app call; inner hops run inside the router):

1. Asset transfer or ALGO payment: user → router/pool, input amount.
2. Application call to the Swap Router app.
   - App args begin with `swap`, `fixed-input` or `fixed-output`, then min/exact
     output.
   - Accounts are the Tinyman pool addresses on the route.
   - Foreign apps include the AMM v2 validator.
   - Foreign assets include the hop ASAs (not ALGO).

There is **no extra router fee** beyond AMM v2. Extra transaction fees are
already included in the route suggestion.

A separate router `asset_opt_in` group (foreign assets, fee
`min_fee * (1 + n)`) is **not** merged into the swap. The wallet must already
be opted into the output ASA and any intermediary hop ASA.

### Single-pool fallback

Two outer transactions against the v2 validator (`swap` / `fixed-input` or
`fixed-output`), matching a normal Tinyman v2 swap. Documented in
`metadata.fallbackReason`.

## Role of Canix vs the SDK

`@tinymanorg/tinyman-js-sdk` is the canonical builder (`getSwapRoute`,
`Swap.v2` direct quotes, `generateSwapRouterTxns` / `generateTxns`). Canix
compares the two Tinyman paths, validates the unsigned group, and never calls
`signTxns` or `execute`.
