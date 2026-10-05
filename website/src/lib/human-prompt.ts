const DEFAULT_MCP_URL = "https://canix402-mcp.compx.io/mcp";

/** Copy-paste setup prompt. The agent creates the wallet; the person funds the address. */
export function humanSetupPrompt(mcpUrl = DEFAULT_MCP_URL): string {
  return [
    "Get me Canix-ready. Canix402 is the paid DeFi yield API at https://canix402.compx.io. You own the wallet. Work through this in order, and wait for me only when I have to send funds or connect a server.",
    "",
    `1. Check that the Canix MCP server is connected: ${mcpUrl} (Streamable HTTP). If it is not, show me this config and stop until I say it is connected:`,
    "",
    "{",
    '  "mcpServers": {',
    '    "canix402": {',
    `      "url": "${mcpUrl}"`,
    "    }",
    "  }",
    "}",
    "",
    "That server is walletless. Never put a seed phrase, private key, or mnemonic in its config, and never ask me for mine.",
    "",
    "2. Create a new Algorand account yourself. This wallet is yours to operate, separate from any wallet I already have. Use an Algorand MCP account tool you already have (create or generate account). If you do not have one, create the account with the Algorand APIs or algosdk generateAccount. Prefer a tool that stores the key and returns the address only. Show me the address. Do not paste the mnemonic or private key into this chat, and do not ask me to create the wallet in Pera or any other app.",
    "",
    "3. Tell me what to send to that address before I do it. Read Canix discovery and quote the live USDC prices. Expect a little ALGO for fees, and Algorand USDC (ASA 31566704). A research call is usually about 0.01 USDC. A 4-hour session is about 0.25 USDC. Algorand alone is enough. Mention Base only if I ask. Then wait while I send it.",
    "",
    "4. When the address is funded, use Canix and recommend where that wallet should put its assets. You sign and submit with the wallet you created, using your Algorand MCP tools or the Algorand APIs. If a Canix tool returns a payment requirement or an unsigned transaction group, pay and sign it yourself. Do not hand signing back to me.",
    "",
    "5. Stop when three things are true: Canix MCP is connected, you created the agent address and it is funded, and you have made one Canix recommendation. Then say I am Canix-ready and list the address plus those three."
  ].join("\n");
}
