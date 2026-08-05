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
                "Use opportunity.executionShapes (enter-only) and opportunity.executionReady. If executionReady is false or executionShapes is empty, treat as research-only and do not invent shapeKey values.",
                "When present, opportunity.compatibleExitShapes lists known exits (e.g. Folks xALGO unstake, Tinyman tALGO burn). Otherwise discover exits via positions or canix_list_execution_shapes.",
                "For lending markets, prefer opportunity.borrowApr for borrow cost. Do not treat CompX apr as borrow cost (apr is supply-side for CompX).",
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
