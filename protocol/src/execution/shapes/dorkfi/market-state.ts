import { Algodv2 } from "algosdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import { simulateGetMarket } from "./abi.js";
import { findCatalogMarket, type DorkFiCatalogMarket } from "./market-catalog.js";
import {
  getAccountAssetBalance,
  getApplicationAddress,
  isAssetOptedIn
} from "./shared.js";

export interface DorkFiLendingMarketState {
  network: ExecutionNetwork;
  poolAppId: number;
  marketAppId: number;
  assetId: number;
  nTokenAppId: number;
  poolAppAddress: string;
  decimals: number;
  tokenStandard: "asa";
  symbol: string;
  paused: boolean;
  /** Current market deposit index (1e18 scale). */
  depositIndex: bigint;
  userAssetBalance: bigint;
  userNTokenBalance: bigint;
  userOptedIntoAsset: boolean;
  catalogMarket: DorkFiCatalogMarket;
}

export interface DorkFiLendingMarketStateDependencies {
  simulateGetMarket: typeof simulateGetMarket;
  findCatalogMarket: typeof findCatalogMarket;
  getAccountAssetBalance: typeof getAccountAssetBalance;
  isAssetOptedIn: typeof isAssetOptedIn;
  getApplicationAddress: typeof getApplicationAddress;
  getArc200Balance: (params: {
    algod: Algodv2;
    contractAppId: number;
    userAddress: string;
  }) => Promise<bigint>;
}

let dependencyOverrides: Partial<DorkFiLendingMarketStateDependencies> | undefined;

export function setDorkFiLendingMarketStateDependenciesForTests(
  overrides?: Partial<DorkFiLendingMarketStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): DorkFiLendingMarketStateDependencies {
  return {
    simulateGetMarket,
    findCatalogMarket,
    getAccountAssetBalance,
    isAssetOptedIn,
    getApplicationAddress,
    getArc200Balance: simulateArc200BalanceOf,
    ...dependencyOverrides
  };
}

async function simulateArc200BalanceOf(params: {
  algod: Algodv2;
  contractAppId: number;
  userAddress: string;
}): Promise<bigint> {
  const { abi, CONTRACT } = await import("ulujs");
  const signer = { addr: params.userAddress, sk: new Uint8Array() };
  const token = new CONTRACT(
    params.contractAppId,
    params.algod,
    undefined,
    abi.nt200,
    signer,
    true,
    false,
    true
  );
  const response = await token.arc200_balanceOf(params.userAddress);
  return BigInt(response.returnValue);
}

export async function resolveDorkFiLendingMarketState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  poolAppId: number;
  marketAppId: number;
  assetId: number;
  userAddress: string;
  userAssetHoldings?: ReadonlyMap<number, bigint>;
}): Promise<DorkFiLendingMarketState> {
  const dependencies = resolveDependencies();

  const catalogMarket = dependencies.findCatalogMarket({
    poolAppId: params.poolAppId,
    marketAppId: params.marketAppId,
    assetId: params.assetId
  });
  if (catalogMarket === undefined) {
    throw new ShapeStateError("Dork.fi market is not in the verified ASA catalog.", {
      details: {
        poolAppId: params.poolAppId,
        marketAppId: params.marketAppId,
        assetId: params.assetId
      }
    });
  }

  if (catalogMarket.tokenStandard !== "asa") {
    throw new ShapeStateError("Dork.fi ASA lending shapes only support ASA-backed markets.", {
      details: { tokenStandard: catalogMarket.tokenStandard }
    });
  }

  let market;
  try {
    market = await dependencies.simulateGetMarket({
      algod: params.algod,
      poolAppId: params.poolAppId,
      marketAppId: params.marketAppId
    });
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Dork.fi market state.", {
      details: {
        poolAppId: params.poolAppId,
        marketAppId: params.marketAppId
      },
      cause: error
    });
  }

  if (market.paused) {
    throw new ShapeStateError("Dork.fi market is paused.", {
      details: { poolAppId: params.poolAppId, marketAppId: params.marketAppId }
    });
  }

  const nTokenAppId = Number(market.nTokenAppId);
  if (!Number.isInteger(nTokenAppId) || nTokenAppId <= 0) {
    throw new ShapeStateError("Dork.fi market returned an invalid nToken app id.", {
      details: { nTokenAppId: market.nTokenAppId.toString() }
    });
  }

  if (nTokenAppId !== catalogMarket.nTokenAppId) {
    throw new ShapeStateError("Dork.fi on-chain nToken app id does not match catalog metadata.", {
      details: {
        expected: catalogMarket.nTokenAppId,
        actual: nTokenAppId
      }
    });
  }

  const userAssetBalance =
    params.userAssetHoldings === undefined
      ? await dependencies.getAccountAssetBalance(
          params.algod,
          params.userAddress,
          params.assetId
        )
      : (params.userAssetHoldings.get(params.assetId) ?? 0n);
  const userNTokenBalance = await dependencies.getArc200Balance({
    algod: params.algod,
    contractAppId: nTokenAppId,
    userAddress: params.userAddress
  });
  const userOptedIntoAsset =
    params.assetId === 0 ||
    (params.userAssetHoldings === undefined
      ? await dependencies.isAssetOptedIn(
          params.algod,
          params.userAddress,
          params.assetId
        )
      : params.userAssetHoldings.has(params.assetId));

  return {
    network: params.network,
    poolAppId: params.poolAppId,
    marketAppId: params.marketAppId,
    assetId: params.assetId,
    nTokenAppId,
    poolAppAddress: dependencies.getApplicationAddress(params.poolAppId),
    decimals: catalogMarket.decimals,
    tokenStandard: "asa",
    symbol: catalogMarket.symbol,
    paused: market.paused,
    depositIndex: market.depositIndex,
    userAssetBalance,
    userNTokenBalance,
    userOptedIntoAsset,
    catalogMarket
  };
}
