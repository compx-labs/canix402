#!/usr/bin/env bash
# Idempotent environment setup for the canix402 monorepo.
#
# Runs on the default Cloud Agent base image (Node 22 preinstalled) and prepares
# everything the repo needs:
#   1. Go 1.25 toolchain  (protocol/caddy/go.mod requires `go 1.25.0`)
#   2. xcaddy             (builds the Caddy binary bundled with the x402 plugin)
#   3. npm workspace deps (protocol / website / mcp / mcp-worker / x402-client)
#   4. Caddy x402 binary  (protocol/.bin/caddy-x402, used by the gateway + e2e tests)
#
# Safe to re-run: existing toolchains are detected and skipped.
set -euo pipefail

GO_VERSION="1.25.0"
XCADDY_VERSION="v0.4.6"

# --- Go 1.25 -----------------------------------------------------------------
# Install into /usr/local/go and expose via /usr/local/bin symlinks, which are
# already on the default PATH ahead of any older system Go, so both this script
# and interactive agent shells resolve the right version.
current_go="$(/usr/local/go/bin/go version 2>/dev/null | awk '{print $3}' || true)"
if [ "$current_go" != "go${GO_VERSION}" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o "$tmp/go.tar.gz"
  sudo rm -rf /usr/local/go
  sudo tar -C /usr/local -xzf "$tmp/go.tar.gz"
  rm -rf "$tmp"
fi
sudo ln -sf /usr/local/go/bin/go /usr/local/bin/go
sudo ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
export PATH="/usr/local/go/bin:${PATH}"

# --- xcaddy ------------------------------------------------------------------
if ! command -v xcaddy >/dev/null 2>&1; then
  go install "github.com/caddyserver/xcaddy/cmd/xcaddy@${XCADDY_VERSION}"
  sudo ln -sf "$(go env GOPATH)/bin/xcaddy" /usr/local/bin/xcaddy
fi

# --- JS workspace dependencies ----------------------------------------------
npm ci

# --- Caddy x402 gateway binary ----------------------------------------------
# xcaddy compiles the Go module in protocol/caddy into protocol/.bin/caddy-x402.
npm run build:caddy-x402
