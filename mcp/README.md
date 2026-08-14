# @canix402/mcp

MCP server that exposes canix402 free and paid gateway endpoints as agent tools.

## What it does

- Free tools: health, metadata, discovery, OpenAPI, execution shape catalog, Haystack quotes, and Haystack opt-ins
- Paid tools: opportunities (list/search/personalized/protocol), wallet positions, claimable rewards, eligibility, execution quotes, and Haystack swap transactions
- Walletless x402 passthrough: paid tool preflight returns `PAYMENT-REQUIRED`, retry with `paymentSignature`
- Resources: `canix://discovery`, `canix://openapi`, `canix://execution-shapes` (live `GET /execution/shapes`)
- Prompt: `analyze-opportunity`

Always call the **Caddy gateway** (`CANIX402_API_URL`), never the raw Fastify upstream.

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
