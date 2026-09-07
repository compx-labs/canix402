# Swap-aware enter compose

- Shape keys: `mainnet:swap:router:optin:required`, `mainnet:swap:router:swap:fixed-input`
- Product: sequenced **opt-in → winning swap → enter** groups driven by `requiredAssetIds`
- Paid APIs: `POST /execution/compose` (0.10 USDC) and `POST /plans` (0.25 USDC, composes when the budget asset is not the enter asset)
- Walletless: unsigned, **unmerged** groups. Canix does not sign or submit.

The swap leg uses the same multi-router compare as `POST /swaps/quote`: enabled
adapters quote in parallel and only the winner is compiled. Shape keys stay
stable (`mainnet:swap:router:…`) for group ordering; `identity.protocol` is
`swap` and the winning router is `metadata.router`.

## Behavior

Given “I hold asset A, I want this opportunity”:

1. Resolve the unique enter asset from the opportunity’s `requiredAssetIds`.
   Two-sided LP (more than one required id) is not auto-composed.
2. If asset A already matches, skip swap and compile enter as today.
3. Otherwise fetch a live multi-router quote (`fixed-input` A → required asset),
   build any missing output-asset / app opt-ins as a **separate** group, then
   build the winning swap group with signer indexes and any pre-signed members.
4. Compile enter with a slippage haircut of `quotedAmount`. Setup chains
   (Folks escrow, etc.) stay deferred when prerequisites are unknown.

Clients must submit groups in `order` / `prerequisiteShapeKeys` sequence.
Sign only `userSignIndexes` / `signer: "user"` legs. Preserve
`signedTransaction` members and group order.

## Failure modes (plan/shape caveats)

These warnings are attached to compose steps:

| Mode | What happens | What to do |
| --- | --- | --- |
| **Stale quote** | Quotes expire at `quote.expiresAt` (typically ~30s). After an opt-in confirms, the swap group is likely stale. | Submit swap before expiry. After opt-in, re-call `POST /execution/compose` or `POST /swaps/quote` then `POST /swaps/transactions`, then `POST /execution/quotes` for enter. |
| **Missing opt-in** | Swap members fail on-chain if the wallet is not opted into the output asset or required apps. Opt-in is a separate group and is never merged into the swap. | Submit the opt-in group, wait for confirmation, then submit swap (refresh if expired). |
| **Slippage** | Min-out uses the requested slippage percent. Actual output may be below `quotedAmount`. Enter is compiled with a haircut of the quoted output. | If the confirmed swap delivers less than the haircut, the enter group may fail. Re-quote enter via `POST /execution/quotes` with the received amount. |

Quote-time on-chain checks remain authoritative. Paying for compose or a plan does not execute it.
