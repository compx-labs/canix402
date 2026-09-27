import {
  aerodromeFarmOpportunityId,
  fetchAerodromePoolSnapshots,
  type AerodromePoolSnapshot
} from "../adapters/aerodrome.js";
import {
  createBaseEvmClient,
  decodeUint256,
  encodeAddressArg,
  encodeFunctionData
} from "../execution/evm.js";
import type { PositionMarketRecord } from "./position-execution-shapes.js";
import type { ProtocolPositionsCollection } from "./protocol-positions.js";

const BALANCE_OF = "70a08231";

export interface AerodromePositionDependencies {
  listPools: () => Promise<AerodromePoolSnapshot[]>;
  readStake: (gauge: string, user: string) => Promise<bigint>;
}

let dependencyOverrides: Partial<AerodromePositionDependencies> | undefined;

export function setAerodromePositionDependenciesForTests(
  overrides?: Partial<AerodromePositionDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): AerodromePositionDependencies {
  return {
    listPools: () => fetchAerodromePoolSnapshots(),
    readStake: readGaugeBalance,
    ...dependencyOverrides
  };
}

export async function collectAerodromePositions(
  address: string
): Promise<ProtocolPositionsCollection> {
  const deps = resolveDependencies();
  const pools = await deps.listPools();
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];
  let balanceFailures = 0;

  for (const pool of pools) {
    let staked = 0n;
    try {
      staked = await deps.readStake(pool.gauge, address);
    } catch (error) {
      balanceFailures += 1;
      warnings.push(
        `${pool.assetPair} gauge balance failed: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    if (staked <= 0n) {
      continue;
    }
    positions.push({
      protocol: "aerodrome",
      positionType: "staked",
      positionId: `aerodrome:staked:${pool.pool}`,
      opportunityId: aerodromeFarmOpportunityId(pool.pool),
      assetId: null,
      assetSymbol: pool.assetPair,
      amountRaw: staked.toString(),
      amount: formatUnits(staked, pool.lpDecimals),
      usdValue: shareUsd(staked, pool.totalSupply, pool.tvlUsd),
      inputHints: { poolId: pool.pool },
      notes: pool.stable
        ? "Staked stable-pool LP. Unclaimed emissions are omitted."
        : "Staked volatile-pool LP. Unclaimed emissions are omitted."
    });
  }

  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete: balanceFailures === 0,
      borrowedUsdComplete: true,
      rewardsUsdComplete: true
    }
  };
}

async function readGaugeBalance(gauge: string, user: string): Promise<bigint> {
  const client = createBaseEvmClient();
  const result = await client.call(
    gauge,
    encodeFunctionData(BALANCE_OF, [encodeAddressArg(user)])
  );
  return decodeUint256(result);
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals <= 0) {
    return value.toString();
  }
  const raw = value.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function shareUsd(balance: bigint, totalSupply: bigint, tvlUsd: number): number | null {
  if (totalSupply <= 0n || !Number.isFinite(tvlUsd) || tvlUsd < 0) {
    return null;
  }
  const scale = 1_000_000n;
  const micros = (balance * scale) / totalSupply;
  const value = (Number(micros) / 1_000_000) * tvlUsd;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
