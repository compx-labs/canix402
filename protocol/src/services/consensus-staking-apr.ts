import algosdk, { Algodv2 } from "algosdk";

/**
 * Algorand v40 consensus staking rewards (Foundation bonus + fee share).
 *
 * blockReward ≈ bonus + (Percent/100) * feesCollected
 * apr% = (blockReward * blocksPerYear / onlineStake) * 100
 *
 * Bonus schedule (go-algorand ConsensusV40): base 10 ALGO, decay 1% every 1e6 rounds.
 * Prefer live block-header `bonus` when available.
 */

export const CONSENSUS_PAYOUT_FEE_PERCENT = 50;
export const CONSENSUS_BONUS_BASE_MICRO_ALGOS = 10_000_000n;
export const CONSENSUS_BONUS_DECAY_INTERVAL = 1_000_000;
/** ~2.8s block time → ~11.27M blocks/year (31_557_600 / 2.8). */
export const CONSENSUS_BLOCKS_PER_YEAR = 31_557_600 / 2.8;
export const DEFAULT_BLOCK_SAMPLE_SIZE = 32;

export interface ConsensusStakingAprEstimate {
  /** Network consensus APR in percentage points (pre protocol fee). */
  apr: number;
  bonusMicroAlgos: bigint;
  avgFeesCollected: bigint;
  blockRewardMicroAlgos: number;
  onlineStake: bigint;
  currentRound: number;
  blocksPerYear: number;
  sampleSize: number;
  sourceTimestamp: string;
}

export interface ConsensusStakingAprDependencies {
  createAlgodClient: () => Algodv2;
  getSupply: (algod: Algodv2) => Promise<{
    currentRound: number | bigint;
    onlineStake: bigint;
    onlineMoney: bigint;
  }>;
  getStatusRound: (algod: Algodv2) => Promise<number>;
  getBlockRewardFields: (
    algod: Algodv2,
    round: number
  ) => Promise<{ bonus: bigint; feesCollected: bigint }>;
  blockSampleSize: number;
  blocksPerYear: number;
  payoutFeePercent: number;
}

export class ConsensusStakingAprError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConsensusStakingAprError";
    this.cause = cause;
  }
}

let dependencyOverrides: Partial<ConsensusStakingAprDependencies> | undefined;

export function setConsensusStakingAprDependenciesForTests(
  overrides?: Partial<ConsensusStakingAprDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): ConsensusStakingAprDependencies {
  return {
    createAlgodClient: createAlgodClient,
    getSupply: async (algod) => {
      const supply = await algod.supply().do();
      return {
        currentRound: supply.currentRound,
        onlineStake: BigInt(supply.onlineStake),
        onlineMoney: BigInt(supply.onlineMoney)
      };
    },
    getStatusRound: async (algod) => {
      const status = await algod.status().do();
      return Number(status.lastRound);
    },
    getBlockRewardFields: async (algod, round) => {
      const response = await algod.block(round).headerOnly(true).do();
      const header = response.block.header;
      return {
        bonus: BigInt(header.bonus ?? 0n),
        feesCollected: BigInt(header.feesCollected ?? 0n)
      };
    },
    blockSampleSize: DEFAULT_BLOCK_SAMPLE_SIZE,
    blocksPerYear: CONSENSUS_BLOCKS_PER_YEAR,
    payoutFeePercent: CONSENSUS_PAYOUT_FEE_PERCENT,
    ...dependencyOverrides
  };
}

/**
 * Computes Foundation bonus for a round when live block headers are unavailable.
 * Uses BaseAmount * 0.99^floor(round / DecayInterval).
 */
export function computeDecayedBonusMicroAlgos(
  round: number,
  baseAmount: bigint = CONSENSUS_BONUS_BASE_MICRO_ALGOS,
  decayInterval: number = CONSENSUS_BONUS_DECAY_INTERVAL
): bigint {
  if (!Number.isFinite(round) || round < 0 || decayInterval <= 0) {
    return baseAmount;
  }
  const decays = Math.floor(round / decayInterval);
  if (decays <= 0) {
    return baseAmount;
  }
  // Work in floating point then round; bonus stays near 1e7 so precision is fine.
  const decayed = Number(baseAmount) * Math.pow(0.99, decays);
  return BigInt(Math.round(decayed));
}

export function computeConsensusApr(params: {
  bonusMicroAlgos: bigint;
  avgFeesCollected: bigint;
  onlineStake: bigint;
  blocksPerYear?: number;
  payoutFeePercent?: number;
}): number {
  const blocksPerYear = params.blocksPerYear ?? CONSENSUS_BLOCKS_PER_YEAR;
  const payoutFeePercent = params.payoutFeePercent ?? CONSENSUS_PAYOUT_FEE_PERCENT;
  const onlineStake = params.onlineStake;

  if (onlineStake <= 0n) {
    throw new ConsensusStakingAprError("onlineStake must be greater than zero.");
  }
  if (!(blocksPerYear > 0) || !Number.isFinite(blocksPerYear)) {
    throw new ConsensusStakingAprError("blocksPerYear must be a positive finite number.");
  }

  const feeShare =
    (Number(params.avgFeesCollected) * payoutFeePercent) / 100;
  const blockReward = Number(params.bonusMicroAlgos) + feeShare;
  if (!Number.isFinite(blockReward) || blockReward < 0) {
    throw new ConsensusStakingAprError("Computed block reward is invalid.");
  }

  const apr = ((blockReward * blocksPerYear) / Number(onlineStake)) * 100;
  if (!Number.isFinite(apr) || apr < 0) {
    throw new ConsensusStakingAprError("Computed consensus APR is invalid.");
  }
  return apr;
}

export async function estimateConsensusStakingApr(
  algod?: Algodv2
): Promise<ConsensusStakingAprEstimate> {
  const dependencies = resolveDependencies();
  const client = algod ?? dependencies.createAlgodClient();
  const fetchedAt = new Date().toISOString();

  try {
    const [supply, statusRound] = await Promise.all([
      dependencies.getSupply(client),
      dependencies.getStatusRound(client)
    ]);

    const onlineStake =
      supply.onlineStake > 0n ? supply.onlineStake : supply.onlineMoney;
    if (onlineStake <= 0n) {
      throw new ConsensusStakingAprError(
        "Algod ledger supply reported zero online stake."
      );
    }

    const currentRound = Number.isFinite(statusRound) && statusRound > 0
      ? statusRound
      : Number(supply.currentRound);

    if (!Number.isFinite(currentRound) || currentRound < 1) {
      throw new ConsensusStakingAprError(
        "Unable to resolve current Algorand round for consensus APR."
      );
    }

    const sampleSize = Math.max(1, Math.min(dependencies.blockSampleSize, currentRound));
    const startRound = currentRound - sampleSize + 1;
    const blockResults = await Promise.allSettled(
      Array.from({ length: sampleSize }, (_, index) =>
        dependencies.getBlockRewardFields(client, startRound + index)
      )
    );

    const samples = blockResults
      .filter(
        (
          result
        ): result is PromiseFulfilledResult<{ bonus: bigint; feesCollected: bigint }> =>
          result.status === "fulfilled"
      )
      .map((result) => result.value);

    if (samples.length === 0) {
      throw new ConsensusStakingAprError(
        "Failed to sample recent block headers for consensus rewards."
      );
    }

    const totalFees = samples.reduce((sum, sample) => sum + sample.feesCollected, 0n);
    const avgFeesCollected = totalFees / BigInt(samples.length);

    const bonuses = samples.map((sample) => sample.bonus).filter((bonus) => bonus > 0n);
    const bonusMicroAlgos =
      bonuses.length > 0
        ? bonuses.reduce((sum, bonus) => sum + bonus, 0n) / BigInt(bonuses.length)
        : computeDecayedBonusMicroAlgos(currentRound);

    const apr = computeConsensusApr({
      bonusMicroAlgos,
      avgFeesCollected,
      onlineStake,
      blocksPerYear: dependencies.blocksPerYear,
      payoutFeePercent: dependencies.payoutFeePercent
    });

    const feeShare =
      (Number(avgFeesCollected) * dependencies.payoutFeePercent) / 100;

    return {
      apr,
      bonusMicroAlgos,
      avgFeesCollected,
      blockRewardMicroAlgos: Number(bonusMicroAlgos) + feeShare,
      onlineStake,
      currentRound,
      blocksPerYear: dependencies.blocksPerYear,
      sampleSize: samples.length,
      sourceTimestamp: fetchedAt
    };
  } catch (error) {
    if (error instanceof ConsensusStakingAprError) {
      throw error;
    }
    throw new ConsensusStakingAprError(
      "Failed to estimate Algorand consensus staking APR.",
      error
    );
  }
}

function createAlgodClient(): Algodv2 {
  const server = process.env.X402_ALGOD_URL ?? "https://mainnet-api.algonode.cloud";
  const token = process.env.X402_ALGOD_TOKEN ?? "";
  return new algosdk.Algodv2(token, trimTrailingSlash(server), "");
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
