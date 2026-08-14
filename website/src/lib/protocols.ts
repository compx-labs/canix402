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
    summary: "Single-token HAY staking with dual USDC + HAY rewards.",
    notes:
      "On-chain EMA APR and TVL from staking app 3321763884; stake/unstake/claim via execution shapes.",
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
  }
];

export const supportedProtocols = protocols.map((protocol) => protocol.name);
