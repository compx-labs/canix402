import {
  fetchPactOpportunities,
  fetchTinymanOpportunities
} from "../adapters/index.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";

type CliProtocol = "tinyman" | "pact";

const SUPPORTED_PROTOCOLS: CliProtocol[] = ["tinyman", "pact"];

interface ProtocolOutput {
  protocol: CliProtocol;
  count: number;
  data: OpportunityRecordV1[];
  error?: string;
}

interface CliOutput {
  generatedAt: string;
  requestedProtocols: CliProtocol[];
  schema: Record<string, string>;
  protocols: ProtocolOutput[];
  totalCount: number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requestedProtocols = resolveProtocols(args.protocol);

  const protocolResults = await Promise.all(
    requestedProtocols.map(async (protocol): Promise<ProtocolOutput> => {
      try {
        const data = await fetchByProtocol(protocol);
        return {
          protocol,
          count: data.length,
          data
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return {
          protocol,
          count: 0,
          data: [],
          error: message
        };
      }
    })
  );

  const output: CliOutput = {
    generatedAt: new Date().toISOString(),
    requestedProtocols,
    schema: {
      protocol: "string",
      opportunityType: "lp | farm | staking | lending",
      opportunityId: "string",
      assetPair: "string",
      apy: "number",
      tvlUsd: "number",
      apr: "number (optional)",
      sourceTimestamp: "ISO timestamp string",
      fetchedAt: "ISO timestamp string",
      notes: "string (optional)"
    },
    protocols: protocolResults,
    totalCount: protocolResults.reduce((sum, item) => sum + item.count, 0)
  };

  const hasErrors = protocolResults.some((result) => result.error);
  const hasEmptyData = args.requireData
    ? protocolResults.some((result) => result.count === 0)
    : false;
  if (hasErrors || hasEmptyData) {
    process.exitCode = 1;
  }

  const indent = args.compact ? 0 : 2;
  console.log(JSON.stringify(output, null, indent));
}

function parseArgs(argv: string[]): {
  protocol?: string;
  compact: boolean;
  requireData: boolean;
} {
  let protocol: string | undefined;
  let compact = false;
  let requireData = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--protocol") {
      protocol = argv[i + 1];
      i += 1;
    } else if (arg === "--compact") {
      compact = true;
    } else if (arg === "--require-data") {
      requireData = true;
    }
  }

  return protocol
    ? { protocol, compact, requireData }
    : { compact, requireData };
}

function resolveProtocols(protocolArg?: string): CliProtocol[] {
  if (!protocolArg || protocolArg === "all") {
    return [...SUPPORTED_PROTOCOLS];
  }

  if (SUPPORTED_PROTOCOLS.includes(protocolArg as CliProtocol)) {
    return [protocolArg as CliProtocol];
  }

  throw new Error(
    `Unsupported protocol '${protocolArg}'. Use one of: ${SUPPORTED_PROTOCOLS.join(
      ", "
    )}, or 'all'.`
  );
}

async function fetchByProtocol(protocol: CliProtocol): Promise<OpportunityRecordV1[]> {
  if (protocol === "tinyman") {
    return fetchTinymanOpportunities();
  }
  return fetchPactOpportunities();
}

void main();
