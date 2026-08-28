package x402avm

import (
	"encoding/json"
	"os"
	"regexp"
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

func TestCaddyfileBazaarProfilesAreRegistered(t *testing.T) {
	raw, err := os.ReadFile("Caddyfile")
	if err != nil {
		t.Fatalf("read Caddyfile: %v", err)
	}
	matches := regexp.MustCompile(`bazaar_profile\s+(\S+)`).FindAllStringSubmatch(string(raw), -1)
	if len(matches) == 0 {
		t.Fatal("expected bazaar_profile entries in Caddyfile")
	}
	known := make(map[string]struct{}, len(knownBazaarProfiles()))
	for _, profile := range knownBazaarProfiles() {
		known[profile] = struct{}{}
	}
	for _, match := range matches {
		name := match[1]
		if _, ok := known[name]; !ok {
			t.Errorf("Caddyfile bazaar_profile %q is not registered", name)
		}
	}
}
