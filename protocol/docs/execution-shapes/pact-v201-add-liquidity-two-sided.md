# Pact v201 Two-Sided Add Liquidity (execution shape)

- Shape key: `mainnet:pact:v201:addLiquidity:twoSided`
- Shape version: `1.0.0`
- Source module: `src/execution/shapes/pact/add-liquidity-managed-weighted.ts`
- Supported opportunity types: `lp`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

Listed Pact LP rows are contract version `201` `MANAGED_WEIGHTED` pools. This
shape is the exclusive enter step on those rows. The v1 `ADDLIQ` shape stays
registered for legacy pools and is not attached to listed opportunities.

## Example request

```json
{
  "shapeKey": "mainnet:pact:v201:addLiquidity:twoSided",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 3662410374,
    "assetAId": 0,
    "assetAAmount": "1000000",
    "assetBId": 31566704,
    "assetBAmount": "100000",
    "maxSlippageBps": 50
  }
}
```

## Expected transaction group

Deposits go to the vault application address read from the pool global `vault`,
not a pool escrow. The group is three transactions, or four when the wallet is
not opted into the LP token:

1. Zero-amount LP opt-in to the sender, only when the account is not opted in.
2. Deposit `asset_a` to the vault (ALGO payment when the asset id is `0`).
3. Deposit `asset_b` to the vault.
4. Application call on the pool. Selector `ZEkhvw==`, no further arguments.
   Foreign app is the vault. Foreign assets are the non-ALGO pool asset and the
   LP token. Box refs on the vault are the 8-byte asset ids.

The outer app-call fee is 3000 microAlgos so the pool can pay its vault inners.

## Validation invariants

- Group length is 4 with the opt-in, otherwise 3. All transactions share a group.
- Deposits target the vault address with the pool-ordered amounts.
- App call targets `poolAppId` with selector `ZEkhvw==` and no extra arguments.
- Box names are `asset_a` then `asset_b`, and each box app index is the vault.

## Caveats

- The add call has no minimum-LP argument. Slippage is enforced when the quote
  is built: the deposit ratio must stay within `maxSlippageBps` of
  `reserve_a` / `reserve_b`. Pools with `bootstrapped` other than `1` are rejected.
- A proportional join follows reserves, which already reflect `weight_a`.
- Quote metadata includes `expectedMintedLiquidityTokens`. That amount is not
  an on-chain argument, so this shape is not composed with farm stake in one group.
- Quotes expire after 30 seconds; recompile before signing stale groups.

## Tests

- Integration fixtures: `tests/integration/pact-managed-weighted-shapes.test.ts`
