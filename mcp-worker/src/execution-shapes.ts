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
  }
] as const;

export type ExecutionShapeInfo = (typeof EXECUTION_SHAPES)[number];
