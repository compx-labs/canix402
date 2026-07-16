import algosdk, { Algodv2 } from "algosdk";
import { TinymanTAlgoClient } from "@tinymanorg/tinyman-js-sdk";

import { InvalidShapeInputError, ShapeStateError } from "../../errors.js";
import type { ExecutionNetwork, SerializedTransaction } from "../../types.js";

/**
 * Tinyman liquid-stake / restake constants mirror
 * `@tinymanorg/tinyman-js-sdk` liquid-stake + assetConstants (not all exported
 * from the package root).
 */
export const TINYMAN_STAKE_APP_ID: Record<ExecutionNetwork, number> = {
  testnet: 724519988,
  mainnet: 2537013674
};

export const TINYMAN_RESTAKE_APP_ID: Record<ExecutionNetwork, number> = {
  testnet: 724676904,
  mainnet: 2537022861
};

export const TINYMAN_VAULT_APP_ID: Record<ExecutionNetwork, number> = {
  testnet: 480164661,
  mainnet: 2200606875
};

export const TALGO_ASSET_ID: Record<ExecutionNetwork, number> = {
  testnet: 724519992,
  mainnet: 2537013734
};

export const STALGO_ASSET_ID: Record<ExecutionNetwork, number> = {
  testnet: 724676936,
  mainnet: 2537023208
};

export const TINY_ASSET_ID: Record<ExecutionNetwork, number> = {
  testnet: 258703304,
  mainnet: 2200000000
};

export const MINT_APP_ARG = "mint";
export const BURN_APP_ARG = "burn";
export const INCREASE_STAKE_APP_ARG = "increase_stake";
export const DECREASE_STAKE_APP_ARG = "decrease_stake";
export const CLAIM_REWARDS_APP_ARG = "claim_rewards";
export const APPLY_RATE_CHANGE_APP_ARG = "apply_rate_change";

const RATE_CHANGE_END_TIMESTAMP_KEY = "current_reward_rate_per_time_end_timestamp";

export interface TinymanLiquidStakeState {
  network: ExecutionNetwork;
  stakeAppId: number;
  stakeAppAddress: string;
  restakeAppId: number;
  restakeAppAddress: string;
  vaultAppId: number;
  tAlgoAssetId: number;
  stAlgoAssetId: number;
  tinyAssetId: number;
  userAlgoBalance: bigint;
  userTAlgoBalance: bigint;
  userStAlgoBalance: bigint;
  /** ALGO / tALGO ratio from the stake app (algoAmount / tAlgoAmount). */
  algoToTAlgoRatio: number;
  needsTAlgoOptIn: boolean;
  needsStAlgoOptIn: boolean;
  needsTinyOptIn: boolean;
  needsUserBoxPayment: boolean;
  needsApplyRateChange: boolean;
}

export interface TinymanLiquidStakeStateDependencies {
  getAccountAssetBalance: (algod: Algodv2, address: string, assetId: number) => Promise<bigint>;
  isAssetOptedIn: (algod: Algodv2, address: string, assetId: number) => Promise<boolean>;
  boxExists: (algod: Algodv2, appId: number, boxName: Uint8Array) => Promise<boolean>;
  needsApplyRateChange: (algod: Algodv2, restakeAppId: number) => Promise<boolean>;
  getAlgoToTAlgoRatio: (algod: Algodv2, network: ExecutionNetwork) => Promise<number>;
}

let dependencyOverrides: Partial<TinymanLiquidStakeStateDependencies> | undefined;

export function setTinymanLiquidStakeStateDependenciesForTests(
  overrides?: Partial<TinymanLiquidStakeStateDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): TinymanLiquidStakeStateDependencies {
  return {
    getAccountAssetBalance,
    isAssetOptedIn,
    boxExists,
    needsApplyRateChange,
    getAlgoToTAlgoRatio,
    ...dependencyOverrides
  };
}

export async function resolveTinymanLiquidStakeState(params: {
  network: ExecutionNetwork;
  algod: Algodv2;
  userAddress: string;
}): Promise<TinymanLiquidStakeState> {
  const dependencies = resolveDependencies();
  const { network, algod, userAddress } = params;

  const stakeAppId = TINYMAN_STAKE_APP_ID[network];
  const restakeAppId = TINYMAN_RESTAKE_APP_ID[network];
  const vaultAppId = TINYMAN_VAULT_APP_ID[network];
  const tAlgoAssetId = TALGO_ASSET_ID[network];
  const stAlgoAssetId = STALGO_ASSET_ID[network];
  const tinyAssetId = TINY_ASSET_ID[network];

  let algoToTAlgoRatio: number;
  try {
    algoToTAlgoRatio = await dependencies.getAlgoToTAlgoRatio(algod, network);
  } catch (error) {
    throw new ShapeStateError("Failed to resolve Tinyman ALGO/tALGO ratio.", {
      cause: error,
      details: { stakeAppId, network }
    });
  }

  const userStateBoxName = algosdk.decodeAddress(userAddress).publicKey;

  const [
    userAlgoBalance,
    userTAlgoBalance,
    userStAlgoBalance,
    needsTAlgoOptIn,
    needsStAlgoOptIn,
    needsTinyOptIn,
    needsUserBoxPayment,
    applyRateChange
  ] = await Promise.all([
    dependencies.getAccountAssetBalance(algod, userAddress, 0),
    dependencies.getAccountAssetBalance(algod, userAddress, tAlgoAssetId),
    dependencies.getAccountAssetBalance(algod, userAddress, stAlgoAssetId),
    dependencies.isAssetOptedIn(algod, userAddress, tAlgoAssetId).then((v) => !v),
    dependencies.isAssetOptedIn(algod, userAddress, stAlgoAssetId).then((v) => !v),
    dependencies.isAssetOptedIn(algod, userAddress, tinyAssetId).then((v) => !v),
    dependencies.boxExists(algod, restakeAppId, userStateBoxName).then((v) => !v),
    dependencies.needsApplyRateChange(algod, restakeAppId)
  ]);

  return {
    network,
    stakeAppId,
    stakeAppAddress: algosdk.getApplicationAddress(stakeAppId).toString(),
    restakeAppId,
    restakeAppAddress: algosdk.getApplicationAddress(restakeAppId).toString(),
    vaultAppId,
    tAlgoAssetId,
    stAlgoAssetId,
    tinyAssetId,
    userAlgoBalance,
    userTAlgoBalance,
    userStAlgoBalance,
    algoToTAlgoRatio,
    needsTAlgoOptIn,
    needsStAlgoOptIn,
    needsTinyOptIn,
    needsUserBoxPayment,
    needsApplyRateChange: applyRateChange
  };
}

export async function getAlgoToTAlgoRatio(
  algod: Algodv2,
  network: ExecutionNetwork
): Promise<number> {
  const client = new TinymanTAlgoClient(algod, network);
  return client.getRatio();
}

export async function getAccountAssetBalance(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<bigint> {
  const account = await algod.accountInformation(address).do();
  if (assetId === 0) {
    return BigInt(account.amount);
  }
  const holding = account.assets?.find((asset) => Number(asset.assetId) === assetId);
  return holding === undefined ? 0n : BigInt(holding.amount);
}

export async function isAssetOptedIn(
  algod: Algodv2,
  address: string,
  assetId: number
): Promise<boolean> {
  if (assetId === 0) {
    return true;
  }
  const account = await algod.accountInformation(address).do();
  return (account.assets ?? []).some((asset) => Number(asset.assetId) === assetId);
}

export async function boxExists(
  algod: Algodv2,
  appId: number,
  boxName: Uint8Array
): Promise<boolean> {
  try {
    await algod.getApplicationBoxByName(appId, boxName).do();
    return true;
  } catch {
    return false;
  }
}

export async function needsApplyRateChange(
  algod: Algodv2,
  restakeAppId: number
): Promise<boolean> {
  const app = await algod.getApplicationByID(restakeAppId).do();
  const globalState = app.params?.globalState ?? [];
  const keyBytes = Buffer.from(RATE_CHANGE_END_TIMESTAMP_KEY, "utf8");
  const entry = globalState.find((item) => {
    const key =
      item.key instanceof Uint8Array
        ? Buffer.from(item.key)
        : Buffer.from(String(item.key), "base64");
    return key.equals(keyBytes);
  });
  if (entry === undefined) {
    return false;
  }
  const endTimestamp = Number(entry.value?.uint ?? 0);
  if (!Number.isFinite(endTimestamp) || endTimestamp <= 0) {
    return false;
  }
  return endTimestamp <= Math.floor(Date.now() / 1000);
}

/** Expected tALGO minted for an ALGO deposit, floored like the Tinyman SDK tests. */
export function expectedTAlgoFromMint(algoAmount: bigint, algoToTAlgoRatio: number): bigint {
  if (!(algoToTAlgoRatio > 0) || !Number.isFinite(algoToTAlgoRatio)) {
    throw new ShapeStateError("Tinyman ALGO/tALGO ratio must be a positive finite number.", {
      details: { algoToTAlgoRatio }
    });
  }
  return BigInt(Math.floor(Number(algoAmount) / algoToTAlgoRatio));
}

export function parseLiquidStakeAddress(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidShapeInputError("userAddress must be a non-empty string.");
  }
  if (!/^[A-Z2-7]{58}$/.test(value)) {
    throw new InvalidShapeInputError("userAddress must be a valid Algorand address.");
  }
  return value;
}

export function parseLiquidStakeAmount(value: unknown, field = "amount"): bigint {
  let result: bigint;
  if (typeof value === "bigint") {
    result = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new InvalidShapeInputError(`${field} must be an integer amount in base units.`, {
        [field]: value
      });
    }
    result = BigInt(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    result = BigInt(value);
  } else {
    throw new InvalidShapeInputError(
      `${field} must be a positive integer amount in base units.`,
      { [field]: value }
    );
  }
  if (result <= 0n) {
    throw new InvalidShapeInputError(`${field} must be greater than zero.`, {
      [field]: value
    });
  }
  return result;
}

/** Find the last application call whose first printable app-arg matches `appArg`. */
export function findAppCallByArg(
  group: readonly SerializedTransaction[],
  appArg: string
): SerializedTransaction | undefined {
  for (let index = group.length - 1; index >= 0; index -= 1) {
    const txn = group[index];
    if (txn?.type === "appl" && txn.applicationCall?.appArgsText[0] === appArg) {
      return txn;
    }
  }
  return undefined;
}

export function assertAllGrouped(
  group: readonly SerializedTransaction[],
  errors: string[]
): void {
  if (group.some((txn) => !txn.groupPresent)) {
    errors.push("All transactions must belong to a single atomic group.");
  }
}
