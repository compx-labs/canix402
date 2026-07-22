export type DorkFiTokenStandard = "asa" | "network" | "arc200";

export interface DorkFiCatalogMarket {
  symbol: string;
  poolAppId: number;
  marketAppId: number;
  nTokenAppId: number;
  assetId: number;
  decimals: number;
  tokenStandard: DorkFiTokenStandard;
}

/**
 * Curated Algorand mainnet ASA markets verified against DorkFi public market data.
 * Used for static metadata; on-chain `get_market` remains authoritative for live state.
 */
export const DORKFI_ALGORAND_ASA_MARKETS: readonly DorkFiCatalogMarket[] = [
  {
    symbol: "USDC",
    poolAppId: 3_333_688_282,
    marketAppId: 3_210_682_240,
    nTokenAppId: 3_333_764_003,
    assetId: 31_566_704,
    decimals: 6,
    tokenStandard: "asa"
  },
  {
    symbol: "UNIT",
    poolAppId: 3_333_688_282,
    marketAppId: 3_220_125_024,
    nTokenAppId: 3_333_783_429,
    assetId: 3_121_954_282,
    decimals: 8,
    tokenStandard: "asa"
  },
  {
    symbol: "POW",
    poolAppId: 3_333_688_282,
    marketAppId: 3_080_081_069,
    nTokenAppId: 3_345_339_041,
    assetId: 2_994_233_666,
    decimals: 6,
    tokenStandard: "asa"
  },
  {
    symbol: "goBTC",
    poolAppId: 3_333_688_282,
    marketAppId: 3_211_820_549,
    nTokenAppId: 3_345_872_342,
    assetId: 386_192_725,
    decimals: 8,
    tokenStandard: "asa"
  },
  {
    symbol: "USDt",
    poolAppId: 3_345_940_978,
    marketAppId: 3_346_408_431,
    nTokenAppId: 3_346_410_585,
    assetId: 312_769,
    decimals: 6,
    tokenStandard: "asa"
  },
  {
    symbol: "COMPX",
    poolAppId: 3_345_940_978,
    marketAppId: 3_211_800_950,
    nTokenAppId: 3_347_572_206,
    assetId: 1_732_165_149,
    decimals: 6,
    tokenStandard: "asa"
  }
] as const;

export function findCatalogMarket(params: {
  poolAppId: number;
  marketAppId: number;
  assetId: number;
}): DorkFiCatalogMarket | undefined {
  return DORKFI_ALGORAND_ASA_MARKETS.find(
    (market) =>
      market.poolAppId === params.poolAppId &&
      market.marketAppId === params.marketAppId &&
      market.assetId === params.assetId
  );
}

/**
 * Resolve a catalog market from opportunity identifiers.
 * Opportunity IDs encode poolAppId + assetId (not marketAppId).
 */
export function findCatalogMarketByPoolAndAsset(params: {
  poolAppId: number;
  assetId: number;
}): DorkFiCatalogMarket | undefined {
  return DORKFI_ALGORAND_ASA_MARKETS.find(
    (market) =>
      market.poolAppId === params.poolAppId && market.assetId === params.assetId
  );
}
