# Strategy Marketplace

Canix is the validation, discovery, compilation, and fee-sharing layer for
third-party strategies. Creators publish bound compositions of verified
execution shapes; Canix does not author strategies.

## Identity

`strategyId` ≡ Algorand ASA id of the strategy NFT. API paths use
`{strategyId}` only. Revision state lives in Spaces JSON metadata
(`createdAt`, `lastRevisedAt`), never in the id or URL.

## Document (Spaces)

Object key: `strategies/{strategyId}.json`

| Field | Role |
|-------|------|
| `strategyId` | ASA id |
| `creatorAddress` | Original publisher (provenance; immutable) |
| `createdAt` / `lastRevisedAt` | Timestamps; cooldown uses `lastRevisedAt` |
| `name` / `description` / `tags` | Website / discovery display |
| `legs[]` | `shapeKey` + venue pin + `weightBps` (weights only; agents supply capital / swaps) |
| `status` | `published` \| `suspended` \| `degraded` \| `archived` |

## Economics

| Action | Price | Holder share |
|--------|-------|----------------|
| Publish `POST /strategies` | 100 USDC | Canix-only |
| Revise `POST /strategies/{strategyId}` | 1 USDC | Canix-only |
| Compile `POST /strategies/{strategyId}/compile` | 0.1 USDC | 50% → NFT holder (weekly) |

Revise: NFT holder only; once per 14 days per `strategyId` (cooldown not reset on transfer).

Access payments settle 100% to Canix `payTo` (leaderboard). Weekly job pays
NFT holders from a dedicated payout wallet using tagged notes
`x402:v2:strategy:{strategyId}`.

## Endpoints

- `GET /strategies` — list (free)
- `GET /strategies/{strategyId}` — detail (free)
- `POST /strategies` — publish (paid 100 USDC)
- `POST /strategies/{strategyId}` — revise (paid 1 USDC)
- `POST /strategies/{strategyId}/compile` — scale weights → execution quotes (paid 0.1 USDC)
