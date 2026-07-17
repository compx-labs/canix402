import algosdk from "algosdk";
import { getAlgorandAccept, type PaymentRequest, type PaymentRequestAccept } from "./protocol.js";

export interface BuildPaymentSignatureInput {
  paymentRequest: PaymentRequest;
  requestUrl: string;
  clientMnemonic: string;
  algodUrl: string;
  /** Optional ASA transfer note; defaults to x402-payment-v2. */
  paymentNote?: string;
}

export async function buildPaymentSignature(
  input: BuildPaymentSignatureInput
): Promise<string> {
  const accepted = getAlgorandAccept(input.paymentRequest);
  const rawAmount = accepted.maxAmountRequired ?? accepted.amount;
  if (!rawAmount) {
    throw new Error("Accepted payment option is missing amount/maxAmountRequired.");
  }

  const amountMicroUsdc = BigInt(rawAmount.includes(".") ? usdcToMicro(rawAmount) : rawAmount);

  const account = algosdk.mnemonicToSecretKey(input.clientMnemonic);
  const algod = new algosdk.Algodv2("", input.algodUrl, "");
  const suggested = await algod.getTransactionParams().do();
  const feePayer = getFeePayer(accepted);

  const payment = feePayer
    ? buildFeePayerPayment({
        account,
        accepted,
        amountMicroUsdc,
        suggested,
        feePayer,
        note: input.paymentNote
      })
    : buildDirectPayment({
        account,
        accepted,
        amountMicroUsdc,
        suggested,
        note: input.paymentNote
      });

  const normalizedAmount = rawAmount.includes(".") ? usdcToMicro(rawAmount) : rawAmount;

  const paymentSignaturePayload = {
    x402Version: input.paymentRequest.x402Version ?? 2,
    scheme: accepted.scheme ?? "exact",
    network: accepted.network,
    resource: input.paymentRequest.resource ?? { url: input.requestUrl },
    accepted: {
      ...accepted,
      amount: normalizedAmount
    },
    extensions: {},
    outputSchema: null,
    payload: {
      paymentGroup: payment.paymentGroup,
      paymentIndex: payment.paymentIndex
    },
    paymentRequired: input.paymentRequest
  };

  return Buffer.from(JSON.stringify(paymentSignaturePayload), "utf-8").toString("base64");
}

function usdcToMicro(usdcAmount: string): string {
  const [wholePart = "0", fractionPart = ""] = usdcAmount.split(".");
  const paddedFraction = `${fractionPart}000000`.slice(0, 6);
  return `${BigInt(wholePart) * 1_000_000n + BigInt(paddedFraction)}`;
}

interface PaymentBuildInput {
  account: algosdk.Account;
  accepted: PaymentRequestAccept;
  amountMicroUsdc: bigint;
  suggested: algosdk.SuggestedParams;
  note?: string;
}

interface BuiltPayment {
  paymentGroup: string[];
  paymentIndex: number;
}

function paymentNoteBytes(note?: string): Uint8Array {
  return new TextEncoder().encode(note?.trim() || "x402-payment-v2");
}

function buildDirectPayment(input: PaymentBuildInput): BuiltPayment {
  const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: input.account.addr,
    receiver: input.accepted.payTo,
    amount: input.amountMicroUsdc,
    assetIndex: BigInt(input.accepted.asset),
    suggestedParams: {
      ...input.suggested,
      flatFee: true,
      fee: 1_000
    },
    note: paymentNoteBytes(input.note)
  });

  const signed = algosdk.signTransaction(transfer, input.account.sk);
  return {
    paymentGroup: [Buffer.from(signed.blob).toString("base64")],
    paymentIndex: 0
  };
}

function buildFeePayerPayment(
  input: PaymentBuildInput & { feePayer: string }
): BuiltPayment {
  const feePayerTxn = new algosdk.Transaction({
    type: algosdk.TransactionType.pay,
    sender: input.feePayer,
    suggestedParams: {
      ...input.suggested,
      flatFee: true,
      fee: 2_000
    },
    paymentParams: {
      receiver: input.feePayer,
      amount: 0
    },
    note: new TextEncoder().encode("x402-fee-payer")
  });

  const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: input.account.addr,
    receiver: input.accepted.payTo,
    amount: input.amountMicroUsdc,
    assetIndex: BigInt(input.accepted.asset),
    suggestedParams: {
      ...input.suggested,
      flatFee: true,
      fee: 0
    },
    note: paymentNoteBytes(input.note)
  });

  algosdk.assignGroupID([feePayerTxn, transfer]);

  const feePayerBytes = algosdk.encodeUnsignedTransaction(feePayerTxn);
  const signedTransfer = algosdk.signTransaction(transfer, input.account.sk);

  return {
    paymentGroup: [
      Buffer.from(feePayerBytes).toString("base64"),
      Buffer.from(signedTransfer.blob).toString("base64")
    ],
    paymentIndex: 1
  };
}

function getFeePayer(accepted: PaymentRequestAccept): string | undefined {
  const extra = accepted.extra;
  if (typeof extra !== "object" || extra === null) {
    return undefined;
  }

  const feePayer = (extra as { feePayer?: unknown }).feePayer;
  return typeof feePayer === "string" && feePayer.length > 0 ? feePayer : undefined;
}
