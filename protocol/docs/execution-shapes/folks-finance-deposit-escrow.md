# Folks Finance v2 Escrow Deposit (execution shape)

Deposits an underlying asset into a Folks Finance lending pool via a **deposit
escrow**. fAssets accrue in the escrow, not the user's wallet.

- Shape key: `mainnet:folks-finance:v2:deposit:escrow`
- Source module: `src/execution/shapes/folks-finance/deposit-escrow.ts`
- Paid API endpoint: `POST /execution/quotes` (0.1 USDC via x402)

## Prerequisites

1. Run `mainnet:folks-finance:v2:setup:depositEscrow` if the user has no escrow.
2. Run `mainnet:folks-finance:v2:setup:optEscrowAsset` for the target pool fAsset.
3. Ensure the user holds enough underlying asset.

Do not merge those groups. Confirm each, then re-quote. Protocol-wide Folks
construction notes (indexer escrow discovery, 0.25 / 0.1 ALGO MBR, OpUp,
escrow key metadata): [protocol-caveats.md](./protocol-caveats.md#folks-finance).

## Example request

```json
{
  "shapeKey": "mainnet:folks-finance:v2:deposit:escrow",
  "input": {
    "userAddress": "YOUR_ALGORAND_ADDRESS",
    "poolAppId": 971372237,
    "escrowAddress": "YOUR_DEPOSIT_ESCROW_ADDRESS",
    "assetAmount": "1000000"
  }
}
```

If `escrowAddress` is omitted, Canix resolves it via the indexer (`X402_INDEXER_URL`).

## Expected transaction group

With `includeOpUp: true` (default): OpUp + asset transfer + pool `deposit` app call (3 txns).

## Related shapes

| Shape | Purpose |
|---|---|
| `setup:depositEscrow` | Create a new deposit escrow |
| `setup:optEscrowAsset` | Opt escrow into a pool fAsset |
| `withdraw:escrow` | Withdraw underlying asset to wallet |
