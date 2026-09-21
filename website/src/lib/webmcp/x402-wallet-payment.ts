import { isBasePaymentNetwork } from "@canix402/x402-client/base";
import algosdk from "algosdk";

import { utf8ToBase64, bytesToBase64 } from "./bytes";
import type { PaymentRequest, PaymentRequestAccept } from "./payment";

export type SuggestedTxnParams = algosdk.SuggestedParams;

function withFlatFee(params: SuggestedTxnParams, fee: number): algosdk.SuggestedParams {
  return {
    ...params,
    flatFee: true,
    fee,
    minFee: params.minFee ?? 1_000
  };
}

export interface UnsignedPaymentGroup {
  encodedTransactions: Uint8Array[];
  paymentIndex: number;
}

export interface AssemblePaymentSignatureInput {
  paymentRequired: PaymentRequest;
  accepted: PaymentRequestAccept;
  encodedUnsigned: Uint8Array[];
  signedTransactions: Array<Uint8Array | null>;
  paymentIndex: number;
}

export type SignTransactionsFn = (
  txnGroup: Uint8Array[],
  indexesToSign?: number[]
) => Promise<Array<Uint8Array | null>>;

export function selectPaymentAccept(
  paymentRequired: PaymentRequest | null | undefined
): PaymentRequestAccept | { error: string; message: string } {
  return validatePaymentAccept(paymentRequired?.accepts?.[0]);
}

export function selectBasePaymentAccept(
  paymentRequired: PaymentRequest | null | undefined
): PaymentRequestAccept | { error: string; message: string } {
  const accepted = paymentRequired?.accepts?.find((accept) => isBasePaymentNetwork(accept.network));
  if (!accepted) {
    return {
      error: "PAYMENT_INVALID",
      message: "PAYMENT_REQUIRED did not include a Base accept option."
    };
  }
  return validatePaymentAccept(accepted);
}

function validatePaymentAccept(
  accepted: PaymentRequestAccept | undefined
): PaymentRequestAccept | { error: string; message: string } {
  if (!accepted) {
    return {
      error: "PAYMENT_INVALID",
      message: "PAYMENT_REQUIRED did not include an accept option."
    };
  }
  if (accepted.scheme && accepted.scheme !== "exact") {
    return {
      error: "PAYMENT_INVALID",
      message: `Unsupported payment scheme: ${accepted.scheme}`
    };
  }
  if (typeof accepted.payTo !== "string" || accepted.payTo.length === 0) {
    return {
      error: "PAYMENT_INVALID",
      message: "PAYMENT_REQUIRED accept option is missing payTo."
    };
  }
  if (typeof accepted.asset !== "string" || accepted.asset.length === 0) {
    return {
      error: "PAYMENT_INVALID",
      message: "PAYMENT_REQUIRED accept option is missing asset."
    };
  }
  const rawAmount = accepted.maxAmountRequired ?? accepted.amount;
  if (!rawAmount) {
    return {
      error: "PAYMENT_INVALID",
      message: "PAYMENT_REQUIRED accept option is missing amount."
    };
  }
  return accepted;
}

export function amountToBaseUnits(rawAmount: string): bigint {
  if (!rawAmount.includes(".")) {
    return BigInt(rawAmount);
  }
  const [wholePart = "0", fractionPart = ""] = rawAmount.split(".");
  const paddedFraction = `${fractionPart}000000`.slice(0, 6);
  return BigInt(wholePart) * 1_000_000n + BigInt(paddedFraction);
}

export function readFeePayer(accepted: PaymentRequestAccept): string | undefined {
  const extra = accepted.extra;
  if (typeof extra !== "object" || extra === null) {
    return undefined;
  }
  const feePayer = (extra as { feePayer?: unknown }).feePayer;
  return typeof feePayer === "string" && feePayer.length > 0 ? feePayer : undefined;
}

export function buildUnsignedPaymentGroup(input: {
  sender: string;
  accepted: PaymentRequestAccept;
  suggestedParams: SuggestedTxnParams;
}): UnsignedPaymentGroup | { error: string; message: string } {
  const rawAmount = input.accepted.maxAmountRequired ?? input.accepted.amount;
  if (!rawAmount) {
    return {
      error: "PAYMENT_INVALID",
      message: "PAYMENT_REQUIRED accept option is missing amount."
    };
  }

  let amountMicro: bigint;
  try {
    amountMicro = amountToBaseUnits(rawAmount);
  } catch {
    return {
      error: "PAYMENT_INVALID",
      message: "PAYMENT_REQUIRED amount is not a valid integer."
    };
  }

  const feePayer = readFeePayer(input.accepted);
  const paymentNote = new TextEncoder().encode("x402-payment-v2");

  if (feePayer) {
    const feePayerTxn = new algosdk.Transaction({
      type: algosdk.TransactionType.pay,
      sender: feePayer,
        suggestedParams: withFlatFee(input.suggestedParams, 2_000),
      paymentParams: {
        receiver: feePayer,
        amount: 0
      },
      note: new TextEncoder().encode("x402-fee-payer")
    });
    const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: input.sender,
      receiver: input.accepted.payTo,
      amount: amountMicro,
      assetIndex: BigInt(input.accepted.asset),
      suggestedParams: withFlatFee(input.suggestedParams, 0),
      note: paymentNote
    });
    algosdk.assignGroupID([feePayerTxn, transfer]);
    return {
      encodedTransactions: [
        algosdk.encodeUnsignedTransaction(feePayerTxn),
        algosdk.encodeUnsignedTransaction(transfer)
      ],
      paymentIndex: 1
    };
  }

  const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: input.sender,
    receiver: input.accepted.payTo,
    amount: amountMicro,
    assetIndex: BigInt(input.accepted.asset),
    suggestedParams: withFlatFee(input.suggestedParams, 1_000),
    note: paymentNote
  });
  return {
    encodedTransactions: [algosdk.encodeUnsignedTransaction(transfer)],
    paymentIndex: 0
  };
}

export function assemblePaymentSignature(input: AssemblePaymentSignatureInput): string {
  const paymentGroup = input.encodedUnsigned.map((unsigned, index) => {
    if (index === input.paymentIndex) {
      const signed = input.signedTransactions[index];
      if (!signed || signed.length === 0) {
        throw Object.assign(new Error("Wallet did not sign the payment transaction."), {
          code: "PAYMENT_REJECTED"
        });
      }
      return bytesToBase64(signed);
    }
    return bytesToBase64(unsigned);
  });

  const rawAmount = input.accepted.maxAmountRequired ?? input.accepted.amount ?? "0";
  const envelope = {
    x402Version: input.paymentRequired.x402Version ?? 2,
    scheme: input.accepted.scheme ?? "exact",
    network: input.accepted.network,
    resource: input.paymentRequired.resource ?? null,
    accepted: {
      ...input.accepted,
      amount: rawAmount.includes(".") ? amountToBaseUnits(rawAmount).toString() : rawAmount
    },
    extensions: input.paymentRequired.extensions ?? {},
    outputSchema: null,
    payload: {
      paymentGroup,
      paymentIndex: input.paymentIndex
    },
    paymentRequired: input.paymentRequired
  };

  return utf8ToBase64(JSON.stringify(envelope));
}

export async function signPaymentGroup(input: {
  group: UnsignedPaymentGroup;
  signTransactions: SignTransactionsFn;
}): Promise<string[] | { error: string; message: string }> {
  try {
    const signed = await input.signTransactions(input.group.encodedTransactions, [
      input.group.paymentIndex
    ]);
    const userSigned = signed[input.group.paymentIndex];
    if (!userSigned || userSigned.length === 0) {
      return {
        error: "PAYMENT_REJECTED",
        message: "Wallet did not sign the USDC payment."
      };
    }
    return input.group.encodedTransactions.map((unsigned, index) => {
      if (index === input.group.paymentIndex) {
        return bytesToBase64(userSigned);
      }
      return bytesToBase64(unsigned);
    });
  } catch (error) {
    return {
      error: "PAYMENT_REJECTED",
      message: error instanceof Error ? error.message : "Wallet rejected the USDC payment."
    };
  }
}
