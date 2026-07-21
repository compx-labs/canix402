package x402avm

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	x402http "github.com/GoPlausible/x402-avm/go/http"
)

func TestEnrichPaymentRequiredExtraMergesTag(t *testing.T) {
	payload := map[string]any{
		"x402Version": 2,
		"accepts": []any{
			map[string]any{
				"scheme": "exact",
				"extra": map[string]any{
					"feePayer": "FEEPAYER",
				},
			},
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	resp := &x402http.HTTPResponseInstructions{
		Status: 402,
		Headers: map[string]string{
			"PAYMENT-REQUIRED": base64.StdEncoding.EncodeToString(raw),
		},
	}

	enriched := enrichPaymentRequiredExtra(resp, []PaymentOption{
		{Extra: map[string]interface{}{"tag": "x402-global-challenge"}},
	})

	encoded := enriched.Headers["PAYMENT-REQUIRED"]
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(decoded, &out); err != nil {
		t.Fatal(err)
	}
	accepts := out["accepts"].([]any)
	extra := accepts[0].(map[string]any)["extra"].(map[string]any)
	if extra["feePayer"] != "FEEPAYER" {
		t.Fatalf("expected feePayer preserved, got %#v", extra)
	}
	if extra["tag"] != "x402-global-challenge" {
		t.Fatalf("expected tag, got %#v", extra)
	}
}
