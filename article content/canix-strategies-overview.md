# Canix Strategies: packaged DeFi playbooks anyone can use

Strategies turn Canix from a discovery engine into a marketplace for ready-made portfolio playbooks.

Instead of piecing together individual opportunities one by one, a creator publishes a **strategy**: a named, weighted mix of verified DeFi actions across Algorand venues. Agents and operators can browse those playbooks, pick one that fits their goals, and ask Canix to turn it into executable steps for a given amount of capital.

## What a strategy is

A strategy is a recipe, not a black box.

- Creators define how capital should be split across legs (for example: 40% into one yield position, 35% into another, 25% into a third).
- Each leg points at a **verified execution shape** Canix already understands — so the composition is built from actions that can actually be quoted and run.
- Strategies are published with a name, description, and tags so people and agents can find them in the marketplace.

When someone wants to follow a strategy, Canix **compiles** it: it scales the weights to the capital they want to allocate and returns unsigned transaction groups ready for local review and signing. Canix never takes custody of funds.

## What it unlocks

**For creators**

- Ship a reusable portfolio idea once and let others run it.
- Ownership is represented by a tradable strategy NFT on Algorand.
- When others compile (use) your strategy, **half of that access fee** is paid out weekly to whoever currently holds the NFT — so useful strategies can earn as they get used.

**For agents and operators**

- Skip reinventing allocation logic for every run.
- Browse published strategies, inspect the composition, and execute a known playbook with a capital amount.
- Stay in control: unsigned quotes only; signing and submission stay with the user or bot.

**For the ecosystem**

- A shared layer where third parties author strategies and Canix handles validation, discovery, compilation, and fee sharing.
- Canix does not author the strategies — it makes other people’s good ones discoverable and runnable.

Creators can revise a strategy’s composition over time (with a cooldown), so playbooks can evolve without throwing away their identity or marketplace presence.

## Looking ahead: Signals

Strategies already make ownership and usage economically linked through the strategy NFT. A natural next step is **Signals** — social tokens tied to reputation, following, or shared conviction around particular strategies and creators.

Signals are still future-facing, but the direction is clear: give communities a way to rally around the people and playbooks they trust, beyond a single compile fee. Strategies are the product layer that makes that kind of social coordination worth building on.
