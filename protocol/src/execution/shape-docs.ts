/**
 * Optional docs paths for registered execution shapes.
 * Kept alongside the registry so GET /execution/shapes can surface them without
 * duplicating the full catalog in MCP clients.
 */
export const EXECUTION_PROTOCOL_CAVEATS_DOCS_PATH =
  "protocol/docs/execution-shapes/protocol-caveats.md";

/** Agent-facing hint so OpenAPI/MCP clients do not invent construction details. */
export const EXECUTION_PROTOCOL_CAVEATS_AGENT_HINT =
  "Do not guess pool discovery, opt-ins, min-balance, slippage, liquidity limits, or app upgrades. Read protocol/docs/execution-shapes/protocol-caveats.md (GET /execution/shapes meta.caveatsDocsPath) and each shape's docsPath.";

export const EXECUTION_SHAPE_DOCS_PATHS: Readonly<Record<string, string>> = {
  "mainnet:tinyman:v2:addLiquidity:flexible":
    "protocol/docs/execution-shapes/tinyman-add-liquidity-flexible.md",
  "mainnet:tinyman:v2:addLiquidity:initial":
    "protocol/docs/execution-shapes/tinyman-add-liquidity-initial.md",
  "mainnet:tinyman:v2:addLiquidity:singleAsset":
    "protocol/docs/execution-shapes/tinyman-add-liquidity-single-asset.md",
  "mainnet:tinyman:v2:removeLiquidity:multipleAssetsOut":
    "protocol/docs/execution-shapes/tinyman-remove-liquidity-multiple-assets-out.md",
  "mainnet:tinyman:v2:removeLiquidity:singleAssetOut":
    "protocol/docs/execution-shapes/tinyman-remove-liquidity-single-asset-out.md",
  "mainnet:tinyman:staking-v1:farm:commit":
    "protocol/docs/execution-shapes/tinyman-farm-commit.md",
  "mainnet:tinyman:staking-v1:farm:uncommit":
    "protocol/docs/execution-shapes/tinyman-farm-uncommit.md",
  "mainnet:tinyman:staking-v1:farm:claimRewards":
    "protocol/docs/execution-shapes/tinyman-farm-claim-rewards.md",
  "mainnet:tinyman:v2:addLiquidityAndFarm:flexible":
    "protocol/docs/execution-shapes/tinyman-add-liquidity-and-farm-flexible.md",
  "mainnet:tinyman:v2:addLiquidityAndFarm:singleAsset":
    "protocol/docs/execution-shapes/tinyman-add-liquidity-and-farm-single-asset.md",
  "mainnet:tinyman:liquid-stake-v1:mint:tAlgo":
    "protocol/docs/execution-shapes/tinyman-mint-talgo.md",
  "mainnet:tinyman:liquid-stake-v1:burn:tAlgo":
    "protocol/docs/execution-shapes/tinyman-burn-talgo.md",
  "mainnet:tinyman:restake-v1:increaseStake:stAlgo":
    "protocol/docs/execution-shapes/tinyman-increase-stake-stalgo.md",
  "mainnet:tinyman:restake-v1:decreaseStake:stAlgo":
    "protocol/docs/execution-shapes/tinyman-decrease-stake-stalgo.md",
  "mainnet:tinyman:restake-v1:claimRewards:stAlgo":
    "protocol/docs/execution-shapes/tinyman-claim-rewards-stalgo.md",
  "mainnet:folks-finance:v2:setup:depositEscrow":
    "protocol/docs/execution-shapes/folks-finance-setup-deposit-escrow.md",
  "mainnet:folks-finance:v2:setup:optEscrowAsset":
    "protocol/docs/execution-shapes/folks-finance-setup-opt-escrow-asset.md",
  "mainnet:folks-finance:v2:deposit:escrow":
    "protocol/docs/execution-shapes/folks-finance-deposit-escrow.md",
  "mainnet:folks-finance:v2:withdraw:escrow":
    "protocol/docs/execution-shapes/folks-finance-withdraw-escrow.md",
  "mainnet:folks-finance:v2:setup:loanEscrow":
    "protocol/docs/execution-shapes/folks-finance-setup-loan-escrow.md",
  "mainnet:folks-finance:v2:setup:addCollateral":
    "protocol/docs/execution-shapes/folks-finance-setup-add-collateral.md",
  "mainnet:folks-finance:v2:collateral:sync":
    "protocol/docs/execution-shapes/folks-finance-collateral-sync.md",
  "mainnet:folks-finance:v2:borrow:variable":
    "protocol/docs/execution-shapes/folks-finance-borrow-variable.md",
  "mainnet:folks-finance:v2:repay:withTxn":
    "protocol/docs/execution-shapes/folks-finance-repay-with-txn.md",
  "mainnet:folks-finance:v2:collateral:reduce":
    "protocol/docs/execution-shapes/folks-finance-collateral-reduce.md",
  "mainnet:folks-finance:xalgo-v1:stake:immediate":
    "protocol/docs/execution-shapes/folks-finance-stake-immediate.md",
  "mainnet:folks-finance:xalgo-v1:unstake:immediate":
    "protocol/docs/execution-shapes/folks-finance-unstake-immediate.md",
  "mainnet:myth-finance:dualstake-v1:mint:lst":
    "protocol/docs/execution-shapes/myth-finance-mint-lst.md",
  "mainnet:myth-finance:dualstake-v1:redeem:lst":
    "protocol/docs/execution-shapes/myth-finance-redeem-lst.md",
  "mainnet:pact:v1:addLiquidity:twoSided":
    "protocol/docs/execution-shapes/pact-add-liquidity-two-sided.md",
  "mainnet:pact:v1:removeLiquidity:proportional":
    "protocol/docs/execution-shapes/pact-remove-liquidity-proportional.md",
  "mainnet:pact:v1:farm:deployEscrow":
    "protocol/docs/execution-shapes/pact-farm-deploy-escrow.md",
  "mainnet:pact:v1:farm:stake":
    "protocol/docs/execution-shapes/pact-farm-stake.md",
  "mainnet:pact:v1:farm:unstake":
    "protocol/docs/execution-shapes/pact-farm-unstake.md",
  "mainnet:pact:v1:farm:claimRewards":
    "protocol/docs/execution-shapes/pact-farm-claim-rewards.md",
  "mainnet:pact:v1:addLiquidityAndFarm:twoSided":
    "protocol/docs/execution-shapes/pact-add-liquidity-and-farm-two-sided.md",
  "mainnet:compx:v1:deposit:asa":
    "protocol/docs/execution-shapes/compx-deposit-asa.md",
  "mainnet:compx:v1:withdraw:asa":
    "protocol/docs/execution-shapes/compx-withdraw-asa.md",
  "mainnet:compx:v1:borrow:asa":
    "protocol/docs/execution-shapes/compx-borrow-asa.md",
  "mainnet:compx:v1:repay:asa":
    "protocol/docs/execution-shapes/compx-repay-asa.md",
  "mainnet:compx:v1:stake:asa":
    "protocol/docs/execution-shapes/compx-stake-asa.md",
  "mainnet:compx:v1:unstake:asa":
    "protocol/docs/execution-shapes/compx-unstake-asa.md",
  "mainnet:compx:v1:claim:rewards":
    "protocol/docs/execution-shapes/compx-claim-rewards.md",
  "mainnet:dorkfi:v1:deposit:asa":
    "protocol/docs/execution-shapes/dorkfi-deposit-asa.md",
  "mainnet:dorkfi:v1:withdraw:asa":
    "protocol/docs/execution-shapes/dorkfi-withdraw-asa.md",
  "mainnet:dorkfi:v1:borrow:asa":
    "protocol/docs/execution-shapes/dorkfi-borrow-asa.md",
  "mainnet:dorkfi:v1:repay:asa":
    "protocol/docs/execution-shapes/dorkfi-repay-asa.md",
  "mainnet:haystack:v1:stake:hay":
    "protocol/docs/execution-shapes/haystack-stake-hay.md",
  "mainnet:haystack:v1:unstake:hay":
    "protocol/docs/execution-shapes/haystack-unstake-hay.md",
  "mainnet:haystack:v1:claim:rewards":
    "protocol/docs/execution-shapes/haystack-claim-rewards.md",
  "mainnet:reti:v1:stake:algo":
    "protocol/docs/execution-shapes/reti-stake-algo.md",
  "mainnet:reti:v1:unstake:algo":
    "protocol/docs/execution-shapes/reti-unstake-algo.md",
  "mainnet:alpha-arcade:v1:stake:alpha":
    "protocol/docs/execution-shapes/alpha-arcade-stake-alpha.md",
  "mainnet:alpha-arcade:v1:unstake:alpha":
    "protocol/docs/execution-shapes/alpha-arcade-unstake-alpha.md",
  "mainnet:alpha-arcade:v1:claimRewards:usdc":
    "protocol/docs/execution-shapes/alpha-arcade-claim-rewards-usdc.md",
  "mainnet:stamm:v1:mint:lp": "protocol/docs/execution-shapes/stamm-mint-lp.md",
  "mainnet:stamm:v1:redeem:lp": "protocol/docs/execution-shapes/stamm-redeem-lp.md"
};

export function getExecutionShapeDocsPath(shapeKey: string): string | undefined {
  return EXECUTION_SHAPE_DOCS_PATHS[shapeKey];
}
