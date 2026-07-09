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
                "Evaluate APY/APR quality, TVL depth, protocol risk, asset exposure, and whether an execution shape exists for acting on it.",
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
