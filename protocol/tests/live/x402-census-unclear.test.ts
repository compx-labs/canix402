import assert from "node:assert/strict";
import test from "node:test";

import { buildProductionUrl } from "../helpers/productionEndpoints.js";
import {
  buildPaymentSignature,
  decodePaymentRequiredHeader,
  getAlgorandAccept,
  getLiveEnv,
  getProductionBaseUrl,
  loadLiveEnvFiles,
  requireClientMnemonic,
  type PaymentRequestAccept
} from "../helpers/x402LiveClient.js";

loadLiveEnvFiles();

/**
 * vet402 aborts each probe, including the paid retry, after this long.
 * `PROBE_TIMEOUT_MS` default in kzmttkc/vet402-algorand.
 */
const VET402_PROBE_TIMEOUT_MS = 20_000;

/** Brownie Bot treasury. Same value as brownieBotAddress in protocol/caddy/bazaar_profiles.go. */
const BROWNIE_BOT_ADDRESS = "KPEZM2DSFHOOHG7RPDECCBTD6FRN2LPSSRJMMFVCFSIHGES4BXBJHPUBVQ";

/** NFD owner of nf.algo. Position examples use this wallet, not the free Brownie showcase. */
const NF_ALGO_ADDRESS = "5YCWR662A5HIOFYYS2CTIHHYBCIXESVLAOVLZ7CL27PK5SKBROCSRFIJMA";

interface CensusProbe {
  id: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Exact micro-USDC the 2026-09-27 census paid. Refuse to sign anything else. */
  priceMicroUsdc: bigint;
}

/**
 * The four routes vet402 marked UNCLEAR on 2026-09-27, replayed with the
 * Bazaar examples in protocol/caddy/bazaar_profiles.go. Delivery status is
 * logged and not asserted: those outcomes change after the Caddy plugin that
 * advertises the examples is redeployed.
 */
const censusProbes: CensusProbe[] = [
  {
    id: "positions-claimable",
    method: "GET",
    path: `/positions/claimable?address=${NF_ALGO_ADDRESS}`,
    priceMicroUsdc: 1_000n
  },
  {
    id: "swaps-transactions",
    method: "POST",
    path: "/swaps/transactions",
    body: {
      address: BROWNIE_BOT_ADDRESS,
      slippage: 1,
      quote: {
        router: "tinyman",
        address: BROWNIE_BOT_ADDRESS,
        fromAssetId: "0",
        toAssetId: "31566704",
        amount: "1000000",
        type: "fixed-input",
        quotedAmount: "1000000",
        minOut: "990000",
        networkFeeMicroAlgos: "2000",
        slippageBps: 100,
        createdAt: "2026-09-27T00:00:00.000Z",
        expiresAt: "2026-09-27T00:00:30.000Z",
        score: {
          expectedNetOut: "1000000",
          minOut: "990000",
          expectedIn: "1000000",
          networkFeeMicroAlgos: "2000",
          feeAlreadyNetted: true
        },
        alternatives: [],
        legs: [],
        payload: {}
      }
    },
    priceMicroUsdc: 5_000n
  },
  {
    id: "opportunities-personalized",
    method: "GET",
    path: `/opportunities/personalized?address=${BROWNIE_BOT_ADDRESS}`,
    priceMicroUsdc: 50_000n
  },
  {
    id: "execution-quotes",
    method: "POST",
    path: "/execution/quotes",
    body: {
      quotes: [
        {
          shapeKey: "mainnet:tinyman:v2:addLiquidity:flexible",
          input: {
            userAddress: BROWNIE_BOT_ADDRESS,
            assetAId: 31566704,
            assetAAmount: "1000000",
            assetBId: 0,
            assetBAmount: "2000000",
            maxSlippageBps: 50
          }
        }
      ]
    },
    priceMicroUsdc: 100_000n
  }
];

const CENSUS_SPEND_CAP_MICRO_USDC = censusProbes.reduce(
  (sum, probe) => sum + probe.priceMicroUsdc,
  0n
);

interface ProbeObservation {
  id: string;
  elapsedMs: number;
  timedOut: boolean;
  status: number | null;
  paymentResponseHeader: string | null;
  bodySnippet: string;
}

test(
  "vet402 census UNCLEAR canix402 probes reproduce with real x402 payments",
  { timeout: 180_000 },
  async (t) => {
    if (process.env.X402_CENSUS_UNCLEAR_PAID_TEST !== "1") {
      t.skip(
        "Set X402_CENSUS_UNCLEAR_PAID_TEST=1 to replay the four unclear census probes with real USDC (0.156 USDC)."
      );
      return;
    }

    const env = getLiveEnv();
    const clientMnemonic = requireClientMnemonic("npm run test:x402-census-unclear");
    const baseUrl = getProductionBaseUrl();
    let spentMicroUsdc = 0n;
    const observations: ProbeObservation[] = [];

    for (const probe of censusProbes) {
      const observation = await replayCensusProbe({
        probe,
        baseUrl,
        clientMnemonic,
        algodUrl: env.algodUrl
      });
      spentMicroUsdc += probe.priceMicroUsdc;
      assert.ok(
        spentMicroUsdc <= CENSUS_SPEND_CAP_MICRO_USDC,
        `spend ${spentMicroUsdc} exceeded cap ${CENSUS_SPEND_CAP_MICRO_USDC}`
      );
      observations.push(observation);
      console.log(
        [
          probe.id,
          observation.timedOut ? "timeout" : `status ${observation.status}`,
          observation.paymentResponseHeader ? "payment-response" : "no settlement receipt",
          `${observation.elapsedMs}ms`,
          observation.bodySnippet
        ].join(" | ")
      );
    }

    assert.equal(observations.length, censusProbes.length);
  }
);

async function replayCensusProbe(input: {
  probe: CensusProbe;
  baseUrl: string;
  clientMnemonic: string;
  algodUrl: string;
}): Promise<ProbeObservation> {
  const { probe } = input;
  const requestUrl = buildProductionUrl(input.baseUrl, probe.path);
  const serializedBody = probe.body === undefined ? undefined : JSON.stringify(probe.body);
  const started = Date.now();

  const preflightHeaders: Record<string, string> = {};
  if (serializedBody !== undefined) {
    preflightHeaders["content-type"] = "application/json";
  }

  const preflight = await fetch(requestUrl, {
    method: probe.method,
    headers: preflightHeaders,
    ...(serializedBody === undefined ? {} : { body: serializedBody }),
    signal: AbortSignal.timeout(VET402_PROBE_TIMEOUT_MS)
  });
  await preflight.arrayBuffer().catch(() => undefined);

  if (preflight.status !== 402) {
    throw new Error(`${probe.id}: expected 402 preflight, got ${preflight.status}`);
  }

  const paymentRequiredHeader = preflight.headers.get("payment-required");
  if (!paymentRequiredHeader) {
    throw new Error(`${probe.id}: missing payment-required header`);
  }

  const paymentRequest = decodePaymentRequiredHeader(paymentRequiredHeader);
  const accepted = getAlgorandAccept(paymentRequest);
  const advertised = acceptMicroUsdc(accepted);
  if (advertised !== probe.priceMicroUsdc) {
    throw new Error(
      `${probe.id}: refused to pay ${advertised} micro-USDC; census price is ${probe.priceMicroUsdc}`
    );
  }

  const paymentSignature = await buildPaymentSignature({
    paymentRequest,
    requestUrl,
    clientMnemonic: input.clientMnemonic,
    algodUrl: input.algodUrl
  });

  try {
    const paid = await fetch(requestUrl, {
      method: probe.method,
      headers: {
        ...preflightHeaders,
        "PAYMENT-SIGNATURE": paymentSignature
      },
      ...(serializedBody === undefined ? {} : { body: serializedBody }),
      signal: AbortSignal.timeout(VET402_PROBE_TIMEOUT_MS)
    });
    const bodyText = await paid.text();
    return {
      id: probe.id,
      elapsedMs: Date.now() - started,
      timedOut: false,
      status: paid.status,
      paymentResponseHeader: paid.headers.get("payment-response"),
      bodySnippet: bodyText.slice(0, 400)
    };
  } catch (error) {
    if (!isAbortTimeout(error)) {
      throw error;
    }
    return {
      id: probe.id,
      elapsedMs: Date.now() - started,
      timedOut: true,
      status: null,
      paymentResponseHeader: null,
      bodySnippet: ""
    };
  }
}

function acceptMicroUsdc(accepted: PaymentRequestAccept): bigint {
  const raw = accepted.maxAmountRequired ?? accepted.amount;
  if (!raw) {
    throw new Error("Accepted payment option is missing amount/maxAmountRequired.");
  }
  if (!raw.includes(".")) {
    return BigInt(raw);
  }

  const [whole, fraction = ""] = raw.split(".");
  const micros = `${fraction}000000`.slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(micros);
}

function isAbortTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: string; message?: string };
  return (
    candidate.name === "TimeoutError" ||
    candidate.name === "AbortError" ||
    (candidate.message ?? "").includes("aborted due to timeout")
  );
}
