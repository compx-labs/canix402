import { WEBMCP_TOOLS } from "./catalog";
import { executeCanixWebMcpTool } from "./execute";
import { getModelContext, isOriginIsolated } from "./model-context";
import type { ModelContext, WebMcpRegistrationStatus } from "./types";

export interface RegisterCanixWebMcpToolsOptions {
  gatewayBaseUrl: string;
  modelContext?: ModelContext | null;
  signal?: AbortSignal;
  execute?: typeof executeCanixWebMcpTool;
}

export async function registerCanixWebMcpTools(
  options: RegisterCanixWebMcpToolsOptions
): Promise<WebMcpRegistrationStatus> {
  const originIsolated = isOriginIsolated();
  const resolved =
    options.modelContext === undefined
      ? getModelContext()
      : options.modelContext
        ? { api: "document.modelContext" as const, context: options.modelContext }
        : null;

  if (!resolved) {
    return {
      api: "unavailable",
      originIsolated,
      registered: [],
      failed: []
    };
  }

  const execute = options.execute ?? executeCanixWebMcpTool;
  const registered: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const tool of WEBMCP_TOOLS) {
    try {
      await resolved.context.registerTool(
        {
          name: tool.name,
          title: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          execute: async (args, extras) =>
            execute(tool.name, args, {
              gatewayBaseUrl: options.gatewayBaseUrl,
              signal: extras?.signal ?? options.signal
            })
        },
        options.signal ? { signal: options.signal } : undefined
      );
      registered.push(tool.name);
    } catch (error) {
      failed.push({
        name: tool.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    api: resolved.api,
    originIsolated,
    registered,
    failed
  };
}
