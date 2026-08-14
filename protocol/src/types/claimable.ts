import type { Protocol } from "../routes/schemas.js";
import type { OpportunityExecutionInputHints } from "./opportunity.js";
import type { PositionType, ProtocolPositionResult } from "./position.js";

export type ClaimableWorthClaiming = true | false | null;

export interface ClaimableQuoteInput {
  userAddress: string;
  programId?: number;
  poolAddress?: string;
  poolAppId?: number;
  farmAppId?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export interface ClaimableQuoteRequest {
  shapeKey: string;
  input: ClaimableQuoteInput;
}

export interface ClaimableRewardRecord {
  protocol: Protocol;
  positionId: string;
  opportunityId: string | null;
  positionType: PositionType;
  assetId: number | null;
  assetSymbol: string | null;
  amountRaw: string;
  amount: string;
  usdValue: number | null;
  claimKey: string;
  compatibleClaimShapeKeys: string[];
  quote: ClaimableQuoteRequest | null;
  estimatedNetworkFeeMicroAlgos: string;
  estimatedNetworkFeeUsd: number | null;
  worthClaiming: ClaimableWorthClaiming;
  submitMode?: "tinyman-analytics-claim";
  caveats?: string[];
  notes?: string;
  inputHints?: OpportunityExecutionInputHints;
  sourceTimestamp?: string;
}

export interface ClaimableRewardsTotals {
  claimableUsd: number | null;
  estimatedNetworkFeeUsd: number | null;
  worthClaimingUsd: number | null;
}

export interface ClaimableRewardsResponse {
  data: ClaimableRewardRecord[];
  protocols: ProtocolPositionResult[];
  totals: ClaimableRewardsTotals;
  claimAllQuotes: {
    quotes: ClaimableQuoteRequest[];
  };
  meta: {
    address: string;
    fetchedAt: string;
    algoUsd: number | null;
    paymentRequired: true;
  };
}
