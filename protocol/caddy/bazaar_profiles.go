package x402avm

import (
	"fmt"

	"github.com/GoPlausible/x402-avm/go/extensions/bazaar"
)

// buildBazaarExtension returns the SDK bazaar discovery extension for a named profile.
// Profiles stay compact so PAYMENT-REQUIRED headers remain within CDN limits.
func buildBazaarExtension(profile string) (bazaar.DiscoveryExtension, error) {
	switch profile {
	case "opportunities":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodGET,
			map[string]interface{}{},
			bazaar.JSONSchema{
				"properties": map[string]interface{}{},
			},
			"",
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": []interface{}{},
				},
			},
		)

	case "opportunities_search":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodGET,
			map[string]interface{}{
				"limit":    "10",
				"platform": "tinyman",
			},
			bazaar.JSONSchema{
				"properties": map[string]interface{}{
					"limit":           map[string]interface{}{"type": "string"},
					"offset":          map[string]interface{}{"type": "string"},
					"platform":        map[string]interface{}{"type": "string"},
					"type":            map[string]interface{}{"type": "string"},
					"minApy":          map[string]interface{}{"type": "string"},
					"maxApy":          map[string]interface{}{"type": "string"},
					"minTvlUsd":       map[string]interface{}{"type": "string"},
					"includeInactive": map[string]interface{}{"type": "string"},
				},
			},
			"",
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": []interface{}{},
				},
			},
		)

	case "opportunities_personalized":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodGET,
			map[string]interface{}{
				"address": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
			},
			bazaar.JSONSchema{
				"properties": map[string]interface{}{
					"address": map[string]interface{}{"type": "string"},
					"limit":   map[string]interface{}{"type": "string"},
				},
				"required": []string{"address"},
			},
			"",
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": []interface{}{},
				},
			},
		)

	case "eligibility":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"address":        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
				"opportunityIds": []interface{}{"reti-staking-1"},
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"address": map[string]interface{}{"type": "string"},
					"opportunityIds": map[string]interface{}{
						"type":  "array",
						"items": map[string]interface{}{"type": "string"},
					},
					"refresh": map[string]interface{}{"type": "boolean"},
				},
				"required": []string{"address", "opportunityIds"},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": []interface{}{},
				},
			},
		)

	case "plans":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"address": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
				"budget": map[string]interface{}{
					"assetId": 0,
					"amount":  "1000000",
				},
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"address": map[string]interface{}{"type": "string"},
					"budget": map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"assetId": map[string]interface{}{"type": "number"},
							"amount":  map[string]interface{}{"type": "string"},
						},
						"required": []string{"assetId", "amount"},
					},
					"constraints": map[string]interface{}{"type": "object"},
					"opportunityIds": map[string]interface{}{
						"type":  "array",
						"items": map[string]interface{}{"type": "string"},
					},
					"refresh": map[string]interface{}{"type": "boolean"},
				},
				"required": []string{"address", "budget"},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": map[string]interface{}{
						"allocations": []interface{}{},
					},
				},
			},
		)

	case "policy_validate":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"policy": map[string]interface{}{
					"schemaVersion": "1.0.0",
					"noNewBorrows":  true,
				},
				"quotes": []interface{}{
					map[string]interface{}{
						"shapeKey": "mainnet:reti:v1:stake:algo",
						"protocol": "reti",
					},
				},
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"policy":               map[string]interface{}{"type": "object"},
					"plan":                 map[string]interface{}{"type": "object"},
					"quotes":               map[string]interface{}{"type": "array"},
					"walletAlgoMicroAlgos": map[string]interface{}{"type": "string"},
					"evaluatedAt":          map[string]interface{}{"type": "string"},
				},
				"required": []string{"policy"},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": map[string]interface{}{
						"pass":    false,
						"reasons": []interface{}{},
					},
				},
			},
		)

	case "positions":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodGET,
			map[string]interface{}{
				"address": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
			},
			bazaar.JSONSchema{
				"properties": map[string]interface{}{
					"address": map[string]interface{}{"type": "string"},
				},
				"required": []string{"address"},
			},
			"",
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": []interface{}{},
				},
			},
		)

	case "positions_claimable":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodGET,
			map[string]interface{}{
				"address": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
			},
			bazaar.JSONSchema{
				"properties": map[string]interface{}{
					"address": map[string]interface{}{"type": "string"},
				},
				"required": []string{"address"},
			},
			"",
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": []interface{}{},
				},
			},
		)

	case "protocol_opportunities":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodGET,
			map[string]interface{}{},
			bazaar.JSONSchema{
				"properties": map[string]interface{}{},
			},
			"",
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": []interface{}{},
				},
			},
		)

	case "execution_quotes":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"quotes": []interface{}{
					map[string]interface{}{
						"shapeKey": "tinyman-v2:lp:add:flexible",
						"input":    map[string]interface{}{},
					},
				},
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"quotes": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "object",
							"properties": map[string]interface{}{
								"shapeKey": map[string]interface{}{"type": "string"},
								"input":    map[string]interface{}{"type": "object"},
							},
							"required": []string{"shapeKey", "input"},
						},
					},
				},
				"required": []string{"quotes"},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": []interface{}{},
				},
			},
		)

	case "haystack_swap":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"fromAssetId": 0,
				"toAssetId":   31566704,
				"amount":      "1000000",
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"fromAssetId": map[string]interface{}{"type": "number"},
					"toAssetId":   map[string]interface{}{"type": "number"},
					"amount":      map[string]interface{}{"type": "string"},
				},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": map[string]interface{}{
						"encodedTransactions": []interface{}{},
					},
				},
			},
		)

	case "plans_rebalance":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"address":     "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
				"harvestIdle": true,
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"address":     map[string]interface{}{"type": "string"},
					"harvestIdle": map[string]interface{}{"type": "boolean"},
					"targetWeights": map[string]interface{}{
						"type": "array",
					},
				},
				"required": []string{"address"},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": map[string]interface{}{
						"steps": []interface{}{},
					},
				},
			},
		)

	case "execution_compose":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"address":       "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
				"opportunityId": "reti-staking-12",
				"fromAssetId":   0,
				"amount":        "1000000",
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"address":       map[string]interface{}{"type": "string"},
					"opportunityId": map[string]interface{}{"type": "string"},
					"fromAssetId":   map[string]interface{}{"type": "number"},
					"amount":        map[string]interface{}{"type": "string"},
				},
				"required": []string{"address", "opportunityId", "fromAssetId", "amount"},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": map[string]interface{}{
						"steps": []interface{}{},
					},
				},
			},
		)

	case "execution_simulate":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"address": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
				"groups": []interface{}{
					map[string]interface{}{
						"encodedTransactions": []interface{}{},
					},
				},
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"address": map[string]interface{}{"type": "string"},
					"groups": map[string]interface{}{
						"type": "array",
					},
				},
				"required": []string{"address", "groups"},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": map[string]interface{}{
						"wouldSucceed": false,
						"signed":       false,
						"submitted":    false,
					},
				},
			},
		)

	case "sessions":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{},
			bazaar.JSONSchema{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": map[string]interface{}{
						"sessionId": "csess_example",
						"status":    "active",
					},
				},
			},
		)

	case "sessions_refresh":
		return bazaar.DeclareDiscoveryExtension(
			bazaar.MethodPOST,
			map[string]interface{}{
				"sessionId": "csess_example",
			},
			bazaar.JSONSchema{
				"type": "object",
				"properties": map[string]interface{}{
					"sessionId": map[string]interface{}{"type": "string"},
				},
			},
			bazaar.BodyTypeJSON,
			&bazaar.OutputConfig{
				Example: map[string]interface{}{
					"data": map[string]interface{}{
						"sessionId": "csess_example",
						"status":    "active",
					},
				},
			},
		)

	default:
		return bazaar.DiscoveryExtension{}, fmt.Errorf("unknown bazaar_profile %q", profile)
	}
}

func knownBazaarProfiles() []string {
	return []string{
		"opportunities",
		"opportunities_search",
		"opportunities_personalized",
		"eligibility",
		"plans",
		"policy_validate",
		"positions",
		"positions_claimable",
		"protocol_opportunities",
		"execution_quotes",
		"haystack_swap",
		"plans_rebalance",
		"execution_compose",
		"execution_simulate",
		"sessions",
		"sessions_refresh",
	}
}
