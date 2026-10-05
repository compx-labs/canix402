export type SupportedProtocol = {
  slug: string;
  name: string;
  summary: string;
  notes: string;
  logo: string;
  logoVariant?: "wide";
};

export const protocols: readonly SupportedProtocol[] = [
  {
    slug: "tinyman",
    name: "Tinyman",
    summary: "LP and farm opportunities from Tinyman analytics pools API.",
    notes: "Verified pools by default; emits pool asset ids for wallet personalization.",
    logo: "/protocols/tinyman.png"
  },
  {
    slug: "pact",
    name: "Pact",
    summary: "LP and farm opportunities from Pact pools and farms APIs.",
    notes: "Combines pool TVL/APY with linked farm incentives where available.",
    logo: "/protocols/pact.png"
  },
  {
    slug: "folks-finance",
    name: "Folks Finance",
    summary: "Lending opportunities from the Folks Finance Algorand SDK.",
    notes:
      "Supply via deposit escrow; borrow/repay via loan escrow credit shapes. Emits borrowApr and executable debt positions.",
    logo: "/protocols/folks-finance.svg"
  },
  {
    slug: "compx",
    name: "CompX",
    summary: "Lending and staking opportunities via the CompX SDK.",
    notes:
      "Lending deposit/withdraw plus borrow/repay ASA shapes; staking pools with optional active-only filtering.",
    logo: "/protocols/compx.png"
  },
  {
    slug: "dorkfi",
    name: "Dork.fi",
    summary: "Cross-platform opportunities filtered to Algorand rows from Dork.fi static feed.",
    notes:
      "ASA lending deposit/withdraw/borrow/repay execution; indexed health may add informational debt-usd rows.",
    logo: "/protocols/dorkfi.png",
    logoVariant: "wide"
  },
  {
    slug: "myth-finance",
    name: "Myth Finance",
    summary:
      "dualSTAKE liquid staking and farms — stake ALGO + a paired ASA, earn consensus rewards swapped into that ASA.",
    notes:
      "Per-instance opportunities (myth-staking-{appId}); mint/redeem via execution shapes; farm incentives when present.",
    logo: "/protocols/myth-finance.svg"
  },
  {
    slug: "haystack",
    name: "Haystack",
    summary: "Single-token HAY staking with dual USDC + HAY rewards, plus HayLaunch bonding-curve token launches.",
    notes:
      "On-chain EMA APR and TVL from staking app 3321763884; stake/unstake/claim via execution shapes. HayLaunch lists, one-token status, launch, and bonding buys are separate from yield positions.",
    logo: "/protocols/haystack.png"
  },
  {
    slug: "reti",
    name: "Réti",
    summary:
      "Open-pooling consensus staking — stake ALGO to a validator; pools allocate under each validator.",
    notes:
      "Per-validator opportunities (reti-staking-{validatorId}) with entryRequirements and capacity; stake/unstake via execution shapes. POST /eligibility resolves min amount, ASA gates, and capacity before quote; quote-time checks remain authoritative.",
    logo: "/protocols/reti.png"
  },
  {
    slug: "alpha-arcade",
    name: "Alpha Arcade",
    summary: "ALPHA fee-sharing staking — stake ALPHA to earn USDC from prediction-market fees.",
    notes:
      "On-chain pool 3626756314; trailing fee APR estimate; stake/unstake/claim via execution shapes.",
    logo: "/protocols/alpha-arcade.png"
  },
  {
    slug: "morpho",
    name: "Morpho",
    summary: "Listed Morpho Vaults on Base — one-asset ERC-4626 earn.",
    notes:
      "Supply-only deposit/withdraw/redeem as unsigned calldata. Vault address in inputHints.poolId; ERC-20 in assetAddresses. chain=base on every row.",
    logo: "/protocols/morpho.svg"
  },
  {
    slug: "aave",
    name: "Aave",
    summary: "Aave V3 reserves on Base — supply, withdraw, variable borrow, and repay.",
    notes:
      "One lending row per underlying. Supply is the catalog enter shape; borrow is manage on a supplied position. Unsigned Pool calldata. chain=base on every row.",
    logo: "/protocols/aave.svg"
  },
  {
    slug: "aerodrome",
    name: "Aerodrome",
    summary: "Basic volatile and stable pools on Base with a live gauge.",
    notes:
      "Farm rows. Enter is add liquidity then gauge stake; exit is unstake then remove liquidity. APY is AERO emissions on staked liquidity. Trading fees accrue to voters. chain=base on every row.",
    logo: "/protocols/aerodrome.svg"
  },
  {
    slug: "mallow",
    name: "Mallow",
    summary: "ALGO and BTC perpetuals — limit orders with leverage, take-profit, stop-loss, and a full close.",
    notes:
      "Unsigned groups via mainnet:mallow:v1:openLimit:attached and mainnet:mallow:v1:close:market. USDC margin. Percents are return on margin. Positions settle on People's Exchange, with a 3 bps Mallow builder fee.",
    logo: "/protocols/mallow.svg"
  }
];

export const supportedProtocols = protocols.map((protocol) => protocol.name);
