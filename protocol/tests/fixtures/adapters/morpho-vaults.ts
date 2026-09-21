import type { MorphoVaultItem } from "../../../src/adapters/morpho.js";

export const MORPHO_FIXTURE_FETCHED_AT = "2026-09-21T10:00:00.000Z";

export const morphoMoonwellEurc: MorphoVaultItem = {
  address: "0xf24608E0CCb972b0b0f4A6446a0BBf58c701a026",
  chain: { id: 8453 },
  name: "Moonwell Flagship EURC",
  symbol: "mwEURC",
  listed: true,
  asset: {
    address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
    symbol: "EURC",
    decimals: 6
  },
  state: {
    apy: 0.019718232908127218,
    netApy: 0.017867453056898217,
    totalAssetsUsd: 1117934.1516950545,
    fee: 0.15
  }
};

export const morphoYearnUsdc: MorphoVaultItem = {
  address: "0xef417a2512C5a41f69AE4e021648b69a7CdE5D03",
  chain: { id: 8453 },
  name: "Yearn OG USDC",
  symbol: "ymvOG-USDC",
  listed: true,
  asset: {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    decimals: 6
  },
  state: {
    apy: 0.05196364919627212,
    netApy: 0.046648028284430536,
    totalAssetsUsd: 2003777.3610978741,
    fee: 0.1
  }
};

export const morphoUnlistedVault: MorphoVaultItem = {
  ...morphoYearnUsdc,
  address: "0x1111111111111111111111111111111111111111",
  listed: false,
  name: "Unlisted Vault"
};

export const morphoZeroTvlVault: MorphoVaultItem = {
  ...morphoYearnUsdc,
  address: "0x2222222222222222222222222222222222222222",
  state: {
    ...morphoYearnUsdc.state,
    totalAssetsUsd: 0
  }
};

export const morphoNativeEthVault: MorphoVaultItem = {
  ...morphoYearnUsdc,
  address: "0x3333333333333333333333333333333333333333",
  asset: {
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    symbol: "ETH",
    decimals: 18
  }
};

export const morphoWrongChainVault: MorphoVaultItem = {
  ...morphoYearnUsdc,
  chain: { id: 1 }
};
