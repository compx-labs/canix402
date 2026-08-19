import { USDC_ASSET_ID } from "../../../src/execution/shapes/haystack/constants.js";

export const TINYMAN_FIXTURE_FETCHED_AT = "2026-07-17T12:00:00.000Z";

export const tinymanCompxAlgoPool = {
  address: "ZKAP7DLHJ25VTHPD3W73FGDM7VGU3DJAXL7GNUFW5CG4MIMY72EZ5GFIAI",
  is_verified: true,
  annual_percentage_yield: "0.236666",
  annual_percentage_rate: "0.212481",
  liquidity_in_usd: "518.317639900972",
  asset_1: { id: "1732165149", unit_name: "COMPX", name: "CompX" },
  asset_2: { id: "0", unit_name: "ALGO", name: "ALGO" }
};

export const tinymanAlgoUsdcWithFarm = {
  address: "TINYMANALGOUSDCFARMADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  is_verified: true,
  annual_percentage_rate: "0.041",
  annual_percentage_yield: "0.052",
  staking_total_annual_percentage_rate: "0.079",
  staking_total_annual_percentage_yield: "0.081",
  liquidity_in_usd: "15000",
  asset_1: { id: 0, unit_name: "ALGO" },
  asset_2: { id: USDC_ASSET_ID, unit_name: "USDC" }
};

export const tinymanTotalYieldFallback = {
  address: "pool-total-yield",
  is_verified: true,
  total_annual_percentage_yield: "0.11",
  total_annual_percentage_rate: "0.09",
  liquidity_in_usd: 2500,
  asset_1: { id: 0, unit_name: "ALGO" },
  asset_2: { id: USDC_ASSET_ID, unit_name: "USDC" }
};

export const tinymanMissingApy = {
  address: "missing-apy",
  is_verified: true,
  liquidity_in_usd: 200
};

export const tinymanMissingTvl = {
  address: "missing-tvl",
  is_verified: true,
  annual_percentage_yield: 0.05
};

export const tinymanFarmAprOnly = {
  address: "farm-apr-only",
  is_verified: true,
  annual_percentage_yield: "0.02",
  staking_total_annual_percentage_rate: "0.04",
  liquidity_in_usd: "8000",
  asset_1: { id: 0, unit_name: "ALGO" },
  asset_2: { id: USDC_ASSET_ID, unit_name: "USDC" }
};

export const tinymanNoFarmIncentives = {
  address: "no-farm",
  is_verified: true,
  annual_percentage_yield: "0.03",
  staking_total_annual_percentage_yield: "0",
  staking_total_annual_percentage_rate: "0",
  liquidity_in_usd: "1000",
  asset_1: { id: 0, unit_name: "ALGO" },
  asset_2: { id: USDC_ASSET_ID, unit_name: "USDC" }
};

export const tinymanMissingIdentifiers = {
  annual_percentage_yield: "0.01",
  liquidity_in_usd: "100"
};
