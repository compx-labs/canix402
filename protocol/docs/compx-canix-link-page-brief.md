# CompX Site Brief: Canix402 Link Page

## Goal

Add a short landing/link page on the main CompX site that introduces Canix402 and sends visitors to the live Canix402 documentation site.

This page should be lightweight: a brief hero, one short description section, and clear links. It is not a data explorer and should not expose free opportunity data.

## Suggested Route

Use whichever route best fits the CompX site conventions:

- `/canix`
- `/canix402`

Preferred public link target from this page:

- `https://canix402.compx.io`

## Product Summary

Canix402 is an x402-paid Algorand DeFi opportunities API. It gives agents and builders a single machine-readable data rail for normalized yield opportunities across supported Algorand DeFi protocols.

The API is designed for agent integrations: discover endpoints through OpenAPI and `/discovery`, preflight paid routes with HTTP `402 Payment Required`, pay in Algorand or Base USDC through x402, then retry for normalized APY/APR data.

## Suggested Hero Copy

Eyebrow:

```text
x402 paid Algorand DeFi data
```

Headline:

```text
Canix402 helps agents find Algorand DeFi opportunities
```

Short hero text:

```text
Canix402 is a paid API for normalized Algorand DeFi opportunity data. Agents can discover endpoints, pay per request with x402, and fetch ranked APY/APR opportunities across supported protocols.
```

Primary CTA:

```text
Explore Canix402
```

Primary CTA URL:

```text
https://canix402.compx.io
```

Secondary CTA:

```text
View API discovery
```

Secondary CTA URL:

```text
https://canix402-api.compx.io/discovery
```

## Short Description Section

Suggested heading:

```text
What is Canix402?
```

Suggested copy:

```text
Canix402 turns Algorand DeFi opportunity data into a stable, agent-ready API. Instead of scraping individual protocol sites, builders can use one discoverable interface for ranked yield data, protocol-specific opportunities, filtered searches, and wallet-personalized recommendations.

Access is handled with x402 payments at the API gateway. Paid endpoints return HTTP 402 with payment requirements, allowing compatible clients and agents to pay in USDC and continue without accounts or API keys.
```

## Small Feature Bullets

Use three or four max:

- Normalized APY/APR opportunity data for Algorand DeFi.
- Machine-readable OpenAPI and discovery metadata for agents.
- Pay-per-request access using x402 and Algorand or Base USDC.
- Wallet-personalized yield recommendations for supported assets.

## Useful Links

- Canix402 docs: `https://canix402.compx.io`
- Quickstart: `https://canix402.compx.io/quickstart`
- Endpoints: `https://canix402.compx.io/endpoints`
- LLM docs: `https://canix402.compx.io/llms.txt`
- API discovery: `https://canix402-api.compx.io/discovery`
- OpenAPI: `https://canix402-api.compx.io/openapi.json`

## SEO Metadata

Title:

```text
Canix402 | Algorand DeFi Data for Agents
```

Description:

```text
Canix402 is an x402-paid API for normalized Algorand DeFi opportunity data, built for agents and developers using OpenAPI, discovery metadata, and pay-per-request USDC access.
```

Keywords:

```text
Canix402, CompX, Algorand DeFi, x402, DeFi API, agent APIs, APY, yield opportunities
```

## Design Notes

- Keep this visually consistent with the main CompX site.
- Make it clear this is an API/docs entry point, not a free public yield dashboard.
- Do not include live yield tables or unauthenticated opportunity results.
- Include the Canix402 link somewhere prominent in the main CompX navigation or footer if appropriate.
- If the CompX site has product cards, Canix402 can be presented as a developer/agent product card.

## Acceptance Criteria

- A public CompX page exists for Canix402.
- The page has a concise hero, short explanation, and clear CTA to `https://canix402.compx.io`.
- The page links to API discovery or OpenAPI for agents/builders.
- Copy does not imply free unauthenticated access to paid opportunity data.
- The page is linked from an appropriate CompX navigation, footer, or product section.
