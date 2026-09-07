# Protocol-specific execution caveats

Agents must not invent pool IDs, opt-in groups, minimum-balance funding, slippage
floors, liquidity caps, or app IDs. Read this file plus the per-shape
`docsPath` from `GET /execution/shapes` before filling `POST /execution/quotes`
inputs. Canix compiles **unsigned** groups only — it does not sign or submit.

`GET /execution/shapes` advertises this document as `meta.caveatsDocsPath`.
Quotes expire after 30 seconds (`DEFAULT_QUOTE_TTL_MS`). Recompile before
signing. Groups from a batch request are never merged.

This page covers the protocols whose golden/integration fixtures exist today:
Tinyman, Folks Finance, Pact, CompX, Dork.fi, Myth Finance, Haystack, Réti,
Alpha Arcade, and STAMM. Per-shape group layouts stay in the sibling markdown files.

## Tinyman

### Pool discovery

- Quotes resolve the v2 pool from the **asset pair on-chain** via
  `poolUtils.v2.getPoolInfo`, not from the discovery API. Opportunity `poolId`
  is metadata only.
- Asset ordering is Tinyman’s: **asset1 = higher asset id**, **asset2 = lower**
  (native ALGO `0` is always asset2). Callers may pass `assetA`/`assetB` in any
  order; shapes normalize with `orderTinymanAssets`.
- Swap shapes (`swap:fixedInput` / `swap:fixedOutput`) quote Tinyman Swap
  Router (`getSwapRoute`) **and** the single v2 pool, then pick the better net
  return. The router is Tinyman-pool only — not a cross-DEX aggregator.
- Subsequent LP (`addLiquidity:flexible` / `singleAsset`, both removes) require
  a **created and ready** pool with a pool-token id. Initial add
  (`addLiquidity:initial`) is the opposite: it rejects ready pools that already
  have reserves.
- Extra discovery pools (for example COMPX/ALGO by address) do not change
  execution: the validator app id still comes from
  `getValidatorAppID(network, v2)`.

### Opt-ins

- Flexible / initial / single-asset **add liquidity does not opt the user into
  the pool token**. The wallet must already be opted in (and hold ALGO for the
  extra ASA minimum balance) or the group will fail on submit.
- Swap Router / single-pool **swap does not opt the user into the output ASA**
  (or intermediary hop assets). Router `asset_opt_in` is a separate group and
  is never merged into the swap.
- tALGO mint, stALGO increase, and stALGO TINY claim may prefix optional
  tALGO / stALGO / TINY opt-ins when the SDK detects they are missing.
- Farm commit keeps LP in the wallet. Farm `claimRewards` is a Tinyman Analytics
  cosign flow (`metadata.submitMode === "tinyman-analytics-claim"`) — do not
  submit an incomplete group to algod.

### Minimum balance

- Pool-token and optional liquid-stake opt-ins consume extra ASA minimum balance.
  Shapes do not fund that MBR for LP adds.
- stALGO `increaseStake` may include a box-MBR payment when the restake app
  requires it. Read quote `warnings` and the payment amount before signing.

### Slippage math

- `maxSlippageBps` is an integer in `[0, 10000]`. Tinyman SDK quotes use
  `maxSlippageBps / 10000` as a fraction.
- Swap Router comparison uses expected out (fixed-input) or expected in
  (fixed-output) after the API’s slippage floor (`output_amount_arg` /
  `input_amount_arg`). Extra router network fees are already accounted for in
  the Tinyman route suggestion; there is no additional router fee beyond AMM v2.
- Remove-liquidity shapes apply that fraction with Tinyman’s
  `applySlippageToAmount("negative", …)` to encode **minimum outputs** in the
  app-call args.
- Quotes warn when `maxSlippageBps >= 500` (5%). That is not a hard reject.

### Liquidity limits

- Flexible add requires both sides of the pair; single-asset add performs an
  internal swap and is not a substitute for two-sided amounts.
- Swap Router is used when its net expected return beats the single-pool path
  (or when no ready v2 pool exists). Ties and worse router quotes fall back to
  the direct v2 swap; `metadata.fallbackReason` documents why.
- Farm commit takes an absolute LP amount that must not exceed wallet LP
  balance. Tinyman farms stake the full committed LP (no separate partial-stake
  shape).
- Mid-cycle farm commit/uncommit can affect unpaid rewards for the current
  cycle.

### App upgrades

- App-call validation pins the **current SDK validator app id**. A Tinyman v2
  upgrade that changes that id fails quote validation until Canix/SDK catch up.
- Swap Router groups pin the **SDK Swap Router app id**. A router upgrade that
  changes that id fails quote validation until Canix/SDK catch up.
- Farm claim bytes come from Analytics `prepare-claim-transactions`; a staking
  program upgrade can change group shape. Always inspect `groupTransactions`
  and `userSignIndexes`.

## Folks Finance

### Pool discovery

- Lending pools are the SDK `MainnetPools` catalog keyed by **pool app id** or
  **underlying asset id**. Discovery `opportunityId` (`folks-lending-<poolAppId>`)
  is not sufficient by itself — pass `poolAppId` (and `escrowAddress` when
  known).
- If `escrowAddress` is omitted on deposit/withdraw, Canix resolves it via the
  indexer (`X402_INDEXER_URL`). Indexer lag after a fresh `setup:depositEscrow`
  is a real failure mode: wait for confirmation, then re-quote.
- Wallet-direct deposit/withdraw and delayed xALGO stake/claim are **not**
  registered shapes. Do not invent them.

### Opt-ins and setup order

Enter is a **sequence of unmerged groups**. Confirm each before compiling the
next:

1. `setup:depositEscrow` — creates the escrow (user + escrow signers).
2. `setup:optEscrowAsset` — funds and opts the escrow into that pool’s fAsset.
3. `deposit:escrow` — underlying transfer + pool `deposit`.

Loan credit is a separate chain (`setup:loanEscrow` → `setup:addCollateral` →
deposit fAssets into the **loan** escrow → `collateral:sync` →
`borrow:variable`). `deposit:escrow` with a loan escrow address is not the same
as a deposit-escrow deposit.

### Minimum balance and escrow funding

- Deposit escrow and loan escrow setup groups fund a recoverable **0.25 ALGO**
  (250_000 µA) app-opt-in minimum balance.
- `setup:optEscrowAsset` is **two** transactions: a **0.1 ALGO** (100_000 µA)
  payment to the escrow, then `opt_escrow_into_asset`. The older “single app
  call” description is wrong — do not drop the funding payment.
-   Those ALGO amounts are recoverable Folks MBR, not protocol fees. The user
  still pays chain txn fees.

`setup:depositEscrow` / `setup:loanEscrow` metadata includes
`escrowAddress` and `escrowPrivateKeyBase64` because the generated escrow must
sign its own opt-in. That key is **not** a user mnemonic. Canix still does not
sign or submit; the client must sign the escrow leg locally and store the key
for later escrow operations.

### Slippage math

- Lending shapes have no `maxSlippageBps`. Withdraw amount denomination is
  `fAsset` (fAsset units, underlying returned to wallet) or `asset` (exact
  underlying).
- `includeOpUp` defaults to **true** (opcode-budget prefix). Expect one extra
  leading application call when it is on. Do not strip OpUp to “simplify” the
  group.

### Liquidity limits

- Quote compile uses live SDK pool state. Caps, paused markets, and insufficient
  liquidity fail at the SDK/build step or on-chain — there is no separate Canix
  “max deposit” input.
- Borrow health is not fully re-checked as a Canix-owned invariant. Review
  Folks loan state (and `/eligibility` when used) before signing
  `borrow:variable`.

### App upgrades

- Pool manager, deposits, loans, and OpUp app ids come from the Folks SDK
  mainnet constants. An upstream upgrade that changes those ids invalidates
  quotes until the SDK/shape pin is updated.
- Always re-quote after a Folks app upgrade; do not reuse cached
  `encodedTransactions`.

## Pact

### Pool discovery

- Quotes fetch the pool with `@pactfi/pactsdk` `fetchPoolById(poolAppId)`.
  Discovery `on_chain_id` is that application id.
- Caller `assetAId` / `assetBId` must match the resolved **primary** (lower
  asset id) and **secondary** (higher asset id) pair. ALGO/USDC therefore has
  primary ALGO (`0`). Shapes remap amounts; they do not swap the on-chain pool.
- Farm enter hints set `farmAppId` and, when known, a distinct AMM `poolAppId`.
  Do not pass the farm app id as `poolAppId` on LP shapes.

### Opt-ins

- Two-sided add does **not** opt the user into the LP token. Opt in first
  (including ASA MBR) or the mint fails.
- Farm liquidity leaves the wallet into a **per-user farm escrow** (unlike
  Tinyman in-wallet commit). `farm:deployEscrow` must confirm before
  `farm:stake` or `addLiquidityAndFarm:twoSided` — the escrow app id is unknown
  until the create transaction confirms. Skip deploy if an escrow already
  exists.

### Minimum balance

- `farm:deployEscrow` pays Pact’s gas station to fund escrow creation, then
  creates the escrow app and opts the user into the farm. That payment is
  required; do not rebuild the group without it.
- LP-token opt-in MBR is the caller’s responsibility.

### Slippage math

- Add-liquidity `maxSlippageBps` is converted with `bps / 100` to the Pact SDK
  **percent** argument (`50` bps → `0.5`). Do not pass bps into the SDK as
  percent.
- Quotes warn when `maxSlippageBps >= 500`.
- **Proportional remove does not encode slippage on chain.**
  `@pactfi/pactsdk` `buildRemoveLiquidityTxs` hard-codes `REMLIQ` minimum
  primary/secondary outputs as `0` / `0`. Review quote metadata and pool state
  before signing; do not assume min-out protection.

### Liquidity limits

- First liquidity into an empty pool must satisfy `sqrt(a*b) - 1000 > 0`; 1000
  LP tokens are permanently locked.
- Amounts must fit JavaScript safe integers — the Pact SDK builders are
  number-based.
- `addLiquidityAndFarm:twoSided` still cannot be atomic with escrow deploy.

### App upgrades

- `contractVersion` / `poolType` / `feeBps` come from the live SDK pool object.
  A Pact pool rewrite that changes app id is a different `poolAppId`; do not
  reuse an old id from discovery cache.

## CompX

### Market / pool discovery

- Lending quotes take `marketAppId` and resolve `sdk.lending.getMarket`.
  Staking quotes take `poolAppId` and resolve `sdk.staking.getPool`.
- Opportunity ids (`compx-lending-<appId>`) match those application ids.
- Optional `COMPX_MASTER_REPO_APP_ID` only affects adapter registry discovery,
  not a quote that already has `marketAppId` / `poolAppId`.

### Opt-ins

- `deposit:asa` prefixes an LST opt-in when the user is not opted into the
  market LST.
- `borrow:asa` prefixes a base-asset opt-in when needed. Collateral is
  **LST-denominated** and must be in that market’s on-chain
  `accepted_collaterals` set (often another market’s LST — a market’s own LST
  is not always accepted).
- `withdraw:asa` / `claim:rewards` / `unstake:asa` may prefix base or reward
  ASA opt-ins. Sign every leading opt-in; do not drop them.

### Minimum balance

- First-time staking funds a staker box with **22_500 µA** to the pool app
  (`0` for existing stakers that already have a box). The stake app-call fee
  is at least 250_000 µA.
- Lending deposit/borrow app-call fees are at least 2_000 µA. Opt-ins consume
  standard ASA MBR in the user account.

### Slippage math

- Lending and staking shapes have no slippage parameter. Sizing is exact base
  or LST units as documented on each shape.

### Liquidity limits

- Lending: `contractState` must be `1` (active). ASA-base markets only —
  ALGO-base lending is rejected.
- Staking: pool must be active, initialized, funded, and not past `endTime`.
  ASA-staked pools only.
- Inactive or mismatched market/pool state fails at quote compile time, not at
  a later “refresh” step.

### App upgrades

- `contractState !== 1` is treated as a hard stop (paused, upgraded, or
  retired). Re-read the market after a CompX upgrade; do not assume the same
  `marketAppId` still accepts `depositASA` / `borrow`.
- Borrow `accepted_collaterals` is on-chain. An upgrade that changes the set
  will fail collateral transfers even if yesterday’s quote would have worked.

## Dork.fi

### Pool / market discovery

- Execution is **catalog + on-chain**, not the indexed health API. Pass
  `poolAppId`, `marketAppId`, and `assetId` from opportunity/position
  `inputHints`. USD `supplied-usd` / `debt-usd` rows are informational and have
  no exit/manage shapes.
- Only curated ASA markets in the Dork.fi verified catalog are executable.
  Native ALGO and ARC-200/WAD paths are rejected.
- `get_market` must return an nToken app id that **matches the catalog**. A
  mismatch is treated as an upgrade/metadata drift and fails the quote.
- Paused markets fail at resolve time.

### Opt-ins

- Deposit / borrow / repay **do not** include an underlying ASA opt-in. Quotes
  warn when `userOptedIntoAsset` is false; submit will fail until the wallet
  opts in (and pays ASA MBR).
- nToken balances are ARC-200 on the market nt200 app, not an ASA the user
  opts into.

### Minimum balance and fees

- Readonly `get_user` / `get_user_borrow_amount` simulates **inner-call** the
  market app. They must pay `DEFAULT_DORKFI_GROUP_FEE` (20_000 µA). A 1_000 µA
  simulate returns no ABI value even for wallets with no user box.
- Lending groups may include extra funding payments around ulujs `custom()`
  (on the order of 0.1–0.9 ALGO) for boxes. Do not strip those payments.
- Beacon app `3209233839` and oracle app `3333688254` are required foreign
  apps on mainnet lending calls.

### Slippage math

- No `maxSlippageBps`. Deposit/borrow/repay `amount` is **underlying ASA base
  units**. Withdraw `amount` is **nToken (ARC-200) units**, not underlying.
- Underlying received on withdraw follows `(nToken * depositIndex) / 1e18`
  and can differ from a 1:1 guess. Metadata may include
  `expectedUnderlyingAmount` when a full-group withdraw simulate succeeds.
- A naked `withdraw` simulate (without the ulujs custom group) often fails.
  Positions therefore use nToken × deposit index for notes and do not depend
  on that simulate.

### Liquidity limits

- `get_market` exposes `maxTotalDeposits` / `maxTotalBorrows`, but quote
  compile currently fail-closes on **paused** and catalog/nToken mismatch — not
  on those caps. Borrow does not enforce health factor client-side. Review
  live market state and quote `warnings` before signing.
- Withdraw must not exceed the wallet’s nToken ARC-200 balance.

### App upgrades

- Catalog nToken vs on-chain nToken is the upgrade tripwire. After a Dork.fi
  market migration, stale `marketAppId` / `nTokenAppId` hints will fail compile
  rather than build against the wrong contract.

### Empty-user simulate (PRs #79 / #80)

Dork.fi `get_user` does not return a decoded tuple when the wallet has **no
user box**, and the same “no ABI return” symptom appears when the simulate is
under-funded. Canix treats both as **empty user / zero debt**, not as a
positions coverage gap:

- `simulateGetUser` pays the inner-call group fee and, on missing ABI return,
  returns `emptyDorkFiUser()` (all zeros) instead of throwing.
- `GET /positions` maps `get_user simulate: no ABI return` to “no debt row”
  and keeps `borrowedUsdComplete: true` so agents that block on protocol
  `partial` are not stalled.
- There is **no** `setup:createUser` shape. The first `deposit:asa` creates
  the user record. Do not skip deposit because a simulate looked like a
  failure, and do not invent a bootstrap group.
- `get_user_borrow_amount` is best-effort: missing method or simulate failure
  returns `null` and the collector falls back to scaled-borrow math.

Shipped in [compx-labs/canix402#79](https://github.com/compx-labs/canix402/pull/79)
and [compx-labs/canix402#80](https://github.com/compx-labs/canix402/pull/80).
Fixtures: `tests/integration/dorkfi-positions-merge.test.ts`
(`get_user no ABI return is zero debt`, `readonly user simulates pay the
inner-call group fee`).

## STAMM

LiquiHog multi-tier AMM. Discovery and execution go through HOGSWAP HTTP
(`POST /quote` `LP_MINT` / `LP_REDEEM` then `POST /execute`). Canix returns
unsigned groups only.

### Pool discovery

- Pass `poolAppId` (STAMM pool application id) and `tierIndex` (0–5) from
  opportunity/position `inputHints`. Do not hardcode pool, router, or registry
  app ids — `/health` `router_app_id` and `/stamm/meta` `registry_app_id` change;
  `/execute` always targets the current router.
- One opportunity row per **active tier**. `liquidityAssetId` is that tier's LP ASA.

### Opt-ins

- The wallet must already be opted into the LP ASA before mint or redeem execute.
  Opt-in is a **separate** group and is never merged into the HOGSWAP group.
- Redeem to a non-ALGO `targetAsset` also requires that ASA opt-in.
- Missing opt-in returns a 422 from HOGSWAP; Canix surfaces it as a shape-state
  error (re-quote after opt-in confirms).

### Minimum balance

- LP ASA (and target ASA) opt-ins consume extra minimum balance. Shapes do not
  fund that MBR.

### Slippage math

- `maxSlippageBps` defaults to **100** (HOGSWAP LP SDK default). Range 1–10000.
- Delivery below `min_out_at_slippage` reverts the whole group.

### Liquidity limits

- Mint accepts pool `amountA`/`amountB` (one side may be 0) **or** `externalInputs`
  (any asset, converted into the tier ratio). Inactive tiers are omitted from
  discovery.
- Optional `maxLegs` (1–16) caps HOGSWAP conversion-leg complexity when composing
  with other groups.

### App upgrades

- Never pin router/registry ids in shapes. A STAMM or HOGSWAP router upgrade that
  changes those ids is picked up automatically from `/execute`.
- Quotes expire in ~30s. After opt-in, re-quote (stale-quote).
