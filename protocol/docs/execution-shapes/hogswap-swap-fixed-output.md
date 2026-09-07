# HOGSWAP v1 swap (exact-out)

- Shape key: `mainnet:hogswap:v1:swap:fixed-output`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/hogswap/swap.ts`
- Supported opportunity types: `swap` (router source — not a yield venue)
- Required inputs: `userAddress`, `fromAssetId`, `toAssetId`, `amount` (desired output base units of `toAssetId`)
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

HOGSWAP `POST /quote` (`mode: SWAP`, `amount_out`) then `POST /execute`. The
solver finds the minimum input; the on-chain floor is the requested output.
Canix returns an **unsigned** group and never signs or broadcasts.

Prefer `mainnet:hogswap:v1:swap:fixed-input` when the spend amount is known.
This variant is for exact-out. It does not replace Haystack `/swaps/*`.

## Example request

```json
{
  "shapeKey": "mainnet:hogswap:v1:swap:fixed-output",
  "input": {
    "userAddress": "WALLET_ADDRESS",
    "fromAssetId": 0,
    "toAssetId": 31566704, <!-- pragma: allowlist secret -->
    "amount": "100000",
    "maxSlippageBps": 50
  }
}
```
<!-- pragma: allowlist secret -->

`amount` is the desired output in `toAssetId` base units. Optional `maxHops` /
`maxLegs` as on the fixed-in shape.

## Expected transaction group

Same as [hogswap-swap-fixed-input.md](./hogswap-swap-fixed-input.md): unsigned
HOGSWAP `/execute` members, all `signer: user`.

## Caveats

Protocol-wide notes: [protocol-caveats.md](./protocol-caveats.md#hogswap).
Routing fee is already netted into `expectedOut`. Canix does not sign or submit.
