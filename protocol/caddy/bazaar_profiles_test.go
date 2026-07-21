package x402avm

import (
	"encoding/json"
	"testing"

	"github.com/GoPlausible/x402-avm/go/extensions/bazaar"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
)

func TestUnmarshalCaddyfileBazaarProfile(t *testing.T) {
	input := `x402 {
		description "canix402 paid DeFi data endpoint"
		mime_type application/json
		facilitator_url https://facilitator.goplausible.xyz
		bazaar_profile opportunities

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
	if x.BazaarProfile != "opportunities" {
		t.Fatalf("expected bazaar_profile opportunities, got %q", x.BazaarProfile)
	}
}

func TestBuildBazaarExtensionAllProfiles(t *testing.T) {
	for _, profile := range knownBazaarProfiles() {
		ext, err := buildBazaarExtension(profile)
		if err != nil {
			t.Fatalf("profile %q: %v", profile, err)
		}
		if ext.Schema == nil {
			t.Fatalf("profile %q: expected schema", profile)
		}
		if ext.Info.Input == nil {
			t.Fatalf("profile %q: expected info.input", profile)
		}
		// Ensure the extension JSON-marshals (goes into PAYMENT-REQUIRED).
		raw, err := json.Marshal(map[string]interface{}{
			bazaar.BAZAAR.Key(): ext,
		})
		if err != nil {
			t.Fatalf("profile %q marshal: %v", profile, err)
		}
		if len(raw) > 8_000 {
			t.Fatalf("profile %q extension JSON too large: %d bytes", profile, len(raw))
		}
	}
}

func TestBuildBazaarExtensionUnknown(t *testing.T) {
	_, err := buildBazaarExtension("not-a-real-profile")
	if err == nil {
		t.Fatal("expected error for unknown profile")
	}
}
