package x402avm

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	x402http "github.com/GoPlausible/x402-avm/go/http"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
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

func TestEnrichPaymentRequiredExtraTagsBothAccepts(t *testing.T) {
	payload := map[string]any{
		"x402Version": 2,
		"accepts": []any{
			map[string]any{
				"scheme":  "exact",
				"network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
			},
			map[string]any{
				"scheme":  "exact",
				"network": "eip155:8453",
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
	tag := map[string]interface{}{"tag": "x402-global-challenge"}
	enriched := enrichPaymentRequiredExtra(resp, []PaymentOption{
		{Network: "algorand-mainnet", Extra: tag},
		{Network: "base", Extra: tag},
	})

	decoded, err := base64.StdEncoding.DecodeString(enriched.Headers["PAYMENT-REQUIRED"])
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(decoded, &out); err != nil {
		t.Fatal(err)
	}
	accepts := out["accepts"].([]any)
	if len(accepts) != 2 {
		t.Fatalf("expected 2 accepts, got %d", len(accepts))
	}
	networks := []string{
		accepts[0].(map[string]any)["network"].(string),
		accepts[1].(map[string]any)["network"].(string),
	}
	if networks[0] != "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=" || networks[1] != "eip155:8453" {
		t.Fatalf("expected Algorand then Base, got %#v", networks)
	}
	for i, item := range accepts {
		extra := item.(map[string]any)["extra"].(map[string]any)
		if extra["tag"] != "x402-global-challenge" {
			t.Fatalf("accept %d missing tag, got %#v", i, extra)
		}
	}
}

func TestTruncateHeader(t *testing.T) {
	short := "ok"
	if got := truncateHeader(short); got != short {
		t.Fatalf("expected short header unchanged, got %q", got)
	}
	long := strings.Repeat("a", x402HeaderMaxLen+10)
	got := truncateHeader(long)
	if len(got) != x402HeaderMaxLen {
		t.Fatalf("expected len %d, got %d", x402HeaderMaxLen, len(got))
	}
}

func TestRequestTelemetryFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/opportunities", nil)
	req.Header.Set("User-Agent", "BrownieBot/1.0")
	req.Header.Set("Referer", "https://agents.example/run")

	fields := requestTelemetryFields(req)
	byKey := map[string]string{}
	for _, f := range fields {
		if f.Type == zapcore.StringType {
			byKey[f.Key] = f.String
		}
	}
	if byKey["path"] != "/opportunities" {
		t.Fatalf("path: %#v", byKey["path"])
	}
	if byKey["method"] != http.MethodGet {
		t.Fatalf("method: %#v", byKey["method"])
	}
	if byKey["user_agent"] != "BrownieBot/1.0" {
		t.Fatalf("user_agent: %#v", byKey["user_agent"])
	}
	if byKey["referer"] != "https://agents.example/run" {
		t.Fatalf("referer: %#v", byKey["referer"])
	}
}

func TestLogX402EventEmitsStructuredFields(t *testing.T) {
	core, logs := observer.New(zapcore.InfoLevel)
	logger := zap.New(core)
	x := &X402{logger: logger}

	req := httptest.NewRequest(http.MethodPost, "/execution/quotes", nil)
	req.Header.Set("User-Agent", "TestAgent/2.0")
	req.Header.Set("Referrer", "https://ref.example")

	x.logX402Event(zap.InfoLevel, eventX402PaymentRequired, req, zap.String("reason", "preflight"))

	entries := logs.All()
	if len(entries) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(entries))
	}
	ctx := entries[0].ContextMap()
	if ctx["event"] != eventX402PaymentRequired {
		t.Fatalf("event: %#v", ctx["event"])
	}
	if ctx["path"] != "/execution/quotes" {
		t.Fatalf("path: %#v", ctx["path"])
	}
	if ctx["user_agent"] != "TestAgent/2.0" {
		t.Fatalf("user_agent: %#v", ctx["user_agent"])
	}
	if ctx["referer"] != "https://ref.example" {
		t.Fatalf("referer: %#v", ctx["referer"])
	}
	if ctx["reason"] != "preflight" {
		t.Fatalf("reason: %#v", ctx["reason"])
	}
}

