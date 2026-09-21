import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_USDC_ASSET_ADDRESS,
  DEFAULT_BASE_PAYMENT_NETWORK,
  UNCONFIGURED_BASE_PAY_TO,
  getX402Chains,
  getX402EndpointMetadata,
  readX402PaymentRailConfig
} from "../../src/services/payment-policy.js";

const baseConfig = {
  facilitator: "https://facilitator.goplausible.xyz",
  algorandNetwork: "algorand-mainnet",
  algorandAsset: "31566704",
  algorandPayTo: "ALGOADDR",
  baseNetwork: DEFAULT_BASE_PAYMENT_NETWORK,
  baseAsset: BASE_USDC_ASSET_ADDRESS,
  basePayTo: "0x1111111111111111111111111111111111111111"
};

test("unconfigured Base pay-to keeps a single Algorand accept", () => {
  const metadata = getX402EndpointMetadata("0.1", {
    ...baseConfig,
    basePayTo: undefined
  });
  assert.equal(metadata.accepts.length, 1);
  assert.equal(metadata.requirementTemplate.network, "algorand-mainnet");
  assert.equal(metadata.accepts[0]?.network, metadata.requirementTemplate.network);
  assert.equal(getX402Chains(metadata).length, 1);

  const placeholder = readX402PaymentRailConfig({
    X402_PAYMENT_RECEIVER_ADDRESS_BASE: UNCONFIGURED_BASE_PAY_TO
  });
  assert.equal(placeholder.basePayTo, undefined);

  const fallback = readX402PaymentRailConfig({
    X402_PAYMENT_RECEIVER_ADDRESS_BASE: UNCONFIGURED_BASE_PAY_TO,
    X402_PAY_TO_BASE: "0x2222222222222222222222222222222222222222"
  });
  assert.equal(fallback.basePayTo, "0x2222222222222222222222222222222222222222");
});

test("configured Base pay-to advertises Algorand then Base at the same price", () => {
  const metadata = getX402EndpointMetadata("0.1", baseConfig);
  assert.equal(metadata.accepts.length, 2);
  assert.equal(metadata.accepts[0]?.network, "algorand-mainnet");
  assert.equal(metadata.accepts[0]?.asset, "31566704");
  assert.equal(metadata.accepts[0]?.payTo, "ALGOADDR");
  assert.equal(metadata.accepts[1]?.network, "eip155:8453");
  assert.equal(metadata.accepts[1]?.asset, BASE_USDC_ASSET_ADDRESS);
  assert.equal(metadata.accepts[1]?.payTo, baseConfig.basePayTo);
  assert.equal(metadata.accepts[0]?.maxAmountRequired, "0.1");
  assert.equal(metadata.accepts[1]?.maxAmountRequired, "0.1");
  assert.equal(metadata.requirementTemplate.network, "algorand-mainnet");

  const chains = getX402Chains(metadata);
  assert.equal(chains[1]?.namespace, "eip155");
  assert.equal(chains[1]?.network, "eip155:8453");
  assert.equal(chains[1]?.assets[0]?.contractAddress, BASE_USDC_ASSET_ADDRESS);
  assert.equal(chains[1]?.assets[0]?.assetId, undefined);
});
