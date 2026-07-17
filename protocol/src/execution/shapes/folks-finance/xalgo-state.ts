import algosdk, { Algodv2 } from "algosdk";
import {
  ConsensusState,
  MainnetConsensusConfig,
  MainnetOpUp,
  convertAlgoToXAlgoWhenImmediate,
  convertXAlgoToAlgo,
  getConsensusState
} from "@folks-finance/algorand-sdk";

import { ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork } from "../../types.js";
import {
  createFolksBuilderAlgodClient,
  getAccountAssetBalance,
  getSuggestedParams,
  isAccountOptedIntoAsset
} from "./pool-state.js";

export interface FolksXAlgoState {
  network: ExecutionNetwork;
  consensusAppId: number;
  consensusAppAddress: string;
  xAlgoId: number;
  stakeAndDepositAppId: number;
  consensusState: ConsensusState;
  userAlgoBalance: bigint;
  userXAlgoBalance: bigint;
  needsXAlgoOptIn: boolean;
  /** Expected xALGO out for an ALGO stake (immediate rate, including premium). */
  expectedXAlgoFromAlgo: (algoAmount: bigint) => bigint;
  /** Expected ALGO out for an xALGO unstake. */
  expectedAlgoFromXAlgo: (xAlgoAmount: bigint) => bigint;
}

export interface FolksXAlgoStateDependencies {
  createAlgodClient: () => Algodv2;
  consensusConfig: typeof MainnetConsensusConfig;
  mainnetOpUp: typeof MainnetOpUp;
  getConsensusStateFn: typeof getConsensusState;
  getAccountAssetBalance: typeof getAccountAssetBalance;
  isAccountOptedIntoAsset: typeof isAccountOptedIntoAsset;
}

let dependencyOverrides: Partial<FolksXAlgoStateDependencies> | undefined;

export function setFolksXAlgoStateDependenciesForTests(
  overrides?: Partial<FolksXAlgoStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksXAlgoStateDependencies {
  return {
    createAlgodClient: createFolksBuilderAlgodClient,
    consensusConfig: MainnetConsensusConfig,
    mainnetOpUp: MainnetOpUp,
    getConsensusStateFn: getConsensusState,
    getAccountAssetBalance,
    isAccountOptedIntoAsset,
    ...dependencyOverrides
  };
}

export async function resolveFolksXAlgoState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  userAddress: string;
}): Promise<FolksXAlgoState> {
  if (params.network !== "mainnet") {
    throw new ShapeStateError(
      "Folks Finance xALGO staking shapes are currently verified for mainnet only.",
      { details: { network: params.network } }
    );
  }

  const dependencies = resolveDependencies();
  const { consensusConfig } = dependencies;
  const builderAlgod = dependencies.createAlgodClient();

  let consensusState: ConsensusState;
  try {
    consensusState = await dependencies.getConsensusStateFn(builderAlgod, consensusConfig);
  } catch (error) {
    throw new ShapeStateError("Failed to fetch Folks Finance xALGO consensus state.", {
      details: { consensusAppId: consensusConfig.consensusAppId },
      cause: error
    });
  }

  const [userAlgoBalance, userXAlgoBalance, optedIntoXAlgo] = await Promise.all([
    dependencies.getAccountAssetBalance(params.algod, params.userAddress, 0),
    dependencies.getAccountAssetBalance(
      params.algod,
      params.userAddress,
      consensusConfig.xAlgoId
    ),
    dependencies.isAccountOptedIntoAsset(
      params.algod,
      params.userAddress,
      consensusConfig.xAlgoId
    )
  ]);

  return {
    network: params.network,
    consensusAppId: consensusConfig.consensusAppId,
    consensusAppAddress: algosdk.getApplicationAddress(consensusConfig.consensusAppId).toString(),
    xAlgoId: consensusConfig.xAlgoId,
    stakeAndDepositAppId: consensusConfig.stakeAndDepositAppId,
    consensusState,
    userAlgoBalance,
    userXAlgoBalance,
    needsXAlgoOptIn: !optedIntoXAlgo,
    expectedXAlgoFromAlgo: (algoAmount) =>
      convertAlgoToXAlgoWhenImmediate(algoAmount, consensusState),
    expectedAlgoFromXAlgo: (xAlgoAmount) => convertXAlgoToAlgo(xAlgoAmount, consensusState)
  };
}

export {
  MainnetConsensusConfig,
  MainnetOpUp,
  getSuggestedParams,
  createFolksBuilderAlgodClient
};
