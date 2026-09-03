---
name: use-canix402-mcp
description: Interact with canix402 MCP paid tools by handling x402 preflight responses, validating payment requirements, creating and signing Algorand USDC payment transactions, retrying with paymentSignature, and signing executable quote groups locally. Use when calling canix_* paid tools or handling PAYMENT_REQUIRED, PAYMENT-SIGNATURE, paymentGroup, or encodedTransactions.
---

# Use the canix402 MCP

Use this workflow for canix402 MCP paid tools. The MCP server is walletless: it
forwards a signed x402 payment but never receives a mnemonic, private key, or
wallet session.

## Keep the two signatures separate

1. **x402 payment signature** pays for the API response. Pass its base64
   envelope back to the same MCP tool as `paymentSignature`.
2. **Execution signature** authorizes transactions returned by
   `canix_get_execution_quote`. Sign and submit those transactions only after
   receiving and reviewing the paid response.

Paying for a quote does not execute the quote. Canix neither signs nor submits
the returned execution group.

## Paid MCP workflow

1. Call the paid `canix_*` tool without `paymentSignature`.
2. Expect a result containing:
   - `error: "PAYMENT_REQUIRED"`
   - `mcpPayment.paymentRequired`
   - `mcpPayment.paymentRequiredHeader`
   - `request`, containing the request that must be retried
3. Select an Algorand accept option from
   `mcpPayment.paymentRequired.accepts`.
4. Validate the requirement before signing:
   - `scheme` is `exact`
   - `network` is the intended Algorand network
   - `asset` is the asset the user approved paying
   - `payTo` is a valid Algorand address
   - `maxAmountRequired ?? amount` is present and within the user's budget
   - `resource.url`, when present, is the expected canix402 gateway resource
5. Build and sign the payment locally.
6. Retry the same MCP tool with the same arguments plus `paymentSignature`.
   Do not change query/body arguments between preflight and retry.
7. Require a successful tool result. Record
   `mcpPayment.paymentResponseHeader` when present.

Treat amounts without a decimal point as base units. USDC has six decimals, so
`10000` is 0.01 USDC. Never substitute a documented price for the live
`PAYMENT_REQUIRED` amount.

## Prepaid sessions (optional second money model)

Exact-scheme one-shots remain the default. Operators who would otherwise spray
tiny USDC transfers can buy one session instead:

1. Call `canix_create_session` without `paymentSignature`, then retry with it
   (~0.25 USDC). The result is a walletless receipt (`canix://session/{id}`).
2. Pass that id as `sessionReceipt` on research/quote tools (`X-Canix-Session`).
3. Read remaining N/M with `canix_get_session` or resource `canix://session/{sessionId}`. `canix://session` is policy only (budget/TTL), not remaining quota.
4. Create/refresh cannot be paid with a session. On `SESSION_EXPIRED`,
   `SESSION_EXHAUSTED`, or `SESSION_INVALID`, **omit** `sessionReceipt` and
   either refresh (`canix_refresh_session`) or retry with `paymentSignature`.
   Caddy skips x402 when `X-Canix-Session` starts with `csess_`, so a stale header
   must be dropped before a one-shot will work. If both `paymentSignature` and
   `sessionReceipt` are passed, the payment wins and the session header is omitted.

## Remote signing model

Do not assume the remote MCP exposes an npm package or has access to a wallet.
The agent must use a signer available in its own environment, such as:

- a connected wallet or wallet SDK
- Algorand signing tools exposed by a separate, trusted MCP server
- a local script using `algosdk`

If using another MCP server for wallet operations, inspect its live tool
schemas before calling it. Do not invent tool names or assume it can construct
the complete x402 envelope. It may only be able to sign transaction bytes.

The local workflow is:

1. Get fresh suggested transaction parameters from an Algod provider.
2. Construct the transaction group from the live accept option.
3. Present the transaction details for approval when required.
4. Sign only transactions owned by the payer.
5. Construct and base64-encode the x402 envelope below.
6. Pass only that `paymentSignature` string to the remote canix402 MCP.

The payment transaction is not submitted directly. The paid MCP retry forwards
the signed group to the facilitator for verification and settlement.

## Constructing the payment

### Direct payment

1. Build an ASA transfer:
   - sender: payer address
   - receiver: `accepted.payTo`
   - asset id: `accepted.asset`
   - amount: `BigInt(accepted.maxAmountRequired ?? accepted.amount)`
   - flat fee: 1,000 microAlgos
   - note: UTF-8 `x402-payment-v2`
2. Sign it with the payer wallet.
3. Set `paymentGroup` to an array containing the base64 signed-transaction
   blob and set `paymentIndex` to `0`.

### Facilitator fee payer

When and only when `accepted.extra.feePayer` is present:

1. Build transaction 0 as a zero-ALGO self-payment from the fee-payer address,
   with a 2,000 microAlgo flat fee and note `x402-fee-payer`.
2. Build transaction 1 as the payer's ASA transfer, with fee `0` and note
   `x402-payment-v2`.
3. Assign one group ID to both transactions.
4. Keep transaction 0 unsigned and sign transaction 1 with the payer wallet.
5. Base64-encode the unsigned bytes for transaction 0 and the signed blob for
   transaction 1. Set `paymentIndex` to `1`.

Wrap either variant in this JSON shape, then base64-encode the UTF-8 JSON:

```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "<accepted.network>",
  "resource": "<paymentRequest.resource>",
  "accepted": "<selected accept object with normalized amount>",
  "extensions": {},
  "outputSchema": null,
  "payload": {
    "paymentGroup": ["<base64 transaction bytes>"],
    "paymentIndex": 0
  },
  "paymentRequired": "<complete decoded PAYMENT_REQUIRED object>"
}
```

Preserve the complete live `paymentRequired` and selected accept object. Do not
invent, omit, or rewrite facilitator fields.

## Claim desk agent loop

For harvesting claimable rewards across supported protocols:

1. Optionally call `canix_get_positions` for the full book.
2. Call `canix_list_claimable` with the wallet `address` (paid ~0.001 USDC).
   Response `data[]` includes USD value, `estimatedNetworkFee*`, `worthClaiming`,
   `compatibleClaimShapeKeys`, per-row `quote`, and `claimKey` for dedupe.
   Top-level `claimAllQuotes.quotes` is ready for the compiler.
3. Filter by `worthClaiming` / `claimKey` as the user intends. Prefer
   `claimAllQuotes` or selected per-row `quote` objects — do not invent
   `shapeKey`s.
4. Call `canix_get_execution_quote` with those `quotes[]` (paid flat ~0.10 USDC
   per request). Groups are never merged across quote items.
5. Sign and submit locally (see below). Tinyman farm claims use
   `metadata.submitMode === "tinyman-analytics-claim"`.

Supported claim desk protocols: Tinyman farm, Tinyman stALGO TINY claim, CompX
staking, Pact farm, Haystack, Alpha Arcade. Fee/worth-claiming hints compare
reward USD to estimated network fees only — they are not a simulation.

## Eligibility agent loop

Before quoting an enter (especially Réti validators with gates or capacity):

1. Optionally call `canix_get_personalized_opportunities` for wallet-aware ranking.
   That route already applies eligibility rules so full or gated venues are not
   recommended as enterable. Ranking is not a substitute for this check.
2. Optionally call `canix_get_opportunity_history` for a bounded APY/TVL series
   (`window=1d|7d|30d`) and the stability signal used by `/plans` ranking.
3. Call `canix_check_eligibility` with `address` and `opportunityIds` (paid ~0.01
   USDC). Response rows include `canEnter`, `missingAssets`, `gates`, `capacity`,
   `suggestedSwap`, and `eligibilityFullyCheckable`.
4. If `eligibilityFullyCheckable` is false (NFD/creator gates), do not treat
   `canEnter` as true. Publish the unresolved gates to the user.
5. If `suggestedSwap` is present, it is a hint only — fetch a live quote via
   `canix_get_quote` / `POST /swaps/quote`, then re-check eligibility.
6. Quote-time on-chain checks remain authoritative. Compile with
   `canix_get_execution_quote` only after reviewing eligibility.

## Intent compiler agent loop

For an allocation intent (budget + constraints), prefer `canix_get_plan` over
assembling quotes yourself. Brownie and other user agents should consume this
SKU rather than forking a compiler.

1. Call `canix_get_plan` with `address` and `budget: { assetId, amount }`
   (base units; `assetId` 0 = ALGO). Optional `constraints` include
   `maxProtocolWeightBps`, `noNewBorrows`, `executionReadyOnly`, `minTvlUsd`,
   `maxSourceAgeSeconds`, and `maxAllocations`. Optional `opportunityIds` pins
   the compiler. Paid ~0.25 USDC.
2. Review `data.blocked[]` eligibility gates. Do not sign when `canEnter` is
   false or `eligibilityFullyCheckable` is false.
3. Response `allocations[].steps` are ordered: eligibility, optional Haystack
   opt-in/swap compose, protocol setup, enter. Groups are unsigned and never
   merged. Reuse `quotes[]` / `order` / `prerequisiteShapeKeys`.
4. Swap steps are live Haystack groups when `requiredAssetIds` differ from the
   budget asset (opt-in → swap → enter, never merged). Setup steps that need a
   confirmed prior group (e.g. Folks escrow) are `compileStatus: deferred`;
   after those confirm, call `canix_get_execution_quote` with the remaining
   `quotes[]`. For a single “I hold A, I want this opportunity” path, use
   `canix_compose_enter` (`POST /execution/compose`).
5. Sign and submit compiled `encodedTransactions` locally before `expiresAt`,
   the same way as `canix_get_execution_quote`. Paying for a plan does not
   execute it. Sign only `userSignIndexes` / `signer: "user"` legs; preserve
   Haystack pre-signed members. Review stale-quote, missing-opt-in, and
   slippage warnings before signing.

## Rebalance / delta quotes agent loop

For a delta vs the existing book (target weights, or harvest idle ALGO / claim
and redeploy), prefer `canix_get_rebalance_plan` over assembling exits and
enters yourself.

1. Optionally call `canix_get_positions` and `canix_list_claimable`.
2. Call `canix_get_rebalance_plan` with `address` plus `targetWeights`
   (`{ opportunityId, weightBps }[]` summing to 10000) and/or `harvestIdle: true`.
   Paid ~0.25 USDC. Positions not listed in `targetWeights` are left alone.
3. Review `data.steps` in order: claims, partial exits, optional Haystack
   compose, enters. Groups are unsigned and never merged
   (`meta.groupsMerged === false`). Enter that depends on unconfirmed exit
   proceeds is `compileStatus: deferred`.
4. Sign and submit locally the same way as `canix_get_execution_quote`. Paying
   for the plan does not execute it.

## Simulate / expected delta agent loop

Before signing compiled groups, simulate predicted deltas. Canix never signs
or submits.

1. Compile with `canix_get_plan`, `canix_get_rebalance_plan`, or
   `canix_get_execution_quote`. Review `data.simulation` on plans when present.
2. Or call `canix_simulate_execution` with `address` and `groups[]` from the
   compiled quotes (`transactions` and/or `encodedTransactions`). Paid ~0.10 USDC.
3. Require `wouldSucceed === true` and `signed === false` /
   `submitted === false` / `meta.executionSubmitted === false`. If reasons are
   present (`stale-quote`, `not-opted-in`, `min-balance`,
   `health-factor-too-low`, `capacity`), do not sign.
4. Sign and submit locally the same way as `canix_get_execution_quote`.

## Policy-as-a-service agent loop

Operators bring policy; Canix evaluates it and still does not sign. Brownie and
a second agent should share the same document (`protocol/docs/policy-schema.md`,
sample `protocol/docs/policy-brownie.sample.json`).

1. Compile with `canix_get_plan`, `canix_get_rebalance_plan`, or
   `canix_get_execution_quote`.
2. Call `canix_validate_policy` with `policy` plus the compiled `plan` and/or
   proposed `quotes[]`. Paid ~0.25 USDC. Pass `walletAlgoMicroAlgos` when the
   policy sets `minAlgoReserveMicroAlgos`.
3. Require `pass === true` and `signed === false` / `submitted === false` /
   `meta.executionSubmitted === false`. If `reasons[]` are present
   (`protocol-weight`, `below-reserve`, `below-tvl-floor`, `source-not-fresh`,
   `new-borrow`, `execution-not-ready`, or `missing-*` fail-closed codes), do
   not sign. Canix does not re-quote on-chain when a field is missing.
4. Optionally simulate, then sign only user legs locally.

## Signing an execution quote

For `canix_get_execution_quote`:

1. Prefer `executionShapes` from opportunity responses (enter-only). When present,
   use `compatibleExitShapes` for known liquid-staking exits; otherwise use
   `canix_list_execution_shapes` or position `compatibleExitShapeKeys` /
   `compatibleManageShapeKeys` for exit/manage. For reward harvests, prefer
   `canix_list_claimable` / `claimAllQuotes` instead of scraping positions.
   Never invent `shapeKey`s when `executionReady` is false.
2. Call with `quotes: [{ shapeKey, input }, ...]` (min 1). Response `data` is an
   `ExecutableQuote[]` in the same order — each item is an independent unsigned
   group; groups are never merged. Price is flat ~0.10 USDC **per request**, not
   per quote item. On failure, `error.details.quoteIndex` and `shapeKey` identify
   the failing item. Do not invent pool/app IDs, opt-ins, min-balance funding,
   or slippage — read `protocol/docs/execution-shapes/protocol-caveats.md`
   (also `GET /execution/shapes` `meta.caveatsDocsPath`) and each shape's
   `docsPath`.
3. Complete the x402 payment workflow above.
4. Require `meta.executionSubmitted === false`.
5. For each quote in `data`, before signing, review:
   - `expiresAt` has not passed
   - every warning in `warnings`
   - every sender, receiver, amount, asset ID, app ID, fee, and group member in
     `transactions`
   - the group still matches the user's stated intent and spending limits
6. Decode each item in that quote's `encodedTransactions` as an unsigned Algorand
   transaction and sign it with the key for that transaction's sender.
   When `groupTransactions` / `userSignIndexes` are present, `encodedTransactions`
   already contains **only** user legs — do not attempt to sign `signer:
   "protocol"` or `"logicsig"` members with a mnemonic.
7. Preserve order and group IDs within each quote. Do not rebuild, regroup, or
   modify quoted transactions after validation. Submit each quote's group
   separately (and in `order` / prerequisite sequence when opening multi-step
   opportunities such as Folks).
8. Assemble the full submit set:
   - If every `groupTransactions` member is `signer: "user"`, or
     `groupTransactions` is absent: submit signed `encodedTransactions` to algod.
   - If a member has `signedTransaction`, concatenate it in group order with
     user-signed blobs (Haystack-style) and submit to algod.
   - If `metadata.submitMode === "tinyman-analytics-claim"`: sign user legs,
     then `POST` to `metadata.claimUrl` with
     `{ signed_transactions: [userSignedB64], transactions: metadata.unsignedProtocolTransactions }`.
     Tinyman cosigns the distribution account and submits — do not send an
     incomplete group to algod.
9. Complete submission before expiry. If expired, request and pay for a fresh
   quote unless the service explicitly supports refreshing it without another
   payment.

Example for a single user signer on the first quote:

```typescript
const quote = response.data[0];
const signed = quote.encodedTransactions.map((encoded: string) => {
  const txn = algosdk.decodeUnsignedTransaction(
    Buffer.from(encoded, "base64"),
  );
  if (txn.sender.toString() !== account.addr.toString()) {
    throw new Error(`Unexpected signer ${txn.sender.toString()}`);
  }
  return algosdk.signTransaction(txn, account.sk).blob;
});

await algod.sendRawTransaction(signed).do();
```

Tinyman farm `claimRewards` (multi-signer / protocol cosign):

```typescript
const quote = response.data[0];
// encodedTransactions is user-only; distribution sender is never here
const userSigned = algosdk.signTransaction(
  algosdk.decodeUnsignedTransaction(
    Buffer.from(quote.encodedTransactions[0], "base64"),
  ),
  account.sk,
);
const claimRes = await fetch(quote.metadata.claimUrl, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    signed_transactions: [Buffer.from(userSigned.blob).toString("base64")],
    transactions: quote.metadata.unsignedProtocolTransactions,
  }),
});
```

Some shapes require multiple signers. Resolve keys by decoded transaction
sender; never sign every group member blindly with one key. Follow the
shape-specific documentation and treat any returned private key as sensitive.

## Secret and spend guardrails

- Never ask the user to paste a mnemonic or private key into chat.
- Read secrets only from an approved local wallet, signer, or environment
  variable, and never print them or place them in MCP arguments.
- Do not add a mnemonic to the canix402 MCP server environment.
- Obtain explicit approval before a real spend when the user has not already
  specified the endpoint, maximum payment, network, and payer.
- Refuse mismatched networks, assets, recipients, excessive amounts, stale
  quotes, unknown senders, or malformed transaction groups.
- Signing is authorization. Do not sign merely because a tool returned bytes.

## Failure handling

- A second `PAYMENT_REQUIRED` usually means the signature is stale, malformed,
  for a different request, or does not match network/asset/payTo/amount.
- A facilitator rejection with a fee payer usually means group order,
  signatures, fees, or `paymentIndex` are wrong.
- If the agent cannot access a trusted local signer, stop after validation and
  provide the unsigned transaction to the wallet owner. Do not request key
  material.
- If a paid POST is retried, preserve the exact body and content type from the
  preflight.
