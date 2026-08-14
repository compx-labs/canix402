# Cloud Agent base image for the canix402 monorepo.
#
# Provides the stable system toolchains that rarely change:
#   - Node.js 22 (npm workspaces: protocol / website / mcp / mcp-worker / x402-client)
#   - Go 1.25 (protocol/caddy/go.mod requires `go 1.25.0`)
#   - xcaddy (builds the Caddy binary bundled with the x402 AVM plugin)
#
# Source-derived work (npm ci, building the Caddy x402 binary) lives in the
# install script so it tracks the checked-out revision.
#
# node:22-bookworm is Debian bookworm (amd64) and already ships git, curl, and
# build-essential, which xcaddy/go and node-gyp need.
FROM node:22-bookworm

# --- Go toolchain (protocol/caddy requires Go 1.25.0) ---
ARG GO_VERSION=1.25.0
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz \
    && rm -rf /usr/local/go \
    && tar -C /usr/local -xzf /tmp/go.tar.gz \
    && rm /tmp/go.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

# --- xcaddy (builds .bin/caddy-x402 from protocol/caddy during install) ---
RUN GOBIN=/usr/local/bin go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.6

# Run as the unprivileged user that ships with the Node image; Cursor checks out
# the repository into the workspace as this user.
USER node
