import { WEBMCP_TOOLS } from "./catalog";
import { TABLE_FILLING_TOOLS } from "./opportunities";
import type { WebMcpToolSpec } from "./types";

export interface WebMcpToolGroup {
  id: string;
  label: string;
  hint: string;
  names: readonly string[];
}

export const HUMAN_CHECKOUT_TOOLS = new Set(["canix_create_session", "canix_refresh_session"]);

export const WEBMCP_TOOL_GROUPS: WebMcpToolGroup[] = [
  {
    id: "opportunities",
    label: "Opportunities",
    hint: "Results replace the table.",
    names: [
      "canix_list_opportunities",
      "canix_search_opportunities",
      "canix_get_personalized_opportunities",
      "canix_get_opportunity_history",
      "canix_get_protocol_opportunities"
    ]
  },
  {
    id: "wallet",
    label: "Wallet & eligibility",
    hint: "Positions, rewards, and entry checks.",
    names: ["canix_get_positions", "canix_list_claimable", "canix_check_eligibility"]
  },
  {
    id: "execution",
    label: "Plans & execution",
    hint: "Unsigned quotes and plans. Canix does not sign or submit.",
    names: [
      "canix_get_plan",
      "canix_list_execution_shapes",
      "canix_get_execution_quote",
      "canix_get_quote",
      "canix_optin",
      "canix_swap"
    ]
  },
  {
    id: "discovery",
    label: "Discovery",
    hint: "Free catalog and metadata.",
    names: [
      "canix_health",
      "canix_get_metadata",
      "canix_get_discovery",
      "canix_get_openapi",
      "canix_get_token_prices"
    ]
  },
  {
    id: "session",
    label: "Session",
    hint: "Humans buy a session in the bar above. Agents use these tools directly.",
    names: ["canix_create_session", "canix_refresh_session", "canix_get_session"]
  },
  {
    id: "watch",
    label: "Watch",
    hint: "Paid retainers that push threshold crossings instead of polling positions.",
    names: [
      "canix_create_watch",
      "canix_refresh_watch",
      "canix_get_watch",
      "canix_rotate_watch_secret"
    ]
  }
];

export function toolsInGroup(group: WebMcpToolGroup): WebMcpToolSpec[] {
  return group.names
    .map((name) => WEBMCP_TOOLS.find((tool) => tool.name === name))
    .filter((tool): tool is WebMcpToolSpec => Boolean(tool));
}

export function toolFillsTable(name: string): boolean {
  return TABLE_FILLING_TOOLS.has(name);
}
