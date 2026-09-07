# HOGSWAP v1 swap (fixed-in)

- Shape key: `mainnet:hogswap:v1:swap:fixed-input`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/hogswap/swap.ts`
- Supported opportunity types: `swap` (router source — not a yield venue)
- Required inputs: `userAddress`, `fromAssetId`, `toAssetId`, `amount` (base units of `fromAssetId`), `maxSlippageBps` (default 50)
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

`resolveState` calls `POST /quote` (`mode: SWAP`, `amount_in`) only.
`build` then calls `POST /execute` for the unsigned group. Router app id is
taken from the live `/execute` response — do not hardcode it. Canix never
signs or broadcasts.

This shape is a **router adapter**. It does not replace Haystack `/swaps/*`.
Treat HOGSWAP as one Canix router source for later meta-compare.

## Example request (ALGO → USDC)

```json
{
  "shapeKey": "mainnet:hogswap:v1:swap:fixed-input",
  "input": {
    "userAddress": "WALLET_ADDRESS",
    "fromAssetId": 0,
    "toAssetId": 31566704, <!-- pragma: allowlist secret -->
    "amount": "1000000",
    "maxSlippageBps": 50
  }
}
```
<!-- pragma: allowlist secret -->

`amount` is base units of `fromAssetId` (1 ALGO = 1,000,000). `fromAssetId` `0`
is native ALGO. Optional `maxHops` (1–4) and `maxLegs` (1–16) cap route depth
and total legs.

## Expected transaction group

Outer unsigned transactions from HOGSWAP `/execute` (`unsigned_group[].txn_b64`).
Group size varies with route legs. Every member is `signer: user`. Canix does
not rebuild, regroup, sign, or submit.

## Validation invariants

- Non-empty atomic group; every sender is `userAddress`.
- At least one application call targeting the **live** `/execute` `router_app_id`.
- Quote TTL ~30s (`DEFAULT_QUOTE_TTL_MS` / HOGSWAP quote lifetime).

## Caveats

Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#hogswap).

- Routing fee (~5 bps of output; HOG holdings discount; waived at 100+ HOG) is
  **already netted** into `expectedOut` / `quotedAmount`. Do not subtract it twice.
- Wallet must already be opted into the output ASA (when it is not ALGO) before execute.
- Quotes expire in ~30s (stale-quote). After a separate opt-in confirms, re-quote.
- Canix does not sign or submit.

## Tests

- Unit: `tests/unit/hogswap-quote.test.ts`, `tests/unit/hogswap-router.test.ts`
- Integration: `tests/integration/hogswap-execution-shapes.test.ts`
- Fixtures: `tests/fixtures/hogswap/swap.ts` (ALGO→USDC and GOLD→USDC)
- Production live (x402 + on-chain): `tests/live/hogswap-production-swap.test.ts`
  (`X402_HOGSWAP_SWAP_LIVE=1`; 0.1 USDC → ALGO via `POST /execution/quotes`)
