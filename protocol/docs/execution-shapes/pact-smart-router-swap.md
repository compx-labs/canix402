# Pact Smart Router fixed-input swap (execution shape)

- Shape key: `mainnet:pact:smart-router:swap:fixed-input`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/smart-router-swap.ts`
- Supported opportunity types: none (standalone swap; not attached to Pact LP/farm rows)
- Required inputs: `userAddress`, `fromAssetId`, `toAssetId`, `amount`, `maxSlippageBps`
- Optional input: `routerAppId` (otherwise `PACT_SMART_ROUTER_APP_ID`)
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Quotes a **1–3 hop** Pact route and returns an **unsigned** deposit + router
`SWAP` group. Canix does not sign or submit. This is **not** Haystack
(`POST /swaps/*`) and **not** a direct single-pool Pact `SWAP` against the AMM
app.

## Quote source (spike)

`@pactfi/pactsdk` has no Smart Router helpers. Public swagger exposes market
endpoints (`GET /prices`), not a route solver. Live probes of `/api/quote`,
`/api/router`, `router.pact.fi`, and similar hosts did not yield a quote API.

Canix therefore quotes locally:

1. Discover pools: `GET {PACT_API_BASE_URL}/pools` (paginated; fallback
   `GET /pools/all`).
2. Per-hop quote: `@pactfi/pactsdk` `Pool.prepareSwap` (on-chain reserves via
   algod). Intermediate hops use 0% SDK slippage; expected out is chained.
3. Pick the best 1–3 hop path (best fee-tier pool per hop, up to four pools
   per pair). The published router `SWAP` ABI has no per-leg amount, so the
   group is sequential hops, not parallel knapsack splits.

On-chain group shape: [pact-docs router.md](https://github.com/pactfi/pact-docs/blob/master/router.md)
and `router_interface.json`.

## Example request

```json
{
  "shapeKey": "mainnet:pact:smart-router:swap:fixed-input",
  "input": {
    "userAddress": "WALLET_ADDRESS",
    "fromAssetId": 0,
    "toAssetId": 888000001,
    "amount": "1000000",
    "maxSlippageBps": 50,
    "routerAppId": 900000001
  }
}
```

`amount` is base units of `fromAssetId` (ALGO `0` = microAlgos). `routerAppId`
may be omitted when `PACT_SMART_ROUTER_APP_ID` is set. Canix does not ship a
guessed mainnet router id.

## Expected transaction group

Unsigned atomic group (no `OPTIN`/`OPTOUT`; SUPEROPTIN assumed):

1. Deposit of the source asset to the Smart Router application address
   (ALGO payment or ASA transfer).
2. Router `SWAP(...)` app call(s):
   - 1 hop: one 1-pool `SWAP` (`3a8c06cf`)
   - 2 hops: one packed 2-pool `SWAP` (`84dd8e10`)
   - 3 hops: packed 2-pool `SWAP` (`min_expected = 0`) then 1-pool `SWAP`
     with `min_expected`

`min_expected` is applied only on the last SWAP:
`amountOut * (10000 - maxSlippageBps) / 10000`.

## Validation invariants

- Deposit targets the router application address with the requested amount.
- App calls target `routerAppId` with the 1-hop or 2-hop SWAP selector.
- Foreign apps / accounts include each hop’s pool app id and pool escrow.
- All members share one group id. Transactions are unsigned.

## Caveats

Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#pact).

- Wallet must already be opted into the output ASA.
- Quotes expire after 30 seconds (`DEFAULT_QUOTE_TTL_MS`).
- Do not confuse this shape with Haystack or with Pact LP/farm enters.

## Tests

- Unit: `tests/unit/pact-smart-router.test.ts`
- Integration fixtures: `tests/integration/pact-smart-router-shapes.test.ts`
  (single-pool and multi-hop unsigned groups)
- Production live (x402 + on-chain): `tests/live/pact-smart-router-production-test.test.ts`
  (`X402_PACT_SMART_ROUTER_LIVE=1`; 0.1 USDC → ALGO)
