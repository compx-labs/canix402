# STAMM v1 LP redeem (execution shape)

- Shape key: `mainnet:stamm:v1:redeem:lp`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/stamm/redeem-lp.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

HOGSWAP `POST /quote` (`mode: LP_REDEEM`) then `POST /execute`. Canix returns an
**unsigned** group and never signs or broadcasts. Router app id is taken from
the live `/execute` response — do not hardcode it.

## Example request

```json
{
  "shapeKey": "mainnet:stamm:v1:redeem:lp",
  "input": {
    "userAddress": "WALLET_ADDRESS",
    "poolAppId": 3544790053,
    "tierIndex": 1,
    "lpAmount": "1000000",
    "targetAsset": 0,
    "maxSlippageBps": 100
  }
}
```
<!-- pragma: allowlist secret -->

`lpAmount` is LP base units to burn. `targetAsset` may be a pool underlying
(`0` = ALGO) or any routable asset (HOGSWAP converts). Prefer `maxLegs` when
composing with other groups.

## Expected transaction group

Outer unsigned transactions from HOGSWAP `/execute`. Group size varies with
conversion legs. Canix does not rebuild or regroup.

## Validation invariants

- Non-empty atomic group; every sender is `userAddress`.
- At least one application call targeting the **live** `/execute` `router_app_id`.
- Quote TTL ~30s.

## Caveats

Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#stamm).

- Wallet must already be opted into the LP ASA and the target asset.
- Quotes expire in ~30s (stale-quote). Re-quote after opt-in confirmation.
- Canix does not sign or submit.

## Tests

- Integration fixtures: `tests/integration/stamm-execution-shapes.test.ts`
- Production live (x402 + on-chain): `tests/live/stamm-production-test.test.ts`
  (`X402_STAMM_EXECUTION_LIVE=1`; redeem minted LP to ALGO)
