import { endpointPolicyMatrix } from "../../src/services/payment-policy.js";

export interface ProductionEndpoint {
  id: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}

const CANONICAL_PROTOCOL_SLUG = "tinyman";

export function getProductionPersonalizedAddress(): string {
  return (
    process.env.X402_PRODUCTION_PERSONALIZED_ADDRESS
    ?? process.env.X402_PAY_TO
    ?? process.env.X402_PAYMENT_RECEIVER_ADDRESS
    ?? "3Y2V6ODUVUGM4TXOEXY65YLMKMVLG4PB3GSOXDCJDE4X5YQA5JA3P2FHAQ"
  );
}

function resolveProductionPath(pathPattern: string): string {
  if (pathPattern === "/protocols/:protocol/opportunities") {
    return `/protocols/${CANONICAL_PROTOCOL_SLUG}/opportunities`;
  }

  if (pathPattern === "/opportunities/search") {
    return "/opportunities/search?platform=tinyman&limit=1";
  }

  if (pathPattern === "/opportunities/personalized") {
    const address = getProductionPersonalizedAddress();
    return `/opportunities/personalized?address=${encodeURIComponent(address)}&limit=1`;
  }

  if (pathPattern === "/opportunities/:opportunityId/history") {
    return "/opportunities/reti-staking-12/history?window=30d";
  }

  if (pathPattern === "/positions") {
    const address = getProductionPersonalizedAddress();
    return `/positions?address=${encodeURIComponent(address)}`;
  }

  if (pathPattern === "/positions/claimable") {
    const address = getProductionPersonalizedAddress();
    return `/positions/claimable?address=${encodeURIComponent(address)}`;
  }

  if (pathPattern === "/eligibility") {
    return "/eligibility";
  }

  if (pathPattern === "/plans") {
    return "/plans";
  }

  if (pathPattern === "/plans/rebalance") {
    return "/plans/rebalance";
  }

  if (pathPattern === "/policy/validate") {
    return "/policy/validate";
  }

  if (pathPattern === "/execution/quotes") {
    return "/execution/quotes";
  }

  if (pathPattern === "/execution/compose") {
    return "/execution/compose";
  }

  if (pathPattern === "/execution/simulate") {
    return "/execution/simulate";
  }

  return pathPattern;
}

const USDC_ASSET_ID = 31566704;
const ALGO_ASSET_ID = 0;
/** 0.1 USDC — quote-only; smoke never submits a swap. */
const SMOKE_QUOTE_AMOUNT = "100000";

function toProductionEndpoint(entry: (typeof endpointPolicyMatrix)[number]): ProductionEndpoint {
  const base: ProductionEndpoint = {
    id: entry.id,
    path: resolveProductionPath(entry.pathPattern),
    method: entry.method
  };

  if (entry.pathPattern === "/eligibility") {
    return {
      ...base,
      method: "POST",
      body: {
        address: getProductionPersonalizedAddress(),
        opportunityIds: ["reti-staking-1"]
      }
    };
  }

  if (entry.pathPattern === "/plans") {
    return {
      ...base,
      method: "POST",
      body: {
        address: getProductionPersonalizedAddress(),
        budget: { assetId: 0, amount: "1000000" },
        constraints: { noNewBorrows: true, executionReadyOnly: true, maxAllocations: 1 },
        opportunityIds: ["reti-staking-12"]
      }
    };
  }

  if (entry.pathPattern === "/plans/rebalance") {
    return {
      ...base,
      method: "POST",
      body: {
        address: getProductionPersonalizedAddress(),
        harvestIdle: true,
        constraints: { noNewBorrows: true, executionReadyOnly: true, maxAllocations: 1 }
      }
    };
  }

  if (entry.pathPattern === "/policy/validate") {
    return {
      ...base,
      method: "POST",
      body: {
        policy: {
          schemaVersion: "1.0.0",
          noNewBorrows: true,
          executionReadyOnly: true
        },
        quotes: [
          {
            shapeKey: "mainnet:reti:v1:stake:algo",
            protocol: "reti",
            opportunityId: "reti-staking-12",
            tvlUsd: 1_000_000,
            sourceTimestamp: new Date().toISOString(),
            executionReady: true,
            weightBps: 10_000,
            allocatedAmount: "1000000",
            allocatedAssetId: 0
          }
        ],
        walletAlgoMicroAlgos: "5000000"
      }
    };
  }

  if (entry.pathPattern === "/execution/quotes") {
    return {
      ...base,
      body: {
        quotes: [
          {
            shapeKey: "mainnet:tinyman:v2:addLiquidity:flexible",
            input: {
              userAddress: getProductionPersonalizedAddress(),
              assetAId: USDC_ASSET_ID,
              assetAAmount: "1000000",
              assetBId: ALGO_ASSET_ID,
              assetBAmount: "1000000",
              maxSlippageBps: 50
            }
          }
        ]
      }
    };
  }

  if (entry.pathPattern === "/execution/compose") {
    return {
      ...base,
      method: "POST",
      body: {
        address: getProductionPersonalizedAddress(),
        opportunityId: "reti-staking-12",
        fromAssetId: USDC_ASSET_ID,
        amount: SMOKE_QUOTE_AMOUNT,
        slippage: 1
      }
    };
  }

  if (entry.pathPattern === "/execution/simulate") {
    return {
      ...base,
      method: "POST",
      body: {
        address: getProductionPersonalizedAddress(),
        groups: [
          {
            shapeKey: "mainnet:reti:v1:stake:algo",
            encodedTransactions: ["AAAA"]
          }
        ]
      }
    };
  }

  if (entry.pathPattern === "/pricing") {
    return {
      ...base,
      body: { assetIds: [ALGO_ASSET_ID, USDC_ASSET_ID] }
    };
  }

  if (entry.pathPattern === "/swaps/quote") {
    return {
      ...base,
      body: {
        address: getProductionPersonalizedAddress(),
        fromAssetId: USDC_ASSET_ID,
        toAssetId: ALGO_ASSET_ID,
        amount: SMOKE_QUOTE_AMOUNT,
        type: "fixed-input"
      }
    };
  }

  // `/swaps/optin` stays POST without a fixture body. Production smoke feeds it
  // the quote returned by `/swaps/quote` — static Haystack quotes expire.

  return base;
}

export const productionFreeEndpoints: ProductionEndpoint[] = endpointPolicyMatrix
  .filter((entry) => entry.access === "free")
  // `/metrics` is free on the protocol process but intentionally omitted from the
  // public Caddy free list (internal scrape on :3000 only). Unknown session
  // receipts fail-closed 402, so GET /sessions/:sessionId is not a smoke 200.
  .filter((entry) => entry.id !== "metrics" && entry.id !== "sessionsReceipt")
  .map(toProductionEndpoint);

export const productionPaidEndpoints: ProductionEndpoint[] = endpointPolicyMatrix
  .filter((entry) => entry.access === "paid")
  .map(toProductionEndpoint)
  .sort((left, right) => {
    if (left.id === "personalizedOpportunities") return 1;
    if (right.id === "personalizedOpportunities") return -1;
    return 0;
  });

export function buildProductionUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}
