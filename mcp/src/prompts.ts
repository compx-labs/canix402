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
                "For multi-step opens (e.g. Folks), respect order and prerequisiteShapeKeys. Use requiredAssetIds to decide whether a swap is needed before quoting.",
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
