import { fetchAaveReserveSnapshots, aaveLendingOpportunityId } from "../adapters/aave.js";
import type { AaveReserveSnapshot } from "../adapters/aave.js";
import { createBaseEvmClient } from "../execution/evm.js";
import {
  decodeUserAccountData,
  encodeBalanceOfCall,
  encodeUserAccountDataCall,
  healthFactorFromAccount,
  AAVE_V3_BASE_POOL
} from "../execution/shapes/aave/shared.js";
import type { PositionMarketRecord } from "./position-execution-shapes.js";
import type { ProtocolPositionsCollection } from "./protocol-positions.js";

export interface AavePositionDependencies {
  listReserves: () => Promise<AaveReserveSnapshot[]>;
  readBalance: (token: string, user: string) => Promise<bigint>;
  readAccount: (user: string) => Promise<{ totalDebtBase: bigint; healthFactorWad: bigint }>;
}

let dependencyOverrides: Partial<AavePositionDependencies> | undefined;

export function setAavePositionDependenciesForTests(
  overrides?: Partial<AavePositionDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): AavePositionDependencies {
  return {
    listReserves: () => fetchAaveReserveSnapshots(),
    readBalance: readTokenBalance,
    readAccount: readUserAccount,
    ...dependencyOverrides
  };
}

export async function collectAavePositions(
  address: string
): Promise<ProtocolPositionsCollection> {
  const deps = resolveDependencies();
  const reserves = await deps.listReserves();
  const account = await deps.readAccount(address);
  const healthFactor = healthFactorFromAccount(account);
  const positions: PositionMarketRecord[] = [];
  const warnings: string[] = [];
  let balanceFailures = 0;

  for (const reserve of reserves) {
    let suppliedRaw = 0n;
    let debtRaw = 0n;
    try {
      [suppliedRaw, debtRaw] = await Promise.all([
        deps.readBalance(reserve.aToken, address),
        deps.readBalance(reserve.variableDebtToken, address)
      ]);
    } catch (error) {
      balanceFailures += 1;
      warnings.push(
        `${reserve.symbol} balance read failed: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }

    const opportunityId = aaveLendingOpportunityId(reserve.underlying);
    const hints = {
      poolId: reserve.underlying,
      assetAddress: reserve.underlying
    };
    if (suppliedRaw > 0n) {
      positions.push(
        buildPosition({
          positionType: "supplied",
          positionId: `aave:supplied:${reserve.underlying}`,
          opportunityId,
          reserve,
          amountRaw: suppliedRaw,
          healthFactor,
          inputHints: hints
        })
      );
    }
    if (debtRaw > 0n) {
      positions.push(
        buildPosition({
          positionType: "debt",
          positionId: `aave:debt:${reserve.underlying}`,
          opportunityId,
          reserve,
          amountRaw: debtRaw,
          healthFactor,
          inputHints: hints
        })
      );
    }
  }

  return {
    positions,
    warnings,
    coverage: {
      suppliedUsdComplete: balanceFailures === 0,
      borrowedUsdComplete: balanceFailures === 0,
      rewardsUsdComplete: true
    }
  };
}

function buildPosition(input: {
  positionType: "supplied" | "debt";
  positionId: string;
  opportunityId: string;
  reserve: AaveReserveSnapshot;
  amountRaw: bigint;
  healthFactor: number | null;
  inputHints: { poolId: string; assetAddress: string };
}): PositionMarketRecord {
  return {
    protocol: "aave",
    positionType: input.positionType,
    positionId: input.positionId,
    opportunityId: input.opportunityId,
    assetId: null,
    assetSymbol: input.reserve.symbol,
    amountRaw: input.amountRaw.toString(),
    amount: formatUnits(input.amountRaw, input.reserve.decimals),
    usdValue: tokenUsd(input.amountRaw, input.reserve.decimals, input.reserve.usdPerToken),
    ...(input.healthFactor === null ? {} : { healthFactor: input.healthFactor }),
    inputHints: input.inputHints
  };
}

async function readTokenBalance(token: string, user: string): Promise<bigint> {
  const client = createBaseEvmClient();
  const result = await client.call(token, encodeBalanceOfCall(user));
  const clean = result.startsWith("0x") ? result.slice(2) : result;
  if (clean.length < 64) {
    return 0n;
  }
  return BigInt(`0x${clean.slice(0, 64)}`);
}

async function readUserAccount(
  user: string
): Promise<{ totalDebtBase: bigint; healthFactorWad: bigint }> {
  const client = createBaseEvmClient();
  const result = await client.call(AAVE_V3_BASE_POOL, encodeUserAccountDataCall(user));
  return decodeUserAccountData(result);
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

function tokenUsd(
  amountRaw: bigint,
  decimals: number,
  usdPerToken: number | null
): number | null {
  if (usdPerToken === null || !Number.isFinite(usdPerToken) || usdPerToken < 0) {
    return null;
  }
  const value = (Number(amountRaw) / 10 ** decimals) * usdPerToken;
  return Number.isFinite(value) && value >= 0 ? value : null;
}
