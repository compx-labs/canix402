# Execution shape documentation

Per-shape specs live in this directory and are linked 1:1 from
`src/execution/shape-docs.ts` so `GET /execution/shapes` can return `docsPath`
without embedding the full markdown in MCP clients.

**Protocol-specific construction caveats** (pool discovery, opt-ins, minimum
balance, slippage math, liquidity limits, app upgrades) are collected in
[protocol-caveats.md](./protocol-caveats.md). `GET /execution/shapes` also
returns that path as `meta.caveatsDocsPath`. Read it before guessing inputs for
`POST /execution/quotes`.

Canix stays walletless: these docs describe unsigned groups only. The client
signs and submits locally.
