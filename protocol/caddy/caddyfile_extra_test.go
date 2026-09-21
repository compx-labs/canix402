package x402avm

import (
	"testing"

	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
)

func TestUnmarshalCaddyfileExtraTag(t *testing.T) {
	input := `x402 {
		description "canix402 paid DeFi data endpoint"
		mime_type application/json
		facilitator_url https://facilitator.goplausible.xyz

		accept {
			pay_to REPLACE_WITH_PAYTO_ADDRESS
			price 0.01
			network algorand-mainnet
			scheme exact
			extra {
				tag x402-global-challenge
			}
		}
	}`

	d := caddyfile.NewTestDispenser(input)
	x := &X402{}
	if err := x.UnmarshalCaddyfile(d); err != nil {
		t.Fatalf("UnmarshalCaddyfile: %v", err)
	}
	if len(x.Accepts) != 1 {
		t.Fatalf("expected 1 accept, got %d", len(x.Accepts))
	}
	tag, ok := x.Accepts[0].Extra["tag"].(string)
	if !ok || tag != "x402-global-challenge" {
		t.Fatalf("expected extra.tag x402-global-challenge, got %#v", x.Accepts[0].Extra)
	}
}

func TestUnmarshalCaddyfileAlgorandThenBase(t *testing.T) {
	input := `x402 {
		accept {
			pay_to ALGOADDR
			price 0.01
			network algorand-mainnet
			scheme exact
			extra {
				tag x402-global-challenge
			}
		}
		accept {
			pay_to 0x1111111111111111111111111111111111111111
			price 0.01
			network base
			scheme exact
			extra {
				tag x402-global-challenge
			}
		}
	}`

	d := caddyfile.NewTestDispenser(input)
	x := &X402{}
	if err := x.UnmarshalCaddyfile(d); err != nil {
		t.Fatalf("UnmarshalCaddyfile: %v", err)
	}
	if len(x.Accepts) != 2 {
		t.Fatalf("expected 2 accepts, got %d", len(x.Accepts))
	}
	if x.Accepts[0].Network != "algorand-mainnet" || x.Accepts[1].Network != "base" {
		t.Fatalf("expected Algorand then Base, got %#v", x.Accepts)
	}
	for i, accept := range x.Accepts {
		tag, ok := accept.Extra["tag"].(string)
		if !ok || tag != "x402-global-challenge" {
			t.Fatalf("accept %d missing extra.tag, got %#v", i, accept.Extra)
		}
	}
}

func TestDropUnconfiguredBaseAccept(t *testing.T) {
	x := &X402{Accepts: []PaymentOption{
		{PayTo: "ALGOADDR", Price: "0.01", Network: "algorand-mainnet", Scheme: "exact"},
		{PayTo: "REPLACE_WITH_BASE_PAYTO_ADDRESS", Price: "0.01", Network: "base", Scheme: "exact"},
		{PayTo: "  ", Price: "0.01", Network: "base", Scheme: "exact"},
	}}
	if dropped := x.dropUnconfiguredAccepts(); dropped != 2 {
		t.Fatalf("expected 2 dropped, got %d", dropped)
	}
	if len(x.Accepts) != 1 || x.Accepts[0].Network != "algorand-mainnet" {
		t.Fatalf("expected Algorand accept to remain, got %#v", x.Accepts)
	}
}
