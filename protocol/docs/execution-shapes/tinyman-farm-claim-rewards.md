# Tinyman farm claim rewards

- Shape key: `mainnet:tinyman:staking-v1:farm:claimRewards`
- Role: manage (`farm`)
- Source module: `protocol/src/execution/shapes/tinyman/farm-claim-rewards.ts`

Claims unpaid Tinyman farm rewards. Transaction bytes are prepared by Tinyman
Analytics (`POST /staking/rewards/prepare-claim-transactions/`).

## Multi-signer claim group

Analytics returns an atomic group with at least:

1. User `appl` (`claim` on the staking app) — **user-signed**
2. TINY `axfer` from Tinyman’s distribution account (e.g. `2X5655…`) — **protocol-signed**

The distribution account is a Tinyman-controlled keyed account (`sig-type=sig`),
not a LogicSig. Canix never has that key and does **not** call Analytics submit
itself.

## Quote fields

| Field | Contents |
| --- | --- |
| `transactions` | Full group (inspection) |
| `encodedTransactions` | **User legs only** — safe for walletless mnemonic signing |
| `groupTransactions` | Full group with `signer: "user" \| "protocol"` |
| `userSignIndexes` | Indexes the client must sign |
| `metadata.submitMode` | `"tinyman-analytics-claim"` |
| `metadata.claimUrl` | Analytics claim endpoint |
| `metadata.unsignedProtocolTransactions` | Unsigned distribution leg(s) for the claim POST |

## Client submit flow (walletless)

1. Sign each `encodedTransactions` entry with the pooler key.
2. `POST` to `metadata.claimUrl` with:
   - `signed_transactions`: `[ <base64 user-signed appl> ]` (max 1)
   - `transactions`: `metadata.unsignedProtocolTransactions` (unsigned distribution axfer)
3. Tinyman cosigns the distribution leg and submits the atomic group. Response
   includes `transaction_id`.

Do **not** put the distribution sender in a mnemonic signer path, and do **not**
submit only the user-signed leg to algod.

## Required inputs

- `userAddress` (pooler address)
- `programId`
- `poolAddress`

## Caveats

- Depends on Tinyman Analytics availability and response format.
- Always inspect the returned group before signing.
- Fee pooling: sibling distribution axfers may have fee `0` when the user appl
  covers `n × minFee`.
