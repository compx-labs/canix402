export const EXECUTION_SHAPES = [
  {
    shapeKey: "mainnet:tinyman:v2:addLiquidity:flexible",
    protocol: "tinyman",
    protocolVersion: "v2",
    action: "addLiquidity",
    variant: "flexible",
    summary: "Two-sided flexible add-liquidity to a Tinyman AMM v2 pool",
    docsPath: "protocol/docs/execution-shapes/tinyman-add-liquidity-flexible.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:v2:addLiquidity:initial",
    protocol: "tinyman",
    protocolVersion: "v2",
    action: "addLiquidity",
    variant: "initial",
    summary: "First liquidity deposit into a bootstrapped but empty Tinyman AMM v2 pool",
    docsPath: "protocol/docs/execution-shapes/tinyman-add-liquidity-initial.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:v2:addLiquidity:singleAsset",
    protocol: "tinyman",
    protocolVersion: "v2",
    action: "addLiquidity",
    variant: "singleAsset",
    summary: "One-sided add-liquidity to an existing Tinyman AMM v2 pool",
    docsPath: "protocol/docs/execution-shapes/tinyman-add-liquidity-single-asset.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:v2:removeLiquidity:multipleAssetsOut",
    protocol: "tinyman",
    protocolVersion: "v2",
    action: "removeLiquidity",
    variant: "multipleAssetsOut",
    summary: "Remove LP tokens and receive both pool assets proportionally",
    docsPath: "protocol/docs/execution-shapes/tinyman-remove-liquidity-multiple-assets-out.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:v2:removeLiquidity:singleAssetOut",
    protocol: "tinyman",
    protocolVersion: "v2",
    action: "removeLiquidity",
    variant: "singleAssetOut",
    summary: "Remove LP tokens and receive a single chosen pool asset",
    docsPath: "protocol/docs/execution-shapes/tinyman-remove-liquidity-single-asset-out.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:folks-finance:v2:setup:depositEscrow",
    protocol: "folks-finance",
    protocolVersion: "v2",
    action: "setup",
    variant: "depositEscrow",
    summary: "Create a new Folks Finance deposit escrow for the user",
    docsPath: "protocol/docs/execution-shapes/folks-finance-setup-deposit-escrow.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:folks-finance:v2:setup:optEscrowAsset",
    protocol: "folks-finance",
    protocolVersion: "v2",
    action: "setup",
    variant: "optEscrowAsset",
    summary: "Opt a Folks Finance deposit escrow into a pool fAsset",
    docsPath: "protocol/docs/execution-shapes/folks-finance-setup-opt-escrow-asset.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:folks-finance:v2:deposit:escrow",
    protocol: "folks-finance",
    protocolVersion: "v2",
    action: "deposit",
    variant: "escrow",
    summary: "Deposit underlying asset into a Folks Finance lending pool via deposit escrow",
    docsPath: "protocol/docs/execution-shapes/folks-finance-deposit-escrow.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:folks-finance:v2:withdraw:escrow",
    protocol: "folks-finance",
    protocolVersion: "v2",
    action: "withdraw",
    variant: "escrow",
    summary: "Withdraw underlying asset from a Folks Finance lending pool via deposit escrow",
    docsPath: "protocol/docs/execution-shapes/folks-finance-withdraw-escrow.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:folks-finance:xalgo-v1:stake:immediate",
    protocol: "folks-finance",
    protocolVersion: "xalgo-v1",
    action: "stake",
    variant: "immediate",
    summary: "Stake ALGO into Folks Finance liquid staking and mint xALGO immediately",
    docsPath: "protocol/docs/execution-shapes/folks-finance-stake-immediate.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:folks-finance:xalgo-v1:unstake:immediate",
    protocol: "folks-finance",
    protocolVersion: "xalgo-v1",
    action: "unstake",
    variant: "immediate",
    summary: "Burn xALGO to redeem ALGO from Folks Finance liquid staking immediately",
    docsPath: "protocol/docs/execution-shapes/folks-finance-unstake-immediate.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:pact:v1:addLiquidity:twoSided",
    protocol: "pact",
    protocolVersion: "v1",
    action: "addLiquidity",
    variant: "twoSided",
    summary: "Two-sided add-liquidity to an existing Pact AMM pool",
    docsPath: "protocol/docs/execution-shapes/pact-add-liquidity-two-sided.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:pact:v1:removeLiquidity:proportional",
    protocol: "pact",
    protocolVersion: "v1",
    action: "removeLiquidity",
    variant: "proportional",
    summary: "Remove LP tokens and receive both pool assets proportionally",
    docsPath: "protocol/docs/execution-shapes/pact-remove-liquidity-proportional.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:compx:v1:deposit:asa",
    protocol: "compx",
    protocolVersion: "v1",
    action: "deposit",
    variant: "asa",
    summary: "Deposit base ASA into a CompX lending market and receive LST",
    docsPath: "protocol/docs/execution-shapes/compx-deposit-asa.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:compx:v1:withdraw:asa",
    protocol: "compx",
    protocolVersion: "v1",
    action: "withdraw",
    variant: "asa",
    summary: "Withdraw base ASA from a CompX lending market by burning LST",
    docsPath: "protocol/docs/execution-shapes/compx-withdraw-asa.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:compx:v1:stake:asa",
    protocol: "compx",
    protocolVersion: "v1",
    action: "stake",
    variant: "asa",
    summary: "Stake ASA into a CompX staking pool",
    docsPath: "protocol/docs/execution-shapes/compx-stake-asa.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:compx:v1:unstake:asa",
    protocol: "compx",
    protocolVersion: "v1",
    action: "unstake",
    variant: "asa",
    summary: "Unstake ASA from a CompX staking pool",
    docsPath: "protocol/docs/execution-shapes/compx-unstake-asa.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:compx:v1:claim:rewards",
    protocol: "compx",
    protocolVersion: "v1",
    action: "claim",
    variant: "rewards",
    summary: "Claim accrued rewards from a CompX staking pool",
    docsPath: "protocol/docs/execution-shapes/compx-claim-rewards.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:dorkfi:v1:deposit:asa",
    protocol: "dorkfi",
    protocolVersion: "v1",
    action: "deposit",
    variant: "asa",
    summary: "Deposit ASA into a Dork.fi lending market via nt200 wrapping",
    docsPath: "protocol/docs/execution-shapes/dorkfi-deposit-asa.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:dorkfi:v1:withdraw:asa",
    protocol: "dorkfi",
    protocolVersion: "v1",
    action: "withdraw",
    variant: "asa",
    summary: "Withdraw ASA from a Dork.fi lending market by burning nToken",
    docsPath: "protocol/docs/execution-shapes/dorkfi-withdraw-asa.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:haystack:v1:stake:hay",
    protocol: "haystack",
    protocolVersion: "v1",
    action: "stake",
    variant: "hay",
    summary: "Stake HAY into the Haystack single-token staking pool",
    docsPath: "protocol/docs/execution-shapes/haystack-stake-hay.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:haystack:v1:unstake:hay",
    protocol: "haystack",
    protocolVersion: "v1",
    action: "unstake",
    variant: "hay",
    summary:
      "Unstake HAY from the Haystack staking pool and claim pending USDC and HAY rewards",
    docsPath: "protocol/docs/execution-shapes/haystack-unstake-hay.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:haystack:v1:claim:rewards",
    protocol: "haystack",
    protocolVersion: "v1",
    action: "claim",
    variant: "rewards",
    summary: "Claim accrued USDC and HAY rewards from the Haystack staking pool",
    docsPath: "protocol/docs/execution-shapes/haystack-claim-rewards.md",
    priceUsdc: "0.10"
  }
] as const;

export type ExecutionShapeInfo = (typeof EXECUTION_SHAPES)[number];
