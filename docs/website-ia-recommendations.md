# Canix402 website: simpler IA and a human 5-minute start

Combined plan from the live-site review (5 October 2026) and a second pass of the same pages. Source of truth for the next website edit.

**Brand:** CompX / Canix402 on the marketing surface. Mallow and the other venues stay in the catalog, the protocols page, and release notes as coverage.

## Decision

Five items in the header. The reference pages stay at their current URLs and move under a Docs menu. The human quick start is one copy-paste prompt. It appears twice: on the homepage, directly under the hero, and at `/quickstart#human`.

| Header | URL | What it is |
| --- | --- | --- |
| Home | `/` | Pitch, then the prompt to paste into an agent |
| Get started | `/quickstart` | The same prompt (`#human`) and the existing agent/HTTP guide (`#agent`) |
| Live | `/webmcp` | The in-browser product |
| Endpoints | `/endpoints` | The discovery-backed catalog (~37 routes) |
| Docs | menu | MCP, Payments, Examples, FAQ, Releases |

Footer: User Agents, Transactions, Protocols, Terms, `llms.txt`, Support.

That takes the header from eleven equal links to five. Page count stays the same. The busy feeling is the flat directory in the top bar, so the first cut is the bar, not a merge of the long reference pages into one new document.

## Why this shape

Getting connected is currently told four times: `/quickstart`, `/mcp`, `/x402`, and `/examples`. Live, the API catalog, a one-bot showcase, a payment feed, a protocol list, a changelog, and an FAQ sit beside those as peers. A person who wants to fund an agent has no obvious start, and the start the homepage does offer (Start quickstart) opens on “Use the Caddy gateway URL as your base URL.”

The homepage already has a “For humans” card. It describes browsing yields on the web, which is Live. Live assumes a wallet and a session. The missing piece is a prompt the person pastes into the agent. The agent creates the Algorand wallet, asks for a first deposit, and makes the first Canix call.

Published links have to keep resolving with no redirect project in this pass:

- `https://canix402.compx.io/x402` is `docsUrl` in the API manifest and OpenAPI.
- `https://canix402.compx.io/x402#mcp` is the MCP install URL.
- `/quickstart`, `/endpoints`, and `/llms.txt` are already cited outside the site.
- `robots.txt` points agents at `llms.txt`, `llms-full.txt`, and the API host. Leave that alone.

So MCP, Payments, Examples, FAQ, and Releases stay as real pages. They leave the header. `/x402#mcp` keeps landing on the MCP section because `/x402` is still `/x402`.

Examples stays a page under Docs. It is about 6,600 words of copy-paste samples. OpenAPI and `llms-full.txt` serve agents; this page is the one a person can read. Splitting it would add pages.

Protocols, User Agents, and Transactions stay as URLs and move to the footer. They are proof and coverage. Brownie’s portfolio and the pay-to USDC feed are different data, so they stay two pages. Partners can still link `/protocols`.

## Where the human section goes

**On the homepage, immediately under the hero.** That replaces the thin “For humans” card and sits above the API wall, which is the part to remove. The section is a prompt in a copy box. The person’s job is to paste it into Cursor, Claude, or whichever agent they use.

**The same prompt on Get started** at `/quickstart#human`. One text, two places. The page keeps its URL and gains the title “Get started.” The current MCP-or-curl quickstart moves under `/quickstart#agent` for someone wiring a client by hand.

Live stays its own page, linked beside the prompt for someone who would rather click through in the browser.

No `/human`, `/start`, `/get-started`, or `/live` in this pass. Those paths 404 today. Aliases can wait until the labels have settled.

### The five minutes

**Title:** Get your agent a wallet and be Canix-ready in 5 minutes

**Lead:** Copy this into your agent. It creates the Algorand wallet itself, tells you the address to fund, and comes back with one yield recommendation. You never create a wallet and you never paste a seed phrase.

The box has a **Copy prompt** button. Homepage and `/quickstart#human` use this text verbatim:

```text
Get me Canix-ready. Canix402 is the paid DeFi yield API at https://canix402.compx.io. You own the wallet. Work through this in order, and wait for me only when I have to send funds or connect a server.

1. Check that the Canix MCP server is connected: https://canix402-mcp.compx.io/mcp (Streamable HTTP). If it is not, show me this config and stop until I say it is connected:

{
  "mcpServers": {
    "canix402": {
      "url": "https://canix402-mcp.compx.io/mcp"
    }
  }
}

That server is walletless. Never put a seed phrase, private key, or mnemonic in its config, and never ask me for mine.

2. Create a new Algorand account yourself. This wallet is yours to operate, separate from any wallet I already have. Use an Algorand MCP account tool you already have (create or generate account). If you do not have one, create the account with the Algorand APIs or algosdk generateAccount. Prefer a tool that stores the key and returns the address only. Show me the address. Do not paste the mnemonic or private key into this chat, and do not ask me to create the wallet in Pera or any other app.

3. Tell me what to send to that address before I do it. Read Canix discovery and quote the live USDC prices. Expect a little ALGO for fees, and Algorand USDC (ASA 31566704). A research call is usually about 0.01 USDC. A 4-hour session is about 0.25 USDC. Algorand alone is enough. Mention Base only if I ask. Then wait while I send it.

4. When the address is funded, use Canix and recommend where that wallet should put its assets. You sign and submit with the wallet you created, using your Algorand MCP tools or the Algorand APIs. If a Canix tool returns a payment requirement or an unsigned transaction group, pay and sign it yourself. Do not hand signing back to me.

5. Stop when three things are true: Canix MCP is connected, you created the agent address and it is funded, and you have made one Canix recommendation. Then say I am Canix-ready and list the address plus those three.
```

Hero buttons: **Copy prompt** (copies that text, or scrolls to the box on the homepage) and **Open Live** (`/webmcp`). Endpoints stays in the header, so the hero does not need a third button.

`#agent` stays below the prompt on Get started: today’s quickstart, for a builder who wants the curl path. MCP JSON, then discovery, OpenAPI, free probes, and the 402 retry, with links into Docs for the tool list, payment envelopes, and sample payloads.

## Homepage after the cut

1. **Hero.** One sentence: one paid API for normalized DeFi yield on Algorand and Base, for an agent or in the browser. Two buttons: Copy prompt, Open Live.
2. **Human quick start.** The copy-paste prompt above, and nothing else in that block.
3. **For agents.** One MCP snippet and a link to `/quickstart#agent`.
4. **What Canix does.** One short block: normalized yield and unsigned execution across Algorand and Base, paid in USDC, signed by the caller.
5. **Proof.** One line for Brownie Bot (`/user-agents`) and one line for recent USDC payments (`/transactions`).
6. **Protocols.** Logo row only, linking to `/protocols` and `/endpoints`. The per-protocol notes stay on `/protocols`.
7. **Latest release.** One line in this lower band, linking to `/release-notes`.
8. **Footer.**

Remove from the homepage: the five signal pills, the release link inside the hero, the four audience cards, the six endpoint cards, the without/with essay, the five capability cards, the sample case study (`12.5%` Tinyman), the four-step discovery flow, the thirteen “normalized via paid API routes” blurbs, and the four-button closing band. The closing band can be the two hero buttons again if the page needs an end cap.

## What happens to each current page

| Page | What changes |
| --- | --- |
| `/` | Slim, and add the copy-paste prompt under the hero. |
| `/quickstart` | Retitle “Get started.” The prompt at `#human`, current agent steps at `#agent`. URL unchanged. |
| `/webmcp` | Unchanged product. Label **Live** in the header, footer, `<title>`, and H1. Path stays `/webmcp`. |
| `/endpoints` | Unchanged. Stays in the header. The homepage stops previewing it. |
| `/mcp` | Unchanged page. Docs menu only. |
| `/x402` | Unchanged page, including `#mcp`. Docs menu label: Payments. |
| `/examples` | Unchanged page. Docs menu only. |
| `/faq` | Unchanged page. Docs menu. The prompt already covers the human questions (the agent creates the wallet, one chain, no mnemonic in the chat, live prices). |
| `/release-notes` | Unchanged page. Docs menu and the one homepage line. |
| `/user-agents` | Unchanged page. Footer, plus the homepage proof line. |
| `/transactions` | Unchanged page. Footer, plus the homepage proof line. |
| `/protocols` | Unchanged page. Footer, plus the homepage logo row. |
| `/terms` | Footer, as now. |
| `/llms.txt`, `/llms-full.txt` | Keep. Update any nav labels they echo. Paths they link can stay. |

Header and footer today disagree on the Live page (`Canix402 Live` vs `WebMCP` vs hero “Try it now”). After this, every human-facing label for `/webmcp` is **Live**.

## Order of work

1. **Get started.** Put the prompt at `#human` on `/quickstart`, and move the current curl guide to `#agent`.
2. **Homepage.** Insert the same prompt under the hero, with a Copy button. Cut the sections listed above. Leave two buttons: Copy prompt, Open Live.
3. **Nav and footer.** Header becomes Home, Get started, Live, Endpoints, Docs. Move User Agents, Transactions, and Protocols to the footer. Rename Live everywhere.
4. **`llms.txt`.** Refresh labels so agents still find MCP, payments, and examples under the new names.

No redirects in this pass. A later alias (`/get-started`, `/live`) is optional and only worth it if something outside the site needs the new word in the path.

## Done when

A person can land on `/`, copy one prompt into their agent, and let the agent finish the setup. The menu itself fits on one line and no longer lists the changelog, the payment spec, the sample book, or the Brownie showcase as equal starts.
