# @canix402/mcp

MCP server that exposes canix402 free and paid gateway endpoints as agent tools.

## What it does

- Free tools: health, metadata, discovery, OpenAPI, execution shape catalog
- Paid tools: opportunities (list/search/personalized/protocol) and execution quotes
- Automatic x402 payment when `CANIX402_WALLET_MNEMONIC` is set
- Resources: `canix://discovery`, `canix://openapi`, `canix://execution-shapes`
- Prompt: `analyze-opportunity`

Always call the **Caddy gateway** (`CANIX402_API_URL`), never the raw Fastify upstream.

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
        "CANIX402_API_URL": "https://canix402-api.compx.io",
        "CANIX402_WALLET_MNEMONIC": "<your-wallet-mnemonic>"
      }
    }
  }
}
```

## Scripts

```bash
npm run typecheck:mcp
npm run test:mcp
npm run dev:mcp
```

Live paid tests (spends USDC):

```bash
CANIX402_LIVE_TESTS=1 CANIX402_WALLET_MNEMONIC=... npm run test:live -w @canix402/mcp
```

## Security

- Use a dedicated agent wallet with limited funds
- Wallet needs ALGO for fees and USDC opt-in (ASA `31566704` on mainnet)
- Never put mnemonics in tool arguments or commit them to git
