import assert from "node:assert/strict";
import test from "node:test";

import { recoverTypedDataAddress } from "viem";
import {
  BASE_USDC_ASSET_ADDRESS,
  BASE_USDC_EIP712_NAME,
  BASE_USDC_EIP712_VERSION,
  buildBasePaymentSignature
} from "@canix402/x402-client";

const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const PAY_TO = "0x1111111111111111111111111111111111111111";
const NONCE = "0x00000000000000000000000000000000000000000000000000000000000000ab";
const NOW = 1_700_000_000;

test("Base PAYMENT-SIGNATURE is an EIP-3009 authorization for the Base accept", async () => {
  const signature = await buildBasePaymentSignature({
    requestUrl: "https://canix402-api.compx.io/execution/quotes",
    privateKey: PRIVATE_KEY,
    nowSeconds: NOW,
    nonce: NONCE,
    paymentRequest: {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "algorand-mainnet",
          asset: "31566704",
          payTo: "ALGOADDR",
          amount: "100000"
        },
        {
          scheme: "exact",
          network: "eip155:8453",
          asset: BASE_USDC_ASSET_ADDRESS,
          payTo: PAY_TO,
          maxAmountRequired: "0.1",
          extra: { tag: "x402-global-challenge" }
        }
      ]
    }
  });

  const payload = JSON.parse(Buffer.from(signature, "base64").toString("utf8")) as {
    scheme: string;
    network: string;
    accepted: { network: string; amount: string };
    payload: {
      signature: `0x${string}`;
      authorization: {
        from: string;
        to: string;
        value: string;
        validAfter: string;
        validBefore: string;
        nonce: string;
      };
      paymentGroup?: unknown;
    };
  };

  assert.equal(payload.network, "eip155:8453");
  assert.equal(payload.accepted.network, "eip155:8453");
  assert.equal(payload.accepted.amount, "100000");
  assert.equal(payload.payload.paymentGroup, undefined);
  assert.equal(payload.payload.authorization.from, PAYER);
  assert.equal(payload.payload.authorization.to, PAY_TO);
  assert.equal(payload.payload.authorization.value, "100000");
  assert.equal(payload.payload.authorization.validAfter, String(NOW - 600));
  assert.equal(payload.payload.authorization.validBefore, String(NOW + 3600));
  assert.equal(payload.payload.authorization.nonce, NONCE);

  const recovered = await recoverTypedDataAddress({
    domain: {
      name: BASE_USDC_EIP712_NAME,
      version: BASE_USDC_EIP712_VERSION,
      chainId: 8453,
      verifyingContract: BASE_USDC_ASSET_ADDRESS
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: PAYER,
      to: PAY_TO,
      value: 100_000n,
      validAfter: BigInt(NOW - 600),
      validBefore: BigInt(NOW + 3600),
      nonce: NONCE
    },
    signature: payload.payload.signature
  });
  assert.equal(recovered, PAYER);
});
