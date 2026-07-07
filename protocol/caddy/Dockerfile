# Production Caddy gateway for canix402 (uses caddy/Caddyfile + x402 plugin).
# Build: docker build -t canix402-caddy protocol/caddy

FROM caddy:builder AS builder

WORKDIR /src
COPY go.mod go.sum ./
COPY *.go ./

RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest && \
    xcaddy build \
        --output /usr/bin/caddy \
        --with github.com/algorandecosystem/caddy-x402avm=/src

FROM caddy:latest

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
