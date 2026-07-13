import {
  fetchOpportunitiesWithErrors,
  SUPPORTED_AGGREGATE_PROTOCOLS
} from "../services/aggregate-opportunities.js";
import { formatOpportunitiesForAgent } from "../services/precision.js";
import { rankOpportunitiesByApy } from "../services/opportunity-ranking.js";
import { AGGREGATE_OPPORTUNITIES_DEFAULT_LIMIT } from "../routes/schemas.js";
import type { Protocol } from "../routes/schemas.js";
import { OpportunityRecordV1 } from "../types/opportunity.js";

interface CliArgs {
  protocols: Protocol[];
  limit: number;
  offset: number;
  compact: boolean;
  requireData: boolean;
  all: boolean;
}

interface CliOutput {
  generatedAt: string;
  requestedProtocols: Protocol[];
  limit: number;
  offset: number;
  totalMatched: number;
  returnedCount: number;
  errors: Array<{ protocol: Protocol; message: string }>;
  data: OpportunityRecordV1[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { data, errors } = await fetchOpportunitiesWithErrors(args.protocols);

  const ranked = rankOpportunitiesByApy(data);
  const selected = args.all
    ? ranked.slice(args.offset)
    : ranked.slice(args.offset, args.offset + args.limit);

  const output: CliOutput = {
    generatedAt: new Date().toISOString(),
    requestedProtocols: args.protocols,
    limit: args.all ? ranked.length : args.limit,
    offset: args.offset,
    totalMatched: ranked.length,
    returnedCount: selected.length,
    errors,
    data: formatOpportunitiesForAgent(selected)
  };

  // Mirror the endpoint's graceful degradation: partial upstream failures are
  // reported in `errors` but do not fail the command. Only a hard failure
  // (no data at all, or --require-data with an empty result) exits non-zero.
  const allFailed = data.length === 0 && errors.length === args.protocols.length;
  const requireDataEmpty = args.requireData && output.returnedCount === 0;
  if (allFailed || requireDataEmpty) {
    process.exitCode = 1;
  }

  const indent = args.compact ? 0 : 2;
  console.log(JSON.stringify(output, null, indent));
}

function parseArgs(argv: string[]): CliArgs {
  let protocolArg: string | undefined;
  let limit = AGGREGATE_OPPORTUNITIES_DEFAULT_LIMIT;
  let offset = 0;
  let compact = false;
  let requireData = false;
  let all = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--protocol") {
      protocolArg = argv[i + 1];
      i += 1;
    } else if (arg === "--limit") {
      limit = parsePositiveInt(argv[i + 1], "--limit");
      i += 1;
    } else if (arg === "--offset") {
      offset = parsePositiveInt(argv[i + 1], "--offset");
      i += 1;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--compact") {
      compact = true;
    } else if (arg === "--require-data") {
      requireData = true;
    }
  }

  return {
    protocols: resolveProtocols(protocolArg),
    limit,
    offset,
    compact,
    requireData,
    all
  };
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} expects a non-negative integer, received '${value ?? ""}'.`);
  }
  return parsed;
}

function resolveProtocols(protocolArg?: string): Protocol[] {
  if (!protocolArg || protocolArg === "all") {
    return [...SUPPORTED_AGGREGATE_PROTOCOLS];
  }

  const requested = protocolArg
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const invalid = requested.filter(
    (entry) => !SUPPORTED_AGGREGATE_PROTOCOLS.includes(entry as Protocol)
  );
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported protocol(s): ${invalid.join(", ")}. Use one of: ${SUPPORTED_AGGREGATE_PROTOCOLS.join(
        ", "
      )}, or 'all'.`
    );
  }

  return requested as Protocol[];
}

void main();
