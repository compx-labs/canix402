# STAMM v1 LP mint (execution shape)

- Shape key: `mainnet:stamm:v1:mint:lp`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/stamm/mint-lp.ts`
- Supported opportunity types: `lp`
- Required inputs: `userAddress`, `poolAppId`, `tierIndex`, `amountA` (pool-asset base units; `amountB` may be `0` for a one-sided mint). Alternative: omit `amountA`/`amountB` and pass `externalInputs` (any routable asset).
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

HOGSWAP `POST /quote` (`mode: LP_MINT`) then `POST /execute`. Canix returns an
**unsigned** group and never signs or broadcasts. Router app id is taken from
the live `/execute` response — do not hardcode it.

## Example request (pool assets)

```json
{
  "shapeKey": "mainnet:stamm:v1:mint:lp",
  "input": {
    "userAddress": "WALLET_ADDRESS",
    "poolAppId": 3544790053,
    "tierIndex": 1,
    "amountA": "1000000",
    "amountB": "0",
    "maxSlippageBps": 100
  }
}
```
<!-- pragma: allowlist secret -->

`amountA` / `amountB` are base units of the pool pair (asset A / asset B). One
side may be `0` for a single-sided mint. `poolAppId` is the STAMM pool
application id from opportunity `inputHints`, not a baked-in constant.

## Example request (external inputs)

```json
{
  "shapeKey": "mainnet:stamm:v1:mint:lp",
  "input": {
    "userAddress": "WALLET_ADDRESS",
    "poolAppId": 3544790053,
    "tierIndex": 1,
    "externalInputs": [{ "assetId": 3178895177, "amount": "1000000" }],
    "maxSlippageBps": 100,
    "maxLegs": 8
  }
}
```
<!-- pragma: allowlist secret -->

`externalInputs` (1–2) may be any routable asset. HOGSWAP converts into the
tier ratio and mints in one atomic group. Prefer `maxLegs` when composing with
other groups.

## Expected transaction group

Outer unsigned transactions from HOGSWAP `/execute` (`unsigned_group[].txn_b64`).
Group size varies with conversion legs. Canix does not rebuild or regroup.

## Validation invariants

- Non-empty atomic group; every sender is `userAddress`.
- At least one application call targeting the **live** `/execute` `router_app_id`
  (not a hardcoded id).
- Quote TTL ~30s (`DEFAULT_QUOTE_TTL_MS` / HOGSWAP quote lifetime).

## Caveats

Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#stamm).

- Wallet must already be opted into the LP ASA before execute.
- Quotes expire in ~30s (stale-quote). After a separate opt-in confirms, re-quote.
- Canix does not sign or submit.

## Tests

- Integration fixtures: `tests/integration/stamm-execution-shapes.test.ts`
