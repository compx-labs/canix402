# @canix402/mcp-worker

Stateless remote MCP server for canix402, designed for Cloudflare Workers deployment via Cloudflare's Git integration UI.

## Purpose

- Exposes canix402 tools over remote MCP (Streamable HTTP)
- Calls the public Caddy gateway (`CANIX402_GATEWAY_URL`)
- Never stores or uses wallet mnemonics
- For paid tools: first call returns payment requirements, retry call forwards `PAYMENT-SIGNATURE`
- `canix_list_execution_shapes` / `canix_get_execution_quote` point at
  `protocol/docs/execution-shapes/protocol-caveats.md` so agents do not guess
  pool discovery, opt-ins, min-balance, slippage, or app upgrades
- Exposes `canix_get_positions` for paid `GET /positions` calls with a required
  wallet `address` and a 0.005 USDC fallback price
- Exposes `canix_list_claimable` for paid `GET /positions/claimable` (0.001 USDC);
  pass `claimAllQuotes` into `canix_get_execution_quote` to compile unsigned claims
- Exposes `canix_get_opportunity_history` for paid `GET /opportunities/{id}/history`
  (0.01 USDC research SKU); bounded APY/TVL series plus a stability signal.
- Exposes `canix_check_eligibility` for paid `POST /eligibility` (0.01 USDC);
  check `canEnter` / gates / capacity before quoting an enter
- Exposes `canix_get_plan` for paid `POST /plans` (0.25 USDC); compile an
  allocation intent into ordered unsigned groups, including live Haystack
  opt-in → swap compose when `requiredAssetIds` differ from the budget asset.
  Consume this rather than forking a compiler.
- Exposes `canix_get_rebalance_plan` for paid `POST /plans/rebalance` (0.25 USDC);
  delta claims/exits/swaps/enters as unmerged unsigned groups (not a full unwind).
- Exposes `canix_compose_enter` for paid `POST /execution/compose` (0.10 USDC);
  “I hold asset A, I want this opportunity” as sequenced unsigned groups.
- Exposes `canix_simulate_execution` for paid `POST /execution/simulate` (0.10 USDC);
  predicted balance/position deltas for compiled unsigned groups. Fail closed.
  `POST /plans` attaches `data.simulation` when groups are compiled.
- Exposes `canix_validate_policy` for paid `POST /policy/validate` (0.25 USDC);
  plan or quotes[] plus an operator policy document → `{ pass, reasons[] }`.
  Canix does not sign. Sample: `protocol/docs/policy-brownie.sample.json`.
- Exposes prepaid session tools (receipts, not keys; one-shots remain the default):
  - `canix_create_session` → paid `POST /sessions` (0.25 USDC)
  - `canix_refresh_session` → paid `POST /sessions/refresh` (0.25 USDC, one-shot only)
  - `canix_get_session` → free `GET /sessions/{sessionId}` remaining N/M
  Session-eligible paid tools accept `sessionReceipt` (`X-Canix-Session`). On
  `SESSION_*` 402, omit the header and retry with `paymentSignature`.
- Resource `canix://session` publishes session **policy** (budget N/M, TTL).
- Resource `canix://session/{sessionId}` publishes remaining N/M for that receipt.
- Exposes watch retainer tools (address + callback only; no wallet keys):
  - `canix_create_watch` → paid `POST /watch` (0.25 USDC)
  - `canix_refresh_watch` → paid `POST /watch/refresh` (0.25 USDC, one-shot only)
  - `canix_get_watch` → free `GET /watch/{watchId}` recent firings
  - `canix_rotate_watch_secret` → free rotate with current HMAC secret
- Resource `canix://watch` publishes watch **policy** (TTL, price, signature headers).
- Resource `canix://watch/{watchId}` publishes the receipt and recent firings.
- Exposes stateless Haystack tools:
  - `canix_get_quote` → free `POST /swaps/quote`
  - `canix_optin` → free `POST /swaps/optin`
  - `canix_swap` → paid `POST /swaps/transactions` with a 0.005 USDC fallback price

Haystack quote and transaction responses pass through from the gateway. The Worker does not retain quotes, sign transactions, or submit them.

## Local Development

From repo root:

```sh
npm run dev:mcp-worker
```

From this folder:

```sh
npm run dev
```

## Cloudflare Dashboard Deployment (Git)

1. In Cloudflare Workers, choose **Create Worker** and connect GitHub.
2. Select repository `canix402`.
3. Set Worker root directory to `mcp-worker`.
4. Configure Worker variables:
   - `CANIX402_GATEWAY_URL=https://canix402-api.compx.io`
   - Optional: `CANIX402_MCP_PUBLIC_URL=https://canix402-mcp.compx.io/mcp`
5. Deploy to `*.workers.dev` first, then attach custom domain `canix402-mcp.compx.io`.

## Runtime Endpoints

- `GET /health` health check
- `GET /.well-known/mcp` MCP endpoint metadata
- `ALL /mcp` Streamable HTTP MCP endpoint

## Scripts

```sh
npm run typecheck:mcp-worker
npm run test:mcp-worker
npm run dev:mcp-worker
```
