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
