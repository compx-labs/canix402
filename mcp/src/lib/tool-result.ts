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
      status?: number;
      bodySnippet?: string;
    };

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
