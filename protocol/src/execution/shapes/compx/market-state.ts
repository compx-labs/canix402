import algosdk, { Algodv2 } from "algosdk";
import { CompXSDK, LendingClient, type MarketData } from "@compx/sdk";

import { ShapeStateError } from "../../errors.js";
import type { AlgorandExecutionNetwork } from "../../types.js";
import { ALGO_ASSET_ID } from "./parse-input.js";
import { getAccountAssetBalance, getApplicationAddress, isAssetOptedIn } from "./shared.js";

export interface CompXLendingMarketState {
  network: AlgorandExecutionNetwork;
  marketAppId: number;
  marketAppAddress: string;
  baseTokenId: number;
  lstTokenId: number;
  contractState: number;
  market: MarketData;
  userBaseBalance: bigint;
  userLstBalance: bigint;
  userOptedIntoLst: boolean;
  userOptedIntoBase: boolean;
}

export interface CompXLendingMarketStateDependencies {
  createLendingClient: (algod: Algodv2, network: AlgorandExecutionNetwork) => LendingClient;
  getMarket: (client: LendingClient, marketAppId: number) => Promise<MarketData | null>;
  getAccountAssetBalance: typeof getAccountAssetBalance;
  isAssetOptedIn: typeof isAssetOptedIn;
  getApplicationAddress: typeof getApplicationAddress;
}

let dependencyOverrides: Partial<CompXLendingMarketStateDependencies> | undefined;

export function setCompXLendingMarketStateDependenciesForTests(
  overrides?: Partial<CompXLendingMarketStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): CompXLendingMarketStateDependencies {
  return {
    createLendingClient: (algod, network) => new CompXSDK({ algodClient: algod, network }).lending,
    getMarket: async (client, marketAppId) => client.getMarket(marketAppId),
    getAccountAssetBalance,
    isAssetOptedIn,
    getApplicationAddress,
    ...dependencyOverrides
  };
}

export async function resolveCompXLendingMarketState(params: {
  network: AlgorandExecutionNetwork;
  algod: Algodv2;
  marketAppId: number;
  userAddress: string;
  userAssetHoldings?: ReadonlyMap<number, bigint>;
}): Promise<CompXLendingMarketState> {
  const dependencies = resolveDependencies();
  const { network, algod, marketAppId, userAddress } = params;

  const lendingClient = dependencies.createLendingClient(algod, network);

  let market: MarketData | null;
  try {
    market = await dependencies.getMarket(lendingClient, marketAppId);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch CompX lending market.", {
      details: { marketAppId, network },
      cause: error
    });
  }

  if (market === null) {
    throw new ShapeStateError("CompX lending market not found.", {
      details: { marketAppId, network }
    });
  }

  if (market.baseTokenId === ALGO_ASSET_ID) {
    throw new ShapeStateError("CompX lending execution shapes support ASA-base markets only.", {
      details: { marketAppId, baseTokenId: market.baseTokenId }
    });
  }

  if (market.contractState !== 1) {
    throw new ShapeStateError("CompX lending market is not active.", {
      details: { marketAppId, contractState: market.contractState }
    });
  }

  const [userBaseBalance, userLstBalance, userOptedIntoBase, userOptedIntoLst] =
    params.userAssetHoldings === undefined
      ? await Promise.all([
          dependencies.getAccountAssetBalance(
            algod,
            userAddress,
            market.baseTokenId
          ),
          dependencies.getAccountAssetBalance(
            algod,
            userAddress,
            market.lstTokenId
          ),
          dependencies.isAssetOptedIn(
            algod,
            userAddress,
            market.baseTokenId
          ),
          dependencies.isAssetOptedIn(
            algod,
            userAddress,
            market.lstTokenId
          )
        ])
      : [
          params.userAssetHoldings.get(market.baseTokenId) ?? 0n,
          params.userAssetHoldings.get(market.lstTokenId) ?? 0n,
          market.baseTokenId === 0 ||
            params.userAssetHoldings.has(market.baseTokenId),
          market.lstTokenId === 0 ||
            params.userAssetHoldings.has(market.lstTokenId)
        ];

  return {
    network,
    marketAppId,
    marketAppAddress: dependencies.getApplicationAddress(marketAppId),
    baseTokenId: market.baseTokenId,
    lstTokenId: market.lstTokenId,
    contractState: market.contractState,
    market,
    userBaseBalance,
    userLstBalance,
    userOptedIntoBase,
    userOptedIntoLst
  };
}

export function assertMarketAssetIdsMatchState(params: {
  marketAppId: number;
  baseTokenId: number;
  lstTokenId: number;
  state: CompXLendingMarketState;
}): void {
  if (
    params.marketAppId !== params.state.marketAppId ||
    params.baseTokenId !== params.state.baseTokenId ||
    params.lstTokenId !== params.state.lstTokenId
  ) {
    throw new ShapeStateError("Resolved CompX lending market assets do not match on-chain state.", {
      details: params
    });
  }
}
