import { getWebMcpTool, WEBMCP_TOOLS } from "./catalog";
import { sessionBucketForPath } from "./human-execute";
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

export type HumanToolGroupId = "opportunities" | "wallet" | "plans";

export interface HumanToolEntry {
  name: string;
  title: string;
  blurb: string;
  group: HumanToolGroupId;
}

export const HUMAN_TOOL_GROUPS: Array<{ id: HumanToolGroupId; label: string }> = [
  { id: "opportunities", label: "Opportunities" },
  { id: "wallet", label: "My wallet" },
  { id: "plans", label: "Plans and quotes" }
];

export const HUMAN_TOOL_CATALOG: HumanToolEntry[] = [
  {
    name: "canix_search_opportunities",
    title: "Search opportunities",
    blurb: "Filter by protocol, type, APY, TVL, chain, or assets.",
    group: "opportunities"
  },
  {
    name: "canix_list_opportunities",
    title: "Top opportunities",
    blurb: "Ranked by risk, then APY.",
    group: "opportunities"
  },
  {
    name: "canix_get_personalized_opportunities",
    title: "Personalised for my wallet",
    blurb: "Opportunities matched to assets this wallet holds.",
    group: "opportunities"
  },
  {
    name: "canix_get_protocol_opportunities",
    title: "Protocol opportunities",
    blurb: "Everything listed for one protocol.",
    group: "opportunities"
  },
  {
    name: "canix_get_opportunity_history",
    title: "Opportunity history",
    blurb: "APY and TVL history for one opportunity.",
    group: "opportunities"
  },
  {
    name: "canix_get_positions",
    title: "Positions",
    blurb: "DeFi positions held by a wallet.",
    group: "wallet"
  },
  {
    name: "canix_list_claimable",
    title: "Claimable rewards",
    blurb: "Rewards that are ready to claim.",
    group: "wallet"
  },
  {
    name: "canix_check_eligibility",
    title: "Check eligibility",
    blurb: "Whether a wallet can enter the selected opportunities.",
    group: "wallet"
  },
  {
    name: "canix_get_plan",
    title: "Build a plan",
    blurb: "Turn a budget into an unsigned allocation plan.",
    group: "plans"
  },
  {
    name: "canix_get_execution_quote",
    title: "Execution quote",
    blurb: "Unsigned transactions to enter or claim.",
    group: "plans"
  },
  {
    name: "canix_get_quote",
    title: "Swap quote",
    blurb: "Best route and expected output for a swap.",
    group: "plans"
  },
  {
    name: "canix_swap",
    title: "Swap transactions",
    blurb: "Unsigned swap transactions for a quote.",
    group: "plans"
  },
  {
    name: "canix_optin",
    title: "Opt-in transactions",
    blurb: "Opt-ins a swap still needs before it can be signed.",
    group: "plans"
  }
];

export function humanToolsInGroup(groupId: HumanToolGroupId): HumanToolEntry[] {
  return HUMAN_TOOL_CATALOG.filter((entry) => entry.group === groupId);
}

export function advancedToolGroups(): WebMcpToolGroup[] {
  const human = new Set(HUMAN_TOOL_CATALOG.map((entry) => entry.name));
  return WEBMCP_TOOL_GROUPS.map((group) => ({
    ...group,
    names: group.names.filter((name) => !human.has(name))
  })).filter((group) => group.names.length > 0);
}

export function toolPriceLabel(name: string): string {
  const tool = getWebMcpTool(name);
  if (!tool || tool.access === "free" || !tool.fallbackPriceUsdc) {
    return "Free";
  }
  return `${tool.fallbackPriceUsdc} USDC`;
}

export function sessionUseLabel(name: string): string | null {
  const tool = getWebMcpTool(name);
  if (!tool || tool.access !== "paid" || !tool.allowSessionReceipt) {
    return null;
  }
  const bucket = sessionBucketForPath(tool.http.path);
  if (bucket === "research") {
    return "Uses 1 research call";
  }
  if (bucket === "quotes") {
    return "Uses 1 quote";
  }
  return null;
}
