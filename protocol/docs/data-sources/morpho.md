# Morpho Vaults Data Source

This document defines the Morpho Vaults adapter used by canix402. Slice 1 is
**listed Base vaults only**, supply-only ERC-4626 earn. Morpho Blue borrow,
Public Allocator, Vault V2 force-withdraw, Permit2, and Bundler3 are out of
scope.

Algorand analogue: CompX deposit/withdraw without the borrow path.

## Source Strategy

- Mode: GraphQL catalog + on-chain preview at quote time
- Adapter file: `src/adapters/morpho.ts`
- Execution shapes: `src/execution/shapes/morpho/`
- Discovery: `POST https://api.morpho.org/graphql`
- Query: `vaults(where: { chainId_in: [8453], listed: true })` when `MORPHO_ONLY_LISTED` is true (default)
- Network: Base (`chainId` 8453). Rows always carry `chain: "base"`.
- Positions / personalized: **not** collected in slice 1 (`/positions` stays Algorand)

## Environment Variables

- `MORPHO_GRAPHQL_URL` (optional; default `https://api.morpho.org/graphql`)
- `MORPHO_ONLY_LISTED` (optional; default `true`. Set `false` to include unlisted vaults that still have positive TVL and `netApy`)
- `BASE_RPC_URL` (quotes only; default `https://mainnet.base.org`) for allowance and ERC-4626 preview calls

x402 accepts Algorand USDC and, when `X402_PAY_TO_BASE` is a real address, Base USDC at the same price. Algorand stays the first accept. Do not remove that rail. Base payment is EIP-3009, separate from vault calldata.

## Field Mapping

| Canix field | Source |
| --- | --- |
| `protocol` | `morpho` |
| `chain` | `base` |
| `opportunityType` | `lending` (`borrowApr` omitted) |
| `opportunityId` | `morpho-vault-{address}` (lowercase) |
| `assetPair` | `asset.symbol` |
| `apy` / `yieldBasis` | `state.netApy` × 100 (percent), `yieldBasis: apy` |
| `apr` | `state.apy` × 100 (gross, optional) |
| `tvlUsd` | `state.totalAssetsUsd` |
| `assetAddresses` | `[asset.address]` — never put `0x` into integer `assetIds` |
| `inputHints.poolId` | vault address |
| `inputHints.assetAddress` | underlying ERC-20 |
| `notes` | vault name + curator fee |

Dropped rows:

- `listed !== true` when `MORPHO_ONLY_LISTED` is true
- `state.totalAssetsUsd <= 0` or missing `state.netApy`
- native ETH underlyings (`address(0)` / `0xEee…`)
- non-Base `chain.id`

V1 MetaMorpho vaults are preferred because they already return `netApy` and `totalAssetsUsd`. V2 vaults are included only when the same fields are present and `listed`.

## Execution

Unsigned calldata the client signs. Canix never collects interactive wallet signatures.

- Enter: `base:morpho:vault:deposit:erc4626` — optional ERC-20 `approve` then `deposit(assets, receiver)`
- Exit: `base:morpho:vault:withdraw:erc4626` and `base:morpho:vault:redeem:erc4626`

Skip: Permit, Permit2, Bundler3, Morpho Blue borrow, Public Allocator, Vault V2 force-withdraw, native wrap.

Quote TTL still applies to previewed shares / min-out even though EVM txs do not expire like Algorand first/last-valid.

## Isolation

A Morpho GraphQL timeout must not fail the rest of `/opportunities`. `fetchOpportunitiesForProtocols` already degrades per adapter via `Promise.allSettled`.

## Tests

Fixture-based coverage (recorded GraphQL items; no live RPC, no paid x402):

- `tests/unit/morpho-normalize.test.ts`
- `tests/unit/morpho-execution-shapes.test.ts`
- `tests/fixtures/adapters/morpho-vaults.ts`
- `tests/integration/morpho-execution-shapes.test.ts`
