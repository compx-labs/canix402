import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";
import { prepareGroupForSending } from "@algorandfoundation/algokit-utils";
import { AlgoAmount } from "@algorandfoundation/algokit-utils/types/amount";

import { ShapeBuildError } from "../../errors.js";
import { DEFAULT_COMPX_APP_CALL_MAX_FEE } from "./shared.js";

export interface FinalizeComposerGroupParams {
  algod: Algodv2;
  atc: AtomicTransactionComposer;
  appCallMaxFee?: bigint;
}

export async function finalizeComposerGroup(params: FinalizeComposerGroupParams): Promise<Transaction[]> {
  const { algod, atc, appCallMaxFee = DEFAULT_COMPX_APP_CALL_MAX_FEE } = params;

  const built = atc.buildGroup();
  const maxFees = new Map<number, AlgoAmount>();
  built.forEach((txnWithSigner, index) => {
    if (txnWithSigner.txn.type === algosdk.TransactionType.appl) {
      maxFees.set(index, AlgoAmount.MicroAlgos(Number(appCallMaxFee)));
    }
  });

  let suggestedParams: algosdk.SuggestedParams;
  try {
    suggestedParams = await algod.getTransactionParams().do();
  } catch (error) {
    throw new ShapeBuildError("Failed to fetch suggested params for CompX staking group.", {
      cause: error
    });
  }

  try {
    const prepared = await prepareGroupForSending(
      atc,
      algod,
      {
        populateAppCallResources: true,
        coverAppCallInnerTransactionFees: true,
        suppressLog: true
      },
      {
        maxFees,
        suggestedParams: {
          fee: suggestedParams.fee,
          minFee: suggestedParams.minFee
        }
      }
    );
    return prepared.buildGroup().map((txnWithSigner) => txnWithSigner.txn);
  } catch (error) {
    throw new ShapeBuildError("Failed to finalize CompX staking transaction group.", {
      cause: error
    });
  }
}

export function addAssetOptInToComposer(params: {
  atc: AtomicTransactionComposer;
  sender: string;
  assetId: number;
  suggestedParams: algosdk.SuggestedParams;
}): void {
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: params.sender,
    receiver: params.sender,
    assetIndex: params.assetId,
    amount: 0n,
    suggestedParams: params.suggestedParams
  });
  params.atc.addTransaction({
    txn: optInTxn,
    signer: makeEmptyTransactionSigner()
  });
}

export interface StakingBoxReference {
  appIndex: number;
  name: Uint8Array;
}

export function stakingBoxReference(poolAppId: number, boxName: Uint8Array): StakingBoxReference {
  return { appIndex: poolAppId, name: boxName };
}

export interface CompXStakingBuildDependencies {
  finalizeComposerGroup: typeof finalizeComposerGroup;
}

let stakingBuildDependencyOverrides: Partial<CompXStakingBuildDependencies> | undefined;

export function setCompXStakingBuildDependenciesForTests(
  overrides?: Partial<CompXStakingBuildDependencies>
): void {
  stakingBuildDependencyOverrides = overrides;
}

export function resolveStakingBuildDependencies(): CompXStakingBuildDependencies {
  return {
    finalizeComposerGroup,
    ...stakingBuildDependencyOverrides
  };
}
