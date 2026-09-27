package x402avm

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
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

func TestBazaarExamplesUseRealWallets(t *testing.T) {
	positionProfiles := map[string]struct{}{
		"positions":           {},
		"positions_claimable": {},
	}
	brownieProfiles := []string{
		"opportunities_personalized",
		"eligibility",
		"plans",
		"plans_rebalance",
		"execution_compose",
		"execution_simulate",
		"watch",
	}
	const zeroAddress = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ"

	for _, profile := range knownBazaarProfiles() {
		ext := mustBazaarExtension(t, profile)
		encoded := mustJSON(t, ext.Info.Input)
		if strings.Contains(encoded, zeroAddress) {
			t.Errorf("%s: still advertises the zero address", profile)
		}
		_, isPosition := positionProfiles[profile]
		if isPosition {
			if !strings.Contains(encoded, nfAlgoAddress) {
				t.Errorf("%s: expected nf.algo address", profile)
			}
			if strings.Contains(encoded, brownieBotAddress) {
				t.Errorf("%s: position examples must not use the Brownie showcase wallet", profile)
			}
			continue
		}
		if strings.Contains(encoded, nfAlgoAddress) {
			t.Errorf("%s: nf.algo is only for position profiles", profile)
		}
	}

	for _, profile := range brownieProfiles {
		ext := mustBazaarExtension(t, profile)
		encoded := mustJSON(t, ext.Info.Input)
		if !strings.Contains(encoded, brownieBotAddress) {
			t.Errorf("%s: expected Brownie address", profile)
		}
	}

	quotes := mustBazaarExtension(t, "execution_quotes")
	body := quotes.Info.Input.(bazaar.BodyInput).Body.(map[string]interface{})
	items := body["quotes"].([]interface{})
	first := items[0].(map[string]interface{})
	if first["shapeKey"] != "mainnet:tinyman:v2:addLiquidity:flexible" {
		t.Fatalf("execution_quotes shapeKey = %#v", first["shapeKey"])
	}
	input := first["input"].(map[string]interface{})
	if input["userAddress"] != brownieBotAddress {
		t.Fatalf("execution_quotes userAddress = %#v", input["userAddress"])
	}

	swap := mustBazaarExtension(t, "haystack_swap")
	swapBody := swap.Info.Input.(bazaar.BodyInput).Body.(map[string]interface{})
	for _, key := range []string{"address", "quote", "slippage"} {
		if _, ok := swapBody[key]; !ok {
			t.Errorf("haystack_swap example missing %s", key)
		}
	}
	if swapBody["address"] != brownieBotAddress {
		t.Fatalf("haystack_swap address = %#v", swapBody["address"])
	}
}

func mustBazaarExtension(t *testing.T, profile string) bazaar.DiscoveryExtension {
	t.Helper()
	ext, err := buildBazaarExtension(profile)
	if err != nil {
		t.Fatalf("profile %q: %v", profile, err)
	}
	return ext
}

func mustJSON(t *testing.T, value interface{}) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(raw)
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
