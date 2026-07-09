export interface ToolResult {
  [x: string]: unknown;
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

export function jsonResult(payload: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

export function errorResult(error: unknown): ToolResult {
  if (error && typeof error === "object" && "name" in error) {
    const named = error as {
      name: string;
      message: string;
      estimatedPriceUsdc?: string;
      paymentRequired?: unknown;
      status?: number;
      bodySnippet?: string;
    };

    if (named.name === "WalletRequiredError") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "WALLET_REQUIRED",
                message: named.message,
                estimatedPriceUsdc: named.estimatedPriceUsdc,
                paymentRequired: named.paymentRequired,
                setup: {
                  envVar: "CANIX402_WALLET_MNEMONIC",
                  notes: [
                    "Use a dedicated agent wallet with limited funds.",
                    "Wallet must hold ALGO for fees.",
                    "Wallet must be opted into USDC (ASA 31566704 on Algorand mainnet)."
                  ]
                }
              },
              null,
              2
            )
          }
        ]
      };
    }

    if (named.name === "X402ClientError") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "X402_CLIENT_ERROR",
                message: named.message,
                status: named.status,
                bodySnippet: named.bodySnippet
              },
              null,
              2
            )
          }
        ]
      };
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: "INTERNAL_ERROR", message }, null, 2)
      }
    ]
  };
}
