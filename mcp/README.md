# @canix402/mcp

MCP server that exposes canix402 free and paid gateway endpoints as agent tools.

## What it does

- Free tools: health, metadata, discovery, OpenAPI, execution shape catalog, Haystack quotes, and Haystack opt-ins
- Paid tools: opportunities (list/search/personalized/protocol), wallet positions, claimable rewards, eligibility, intent plans, execution quotes, and Haystack swap transactions
- Walletless x402 passthrough: paid tool preflight returns `PAYMENT-REQUIRED`, retry with `paymentSignature`
- Resources: `canix://discovery`, `canix://openapi`, `canix://execution-shapes` (live `GET /execution/shapes`, including `meta.caveatsDocsPath`)
- Prompt: `analyze-opportunity`

Always call the **Caddy gateway** (`CANIX402_API_URL`), never the raw Fastify upstream.

`canix_list_execution_shapes` / `canix_get_execution_quote` point at
`protocol/docs/execution-shapes/protocol-caveats.md` for protocol-specific
construction caveats (pool discovery, opt-ins, min-balance, slippage, liquidity
limits, app upgrades). Do not guess those details from opportunity rows.

For hosted/remote agent usage, use the Cloudflare Worker remote endpoint in `mcp-worker/`.

## Position tool

`canix_get_positions` calls paid `GET /positions` with a required wallet `address`.
The advertised fallback price is 0.005 USDC. Omit `paymentSignature` for the
x402 preflight, then retry the same address with the signed
`PAYMENT-SIGNATURE` payload.

## Claim desk tool

`canix_list_claimable` calls paid `GET /positions/claimable` with a required wallet
`address` (fallback price 0.001 USDC). Response includes USD value, network-fee /
worth-claiming hints, claim `shapeKey`s, and `claimAllQuotes` ready for
`canix_get_execution_quote` (~0.10 USDC flat per request; groups never merged).
Agent loop: optional positions → claimable → filter `worthClaiming` / `claimKey` →
execution quote → local sign/submit. Tinyman farm claims use
`submitMode: tinyman-analytics-claim` (Analytics cosign), not raw algod submit.

## Eligibility tool

`canix_check_eligibility` calls paid `POST /eligibility` with `address` and
`opportunityIds` (fallback price 0.01 USDC). Response includes `canEnter`,
`missingAssets`, `gates`, `capacity`, `suggestedSwap`, and
`eligibilityFullyCheckable`. NFD/creator gates stay unresolved — `canEnter` is
never true until fully checkable. Personalized ranking uses the same rules so
full/gated venues are not recommended as enterable. Quote-time on-chain checks
remain authoritative.

## Intent compiler tool

`canix_get_plan` calls paid `POST /plans` with `address` and
`budget: { assetId, amount }` (fallback price 0.25 USDC). Optional constraints
and `opportunityIds` pin the compiler. The response includes eligibility, live Haystack
opt-in → swap compose when `requiredAssetIds` differ from the budget asset, setup/enter
`quotes[]` as independent unsigned groups (never merged), expected position delta, x402 +
network fee totals, and expiry. Brownie and other agents should consume this SKU rather
than forking a compiler. Sign and submit locally in `order` / `prerequisiteShapeKeys`
sequence.

## Swap-aware enter compose

`canix_compose_enter` calls paid `POST /execution/compose` (fallback price 0.10 USDC)
with `address`, `opportunityId`, `fromAssetId`, and `amount`. Optional `slippage`
(Haystack percent, default 1). Returns sequenced unsigned groups: opt-in → Haystack swap
→ enter. Groups stay unmerged; sign only user legs and preserve Haystack pre-signed
members. Prefer `canix_get_plan` for budget allocation.

## Rebalance / delta quotes

`canix_get_rebalance_plan` calls paid `POST /plans/rebalance` (fallback price 0.25 USDC)
with `address` plus `targetWeights` (bps summing to 10000) and/or `harvestIdle`.
Returns ordered unsigned groups — claims, partial exits, optional Haystack compose,
enters — only the legs that change the book. Positions not listed in `targetWeights`
are left alone. Groups stay unmerged; sign and submit locally.

## Haystack swap tools

- `canix_get_quote` passes `{address, fromAssetId, toAssetId, amount, type?, disabledProtocols?, maxGroupSize?, maxDepth?}` to free `POST /swaps/quote`.
- `canix_optin` passes `{address, quote}` to free `POST /swaps/optin`.
- `canix_swap` passes `{address, quote, slippage}` to paid `POST /swaps/transactions`. Its fallback price is 0.005 USDC; omit `paymentSignature` for preflight, then retry with the same body and signed payload.

All three tools are stateless. Quote and transaction responses are passed through from the gateway, and the MCP never signs or submits wallet transactions.

## Setup

1. Install workspace deps from the monorepo root: `npm install`
2. Copy `.env.example` values into your MCP host env (do not commit mnemonics)
3. Add the server to Cursor / Claude Desktop using `mcp.json.example`

```json
{
  "mcpServers": {
    "canix402": {
      "command": "npx",
      "args": ["tsx", "mcp/src/index.ts"],
      "cwd": "/absolute/path/to/canix402",
      "env": {
        "CANIX402_API_URL": "https://canix402-api.compx.io"
      }
    }
  }
}
```

## Scripts

```bash
npm run typecheck:mcp
npm run test:mcp          # unit + integration (mocked)
npm run dev:mcp
```

From repo root, see `protocol/docs/testing.md` for the full test lane matrix (API, gateway, MCP, live).

Live paid tests (spends USDC):

```bash
CANIX402_LIVE_TESTS=1 npm run test:live -w @canix402/mcp
```

## Security

- Do not put wallet mnemonics in MCP server environment
- Server-side MCP remains walletless and forwards `PAYMENT-SIGNATURE` on retry
- Keep payer keys client-side/agent-side only
