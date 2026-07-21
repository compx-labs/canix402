# Brownie Bot: an open autonomous treasury for Algorand

Brownie Bot is an autonomous community treasury backend for Algorand. Once a day it looks at a wallet’s liquid balances and Canix402 DeFi positions, researches what is available on-chain, asks an AI model for a diversified portfolio plan, checks that plan against hard limits, and — only when you explicitly enable signing — prepares and submits transactions locally.

It is built to run as infrastructure for a community treasury (or any operator wallet), not as a custodial product. Keys stay with the operator. Canix402 never sees the mnemonic.

## What it is

In plain terms, Brownie Bot is a scheduled “portfolio steward”:

1. **Read the book** — liquid balances plus DeFi positions via Canix402.
2. **Research** — personalized and global opportunities on Algorand.
3. **Plan** — ask OpenAI for a diversified allocation given those facts and your policy caps.
4. **Validate** — apply deterministic rules (position and protocol limits, reserves, TVL and freshness floors, and more) so the AI cannot freely spend.
5. **Optionally execute** — fetch unsigned groups from Canix, decode and check them, sign locally, and submit through your own Algod connection.
6. **Report** — send a clear summary to Telegram, or print it in the terminal if Telegram is not configured.

By default, **transaction signing is off**. Dry-run mode still researches and plans (and pays small Canix402 access fees in USDC), but it does not request execution quotes or move funds. That makes it safe to try before you ever flip the execution switch.

Accounting runs separately: periodic snapshots of DeFi value and wallet token totals so the treasury can track how it is doing over time, with or without Spaces cloud storage.

## How it works

Brownie Bot sits on top of **Canix402** (research, positions, and execution quotes) and **OpenAI** (planning). The important split is:

- The model gets market and portfolio context and can propose actions.
- The model does **not** get the mnemonic, payment signatures, local signing, or Algod submission.
- The host injects the treasury address and policy guidance, validates the plan, and only then — if signing is enabled — pays for quotes, verifies every transaction, and signs locally.

Payments for Canix402 tools use x402: the bot builds and signs the exact USDC payment itself, then retries the paid call. Mainnet, USDC, and payment ceilings are treated as invariants rather than loose config, so the bot fails closed when something looks wrong.

You can run it as a one-shot review (`run-once`), on a daily cron, or as a small HTTP service with health and latest-run endpoints. Docker is supported for operators who want a simple deploy path.

## Why it is open source

Brownie Bot is released under the **MIT License** by CompX Labs. Treasury automation that can move real funds should be inspectable.

Open-sourcing it means:

- Operators can audit how research, policy, payments, and signing are wired before trusting a wallet to it.
- Communities can fork the defaults — schedules, concentration caps, reporting, accounting — to match their own risk appetite.
- Builders can reuse the Canix402 + x402 + local-signing pattern instead of starting from scratch.
- Improvements (safer policy checks, better prompts, cleaner ops) can come back upstream through contributions.

The project ships with a quick start, contributing guide, mocked tests that do not spend funds, and CI so others can develop confidently without burning mainnet USDC by accident.

## What we hope others do with it

We hope Brownie Bot becomes a **reference autonomous treasury** for Algorand communities and builders:

- DAOs and community funds that want a daily, policy-bound rebalance loop rather than ad-hoc manual trades.
- Operators who want dry-run visibility first, then gradual enablement of signing when they are ready.
- Developers who want a working example of agent-driven DeFi that keeps keys local and uses Canix402 as the opportunity and execution layer.
- Forks that specialize — different risk policies, different reporting channels, different capital sizes — while sharing the same safe core.

If you run it, harden the policy for your treasury. If you improve it, contribute back. The goal is not a single bot for everyone — it is a transparent starting point others can trust, adapt, and grow.
