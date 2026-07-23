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
    shapeKey: "mainnet:tinyman:staking-v1:farm:commit",
    protocol: "tinyman",
    protocolVersion: "staking-v1",
    action: "farm",
    variant: "commit",
    summary: "Commit existing Tinyman LP to a farm (LP stays in wallet)",
    docsPath: "protocol/docs/execution-shapes/tinyman-farm-commit.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:staking-v1:farm:uncommit",
    protocol: "tinyman",
    protocolVersion: "staking-v1",
    action: "farm",
    variant: "uncommit",
    summary: "Lower or clear a Tinyman farm LP commitment (commitAmount=0 fully uncommits)",
    docsPath: "protocol/docs/execution-shapes/tinyman-farm-uncommit.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:staking-v1:farm:claimRewards",
    protocol: "tinyman",
    protocolVersion: "staking-v1",
    action: "farm",
    variant: "claimRewards",
    summary: "Claim unpaid Tinyman farm rewards (Analytics-prepared unsigned group)",
    docsPath: "protocol/docs/execution-shapes/tinyman-farm-claim-rewards.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:v2:addLiquidityAndFarm:flexible",
    protocol: "tinyman",
    protocolVersion: "v2",
    action: "addLiquidityAndFarm",
    variant: "flexible",
    summary: "Two-sided flexible add-liquidity and farm commit in one group",
    docsPath: "protocol/docs/execution-shapes/tinyman-add-liquidity-and-farm-flexible.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:v2:addLiquidityAndFarm:singleAsset",
    protocol: "tinyman",
    protocolVersion: "v2",
    action: "addLiquidityAndFarm",
    variant: "singleAsset",
    summary: "One-sided add-liquidity and farm commit in one group",
    docsPath: "protocol/docs/execution-shapes/tinyman-add-liquidity-and-farm-single-asset.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:liquid-stake-v1:mint:tAlgo",
    protocol: "tinyman",
    protocolVersion: "liquid-stake-v1",
    action: "mint",
    variant: "tAlgo",
    summary: "Stake ALGO and mint Tinyman tALGO",
    docsPath: "protocol/docs/execution-shapes/tinyman-mint-talgo.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:liquid-stake-v1:burn:tAlgo",
    protocol: "tinyman",
    protocolVersion: "liquid-stake-v1",
    action: "burn",
    variant: "tAlgo",
    summary: "Burn tALGO to redeem ALGO",
    docsPath: "protocol/docs/execution-shapes/tinyman-burn-talgo.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:restake-v1:increaseStake:stAlgo",
    protocol: "tinyman",
    protocolVersion: "restake-v1",
    action: "increaseStake",
    variant: "stAlgo",
    summary: "Restake tALGO into stALGO",
    docsPath: "protocol/docs/execution-shapes/tinyman-increase-stake-stalgo.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:restake-v1:decreaseStake:stAlgo",
    protocol: "tinyman",
    protocolVersion: "restake-v1",
    action: "decreaseStake",
    variant: "stAlgo",
    summary: "Unrestake stALGO back to tALGO",
    docsPath: "protocol/docs/execution-shapes/tinyman-decrease-stake-stalgo.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:tinyman:restake-v1:claimRewards:stAlgo",
    protocol: "tinyman",
    protocolVersion: "restake-v1",
    action: "claimRewards",
    variant: "stAlgo",
    summary: "Claim TINY rewards from Tinyman restaking",
    docsPath: "protocol/docs/execution-shapes/tinyman-claim-rewards-stalgo.md",
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
    shapeKey: "mainnet:myth-finance:dualstake-v1:mint:lst",
    protocol: "myth-finance",
    protocolVersion: "dualstake-v1",
    action: "mint",
    variant: "lst",
    summary: "Mint a Myth Finance dualSTAKE LST by depositing ALGO plus a small paired-ASA leg (not a pure ALGO 1:1 LST)",
    docsPath: "protocol/docs/execution-shapes/myth-finance-mint-lst.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:myth-finance:dualstake-v1:redeem:lst",
    protocol: "myth-finance",
    protocolVersion: "dualstake-v1",
    action: "redeem",
    variant: "lst",
    summary: "Redeem a Myth Finance dualSTAKE LST for mostly ALGO plus a small amount of the paired ASA (not 1:1 ALGO)",
    docsPath: "protocol/docs/execution-shapes/myth-finance-redeem-lst.md",
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
    shapeKey: "mainnet:pact:v1:farm:deployEscrow",
    protocol: "pact",
    protocolVersion: "v1",
    action: "farm",
    variant: "deployEscrow",
    summary: "Deploy a per-user Pact farm escrow and opt into the farm app",
    docsPath: "protocol/docs/execution-shapes/pact-farm-deploy-escrow.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:pact:v1:farm:stake",
    protocol: "pact",
    protocolVersion: "v1",
    action: "farm",
    variant: "stake",
    summary: "Stake existing Pact LP into farm escrow (LP leaves the wallet)",
    docsPath: "protocol/docs/execution-shapes/pact-farm-stake.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:pact:v1:farm:unstake",
    protocol: "pact",
    protocolVersion: "v1",
    action: "farm",
    variant: "unstake",
    summary: "Unstake Pact LP from farm escrow back to the wallet",
    docsPath: "protocol/docs/execution-shapes/pact-farm-unstake.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:pact:v1:farm:claimRewards",
    protocol: "pact",
    protocolVersion: "v1",
    action: "farm",
    variant: "claimRewards",
    summary: "Claim accrued Pact farm reward ASAs",
    docsPath: "protocol/docs/execution-shapes/pact-farm-claim-rewards.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:pact:v1:addLiquidityAndFarm:twoSided",
    protocol: "pact",
    protocolVersion: "v1",
    action: "addLiquidityAndFarm",
    variant: "twoSided",
    summary: "Add two-sided Pact LP and stake minted LP into an existing farm escrow",
    docsPath: "protocol/docs/execution-shapes/pact-add-liquidity-and-farm-two-sided.md",
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
  },
  {
    shapeKey: "mainnet:reti:v1:stake:algo",
    protocol: "reti",
    protocolVersion: "v1",
    action: "stake",
    variant: "algo",
    summary: "Stake ALGO to a Réti validator (registry allocates to a pool)",
    docsPath: "protocol/docs/execution-shapes/reti-stake-algo.md",
    priceUsdc: "0.10"
  },
  {
    shapeKey: "mainnet:reti:v1:unstake:algo",
    protocol: "reti",
    protocolVersion: "v1",
    action: "unstake",
    variant: "algo",
    summary: "Unstake ALGO from a Réti staking pool",
    docsPath: "protocol/docs/execution-shapes/reti-unstake-algo.md",
    priceUsdc: "0.10"
  }
] as const;

export type ExecutionShapeInfo = (typeof EXECUTION_SHAPES)[number];
