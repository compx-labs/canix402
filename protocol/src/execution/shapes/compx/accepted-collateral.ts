import { Algodv2 } from "algosdk";

import { ShapeStateError } from "../../errors.js";

/** ARC-56 box map prefix for CompX `accepted_collaterals` (ASCII "accepted_collaterals"). */
const ACCEPTED_COLLATERALS_PREFIX = new TextEncoder().encode("accepted_collaterals");

export interface CompXAcceptedCollateralDependencies {
  isAcceptedCollateral: (
    algod: Algodv2,
    marketAppId: number,
    collateralTokenId: number
  ) => Promise<boolean>;
}

let dependencyOverrides: Partial<CompXAcceptedCollateralDependencies> | undefined;

export function setCompXAcceptedCollateralDependenciesForTests(
  overrides?: Partial<CompXAcceptedCollateralDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): CompXAcceptedCollateralDependencies {
  return {
    isAcceptedCollateral: isAcceptedCollateralOnChain,
    ...dependencyOverrides
  };
}

/**
 * CompX box map key for `accepted_collaterals`: prefix + ABI uint64 (big-endian) asset id.
 * Matches ARC-56 keyType AcceptedCollateralKey { assetId: uint64 }.
 */
export function createAcceptedCollateralBoxName(collateralTokenId: number): Uint8Array {
  const key = new Uint8Array(8);
  const view = new DataView(key.buffer);
  view.setBigUint64(0, BigInt(collateralTokenId), false);
  const boxName = new Uint8Array(ACCEPTED_COLLATERALS_PREFIX.length + key.length);
  boxName.set(ACCEPTED_COLLATERALS_PREFIX, 0);
  boxName.set(key, ACCEPTED_COLLATERALS_PREFIX.length);
  return boxName;
}

async function isAcceptedCollateralOnChain(
  algod: Algodv2,
  marketAppId: number,
  collateralTokenId: number
): Promise<boolean> {
  const boxName = createAcceptedCollateralBoxName(collateralTokenId);
  try {
    await algod.getApplicationBoxByName(marketAppId, boxName).do();
    return true;
  } catch (error) {
    if (isBoxNotFoundError(error)) {
      return false;
    }
    throw new ShapeStateError("Failed to read CompX accepted collateral registry.", {
      details: { marketAppId, collateralTokenId },
      cause: error
    });
  }
}

/**
 * Returns true when `collateralTokenId` is registered in the market's
 * on-chain `accepted_collaterals` box map (cross-market LSTs allowed).
 */
export async function isCompXAcceptedCollateral(params: {
  algod: Algodv2;
  marketAppId: number;
  collateralTokenId: number;
}): Promise<boolean> {
  const dependencies = resolveDependencies();
  return dependencies.isAcceptedCollateral(
    params.algod,
    params.marketAppId,
    params.collateralTokenId
  );
}

/**
 * Asserts collateral is in the market's accepted set. Throws ShapeStateError (HTTP 400).
 */
export async function assertCompXAcceptedCollateral(params: {
  algod: Algodv2;
  marketAppId: number;
  collateralTokenId: number;
}): Promise<void> {
  const accepted = await isCompXAcceptedCollateral(params);
  if (!accepted) {
    throw new ShapeStateError(
      "CompX borrow collateralTokenId is not an accepted collateral for this market.",
      {
        details: {
          marketAppId: params.marketAppId,
          collateralTokenId: params.collateralTokenId
        }
      }
    );
  }
}

function isBoxNotFoundError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const status =
    "status" in error
      ? Number((error as { status?: unknown }).status)
      : "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : undefined;
  if (status === 404) {
    return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : "message" in error
        ? String((error as { message?: unknown }).message)
        : "";
  return /box not found|application box not found|404/i.test(message);
}
