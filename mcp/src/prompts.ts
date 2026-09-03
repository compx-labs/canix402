import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "analyze-opportunity",
    {
      description:
        "Guide structured evaluation of a canix402 opportunity record without calling paid endpoints.",
      argsSchema: {
        opportunityJson: z
          .string()
          .describe("JSON string of a single opportunity record from canix402")
      }
    },
    async ({ opportunityJson }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Analyze this Algorand DeFi opportunity from canix402.",
                "Evaluate APY/APR quality, TVL depth, protocol risk, asset exposure, and execution readiness.",
                "Prefer opportunity.risk over raw apy when ranking or recommending. Penalize low confidence, high utilization, high volatility, exhausted reward runway, and (when address is in context) low wallet healthFactor. Do not invent missing risk numbers.",
                "Use opportunity.executionShapes (enter-only) and opportunity.executionReady. If executionReady is false or executionShapes is empty, treat as research-only and do not invent shapeKey values.",
                "When present, opportunity.compatibleExitShapes lists known exits (e.g. Folks xALGO unstake, Tinyman tALGO burn). Otherwise discover exits via positions or canix_list_execution_shapes.",
                "For claimable rewards / harvest flows, prefer canix_list_claimable (GET /positions/claimable) over scraping reward rows from canix_get_positions. Pass claimAllQuotes.quotes or selected quote objects to canix_get_execution_quote; groups are never merged. Sign and submit locally.",
                "Personalized ranking (canix_get_personalized_opportunities) applies eligibility rules so full or gated venues are not recommended as enterable. Before quoting an enter, call canix_check_eligibility (POST /eligibility) for canEnter, missingAssets, gates, capacity, and suggestedSwap. NFD/creator gates stay unresolved — do not treat canEnter as true when eligibilityFullyCheckable is false. Quote-time on-chain checks remain authoritative.",
                "For allocation intents (budget + constraints), prefer canix_get_plan (POST /plans) over assembling quotes yourself. The plan reuses eligibility and returns ordered unsigned groups (quotes[] / order / prerequisiteShapeKeys), including live Haystack opt-in → swap → enter compose when requiredAssetIds differ from the budget asset. For a single “I hold A, I want this opportunity” path, use canix_compose_enter (POST /execution/compose). For a delta rebalance of the existing book (target weights or harvest idle ALGO / claim and redeploy), use canix_get_rebalance_plan (POST /plans/rebalance) — claims, exits, swaps, and enters as unmerged unsigned groups; not a full unwind-and-rebuild. Validate the compiled plan against an operator policy with canix_validate_policy (POST /policy/validate) — shared schema for Brownie and a second agent; fail-closed reasons are machine-readable (protocol-weight, below-reserve, below-tvl-floor, source-not-fresh, new-borrow, execution-not-ready). Simulate compiled groups with canix_simulate_execution (POST /execution/simulate) before signing — fail-closed reasons are machine-readable (stale quote, not opted in, min balance, health factor, capacity). POST /plans attaches data.simulation when groups are compiled. Groups stay unmerged. Sign only user legs; preserve Haystack pre-signed members. Sign and submit locally — do not fork a compiler.",
                "To stop polling positions, register a paid watch retainer with canix_create_watch (POST /watch): address + thresholds (healthFactor, claimableUsd, apyDropBps, retiCapacity) and optional HTTPS webhook. Firings are signed (X-Canix-Signature) and idempotent (X-Canix-Idempotency-Key). Read recent firings from canix_get_watch / canix://watch/{watchId}. Canix never stores wallet keys.",
                "For lending markets, prefer opportunity.risk.borrowApr or opportunity.borrowApr for borrow cost. Do not treat CompX apr as borrow cost (apr is supply-side for CompX). When opportunity.risk.healthFactor is present, treat it as wallet-venue health from existing position snapshots.",
                "Debt exits come from positions (compatibleExitShapeKeys / repay shapes). CompX supplied LST positions may expose borrow:asa as a manage shape for leverage-up.",
                "For multi-step opens (e.g. Folks deposit escrow or Folks loan credit: loanEscrow → addCollateral → sync → borrow), respect order and prerequisiteShapeKeys. Use requiredAssetIds to decide whether a swap is needed before quoting.",
                "Do not invent on-chain state. If data is missing, say what additional canix402 tool calls would help.",
                "",
                "Opportunity JSON:",
                opportunityJson
              ].join("\n")
            }
          }
        ]
      };
    }
  );
}
