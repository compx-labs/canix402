# @canix402/mcp-worker

Stateless remote MCP server for canix402, designed for Cloudflare Workers deployment via Cloudflare's Git integration UI.

## Purpose

- Exposes canix402 tools over remote MCP (Streamable HTTP)
- Calls the public Caddy gateway (`CANIX402_GATEWAY_URL`)
- Never stores or uses wallet mnemonics
- For paid tools: first call returns payment requirements, retry call forwards `PAYMENT-SIGNATURE`
- Exposes `canix_get_positions` for paid `GET /positions` calls with a required
  wallet `address` and a 0.005 USDC fallback price
- Exposes `canix_list_claimable` for paid `GET /positions/claimable` (0.001 USDC);
  pass `claimAllQuotes` into `canix_get_execution_quote` to compile unsigned claims
- Exposes `canix_check_eligibility` for paid `POST /eligibility` (0.01 USDC);
  check `canEnter` / gates / capacity before quoting an enter
- Exposes `canix_get_plan` for paid `POST /plans` (0.25 USDC); compile an
  allocation intent into ordered unsigned groups. Consume this rather than
  forking a compiler.
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
