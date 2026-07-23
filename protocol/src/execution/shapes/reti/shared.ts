import algosdk, {
  Algodv2,
  AtomicTransactionComposer,
  Transaction,
  makeEmptyTransactionSigner
} from "algosdk";
import { prepareGroupForSending } from "@algorandfoundation/algokit-utils";
import { AlgoAmount } from "@algorandfoundation/algokit-utils/types/amount";

import { ShapeBuildError } from "../../errors.js";
import { RETI_APP_CALL_MAX_FEE_MICRO_ALGOS } from "../../../reti/constants.js";

export async function getSuggestedParams(algod: Algodv2): Promise<algosdk.SuggestedParams> {
  return algod.getTransactionParams().do();
}

export async function finalizeRetiComposerGroup(params: {
  algod: Algodv2;
  atc: AtomicTransactionComposer;
  appCallMaxFee?: bigint;
}): Promise<Transaction[]> {
  const {
    algod,
    atc,
    appCallMaxFee = RETI_APP_CALL_MAX_FEE_MICRO_ALGOS
  } = params;

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
    throw new ShapeBuildError("Failed to fetch suggested params for Réti group.", {
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
    throw new ShapeBuildError("Failed to finalize Réti transaction group.", {
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
