# Policy document schema (V1)

This document defines the stable operator policy contract consumed by
`POST /policy/validate` and `canix_validate_policy`. Brownie and any second
agent can share the same JSON. Canix evaluates the document against a compiled
plan (or proposed `quotes[]`) and returns machine-readable pass/fail. Canix
never signs or submits.

## Versioning

- Contract version: `1.0.0` (`schemaVersion`)
- Canonical schema sources:
  - `src/types/policy-schema.ts` (`PolicyDocumentSchema`, `PolicyValidateRequestSchema`)
  - `openapi/openapi.json` (`#/components/schemas/PolicyDocument`)
- Sample operators can copy: [`policy-brownie.sample.json`](./policy-brownie.sample.json)

Unknown `schemaVersion` values fail closed (HTTP 400). Adding fields is a
contract revision and must land in TypeBox, OpenAPI, and this document together.

## Policy document

```json
{
  "schemaVersion": "1.0.0",
  "maxProtocolWeightBps": 4000,
  "minAlgoReserveMicroAlgos": "1000000",
  "minTvlUsd": 25000,
  "maxSourceAgeSeconds": 86400,
  "noNewBorrows": true,
  "executionReadyOnly": true
}
```

All constraint fields except `schemaVersion` are optional. Omitted rules are
not evaluated. An empty constraint set still requires a non-empty subject.

| Field | Meaning |
|---|---|
| `schemaVersion` | Must be `"1.0.0"` |
| `maxProtocolWeightBps` | Cap any single protocol's share of the subject (10000 = 100%) |
| `minAlgoReserveMicroAlgos` | Wallet ALGO that must remain after the subject (microAlgos decimal string) |
| `minTvlUsd` | Minimum `tvlUsd` on every allocation / quote row |
| `maxSourceAgeSeconds` | Maximum age of `sourceTimestamp` relative to `evaluatedAt` (or server now) |
| `noNewBorrows` | Reject borrow shapes (`action === "borrow"` or `shapeKey` contains `:borrow:`) |
| `executionReadyOnly` | Reject rows with `executionReady !== true` |

## Request

`POST /policy/validate` (paid compiler SKU, 0.25 USDC):

```json
{
  "policy": { "schemaVersion": "1.0.0", "noNewBorrows": true },
  "plan": { "allocations": [/* compiled POST /plans data */] },
  "quotes": [{ "shapeKey": "mainnet:reti:v1:stake:algo", "protocol": "reti" }],
  "walletAlgoMicroAlgos": "5000000",
  "evaluatedAt": "2026-08-28T12:00:00.000Z"
}
```

Provide **at least one** of `plan` or `quotes[]`. `plan` may be the full
`{ data, meta }` envelope from `POST /plans` / `POST /plans/rebalance` or the
inner `data` object. `quotes[]` is the proposed-action shape when an agent has
not compiled a plan yet.

`walletAlgoMicroAlgos` is required when `minAlgoReserveMicroAlgos` is set.
`evaluatedAt` is optional; omit it to use the server clock for freshness.

## Fail closed

Canix **does not re-quote on-chain**. It reuses fields already on the compiled
object (plan allocations, eligibility, execution shapes, quote identity, TVL,
`sourceTimestamp`). If a selected rule needs a field that is missing, the
result is `pass: false` with a machine-readable reason — not a live lookup.

`pass` is true only when every selected rule is proven. `data.signed`,
`data.submitted`, `meta.signed`, and `meta.executionSubmitted` are always
`false`.

| Code | Meaning |
| --- | --- |
| `empty-subject` | No allocations / quotes / enter steps to evaluate |
| `protocol-weight` | A protocol's share exceeds `maxProtocolWeightBps` |
| `missing-protocol` | Weight rule is set but a row has no `protocol` |
| `missing-weight` | Weight rule is set but shares cannot be derived |
| `below-reserve` | Remaining ALGO is below `minAlgoReserveMicroAlgos` |
| `missing-reserve` | Reserve rule is set but wallet ALGO / ALGO outflow is unknown |
| `below-tvl-floor` | A row's `tvlUsd` is below `minTvlUsd` |
| `missing-tvl` | TVL rule is set but `tvlUsd` is absent |
| `source-not-fresh` | `sourceTimestamp` is missing a parseable time or exceeds `maxSourceAgeSeconds` |
| `missing-freshness` | Freshness rule is set but `sourceTimestamp` is absent |
| `new-borrow` | `noNewBorrows` is true and a borrow shape is present |
| `execution-not-ready` | `executionReadyOnly` is true and `executionReady` is false |
| `missing-execution-ready` | Execution-ready rule is set but `executionReady` is absent |
| `blocked-eligibility` | `eligibility.canEnter` is false |
| `eligibility-not-fully-checkable` | `eligibility.eligibilityFullyCheckable` is false |

## Agent loop

1. Compile with `canix_get_plan` / `canix_get_rebalance_plan` / `canix_get_execution_quote`
2. `POST /policy/validate` / `canix_validate_policy` with the operator policy document
3. If `pass` is false, do not sign — publish `reasons[]`
4. Optionally simulate (`canix_simulate_execution`), then sign only user legs locally

See also `docs/normalized-opportunity-schema.md` for the opportunity fields this
validator reads (`tvlUsd`, `sourceTimestamp`, `executionReady`, borrow shapes).
