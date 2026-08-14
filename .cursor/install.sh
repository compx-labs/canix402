#!/usr/bin/env bash
# Idempotent dependency refresh for the canix402 monorepo.
# Stable toolchains (Node, Go, xcaddy) come from .cursor/Dockerfile; this script
# only prepares source-derived state and can be re-run safely.
set -euo pipefail

# Install/refresh all npm workspace dependencies from the lockfile.
npm ci

# Build the Caddy binary bundled with the x402 AVM plugin. xcaddy compiles the
# Go module in protocol/caddy and emits protocol/.bin/caddy-x402, which the
# gateway (npm run dev:caddy) and the e2e test harness both depend on.
npm run build:caddy-x402
