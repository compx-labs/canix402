import { Protocol } from "../routes/schemas.js";

export interface OpportunityRecordV1 {
  protocol: Protocol;
  opportunityType: "lp" | "farm" | "staking" | "lending";
  opportunityId: string;
  assetPair: string;
  assetIds?: number[];
  apy: number;
  tvlUsd: number;
  apr?: number;
  /** Upstream or on-chain update time when available; otherwise equals fetchedAt. */
  sourceTimestamp: string;
  /** ISO timestamp when this service fetched and normalized the row. */
  fetchedAt: string;
  /** Caveats about timestamp provenance, fallback identifiers, or yield estimates. */
  notes?: string;
}
