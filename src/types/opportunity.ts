import { Protocol } from "../routes/schemas.js";

export interface OpportunityRecordV1 {
  protocol: Protocol;
  opportunityType: "lp" | "farm" | "staking" | "lending";
  opportunityId: string;
  assetPair: string;
  apy: number;
  tvlUsd: number;
  apr?: number;
  sourceTimestamp: string;
  fetchedAt: string;
  notes?: string;
}
