import type { AaveReserveItem } from "../../../src/adapters/aave.js";

export const AAVE_FIXTURE_FETCHED_AT = "2026-09-22T10:00:00.000Z";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

export const aaveUsdc: AaveReserveItem = {
  underlyingToken: { address: USDC, symbol: "USDC", decimals: 6 },
  aToken: { address: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB" },
  vToken: { address: "0x59dca05b6c26dbd64b5381374aAaC5CD05644C28" },
  isFrozen: false,
  isPaused: false,
  usdExchangeRate: "1",
  size: { usd: "179287040.75731447" },
  supplyInfo: {
    apy: { value: "0.038085525415474957" },
    maxLTV: { value: "0.75" },
    liquidationThreshold: { value: "0.78" }
  },
  borrowInfo: {
    apy: { value: "0.047672454913218233" },
    utilizationRate: { value: "0.8917849970514299" },
    borrowingState: "ENABLED"
  }
};

export const aaveWethBorrowDisabled: AaveReserveItem = {
  underlyingToken: { address: WETH, symbol: "WETH", decimals: 18 },
  aToken: { address: "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7" },
  vToken: { address: "0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E" },
  isFrozen: false,
  isPaused: false,
  usdExchangeRate: "2500",
  size: { usd: "1000" },
  supplyInfo: {
    apy: { value: "0.02" },
    maxLTV: { value: "0.80" },
    liquidationThreshold: { value: "0.83" }
  },
  borrowInfo: {
    apy: { value: "0.03" },
    utilizationRate: { value: "0.10" },
    borrowingState: "DISABLED"
  }
};

export const aaveFrozen: AaveReserveItem = {
  ...aaveUsdc,
  isFrozen: true,
  underlyingToken: {
    address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    symbol: "USDbC",
    decimals: 6
  }
};

export const aavePaused: AaveReserveItem = {
  ...aaveUsdc,
  isPaused: true
};

export const aaveZeroTvl: AaveReserveItem = {
  ...aaveUsdc,
  size: { usd: "0" }
};

export const aaveCollateralOnlyZeroApy: AaveReserveItem = {
  underlyingToken: {
    address: "0x2416092f143378750bb29b79eD961ab195CcEea5",
    symbol: "ezETH",
    decimals: 18
  },
  aToken: { address: "0xDD5745756C2de109183c6B5bB886F9207bEF114D" },
  vToken: { address: "0xbc4f5631f2843488792e4F1660d0A51Ba489bdBd" },
  isFrozen: false,
  isPaused: false,
  usdExchangeRate: "3000",
  size: { usd: "18472" },
  supplyInfo: {
    apy: { value: "0" },
    maxLTV: { value: "0" },
    liquidationThreshold: { value: "0.001" }
  },
  borrowInfo: {
    apy: { value: "0" },
    utilizationRate: { value: "0" },
    borrowingState: "DISABLED"
  }
};

export const aaveNativeEth: AaveReserveItem = {
  ...aaveUsdc,
  underlyingToken: {
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    symbol: "ETH",
    decimals: 18
  }
};
