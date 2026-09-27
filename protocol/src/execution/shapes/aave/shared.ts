import { AAVE_V3_BASE_POOL } from "../../../adapters/aave.js";
import { InvalidShapeInputError, ShapeStateError } from "../../errors.js";
import {
  BASE_CHAIN_ID,
  EVM_SELECTORS,
  decodeUint256,
  encodeAddressArg,
  encodeFunctionData,
  encodeUint256Arg,
  isNativeEthAsset,
  requireEvmClient
} from "../../evm.js";
import type { EvmRpcClient, ShapeBuildContext } from "../../types.js";
import {
  isRecord,
  parseEvmAddress,
  parsePositiveBaseUnitAmount,
  readOptionalEvmAddress
} from "../morpho/parse-input.js";

export const AAVE_SUPPLY_SHAPE_KEY = "base:aave:v3:supply:erc20";
export const AAVE_WITHDRAW_SHAPE_KEY = "base:aave:v3:withdraw:erc20";
export const AAVE_BORROW_SHAPE_KEY = "base:aave:v3:borrow:variable";
export const AAVE_REPAY_SHAPE_KEY = "base:aave:v3:repay:variable";

export const AAVE_POOL_SELECTORS = {
  supply: "617ba037",
  withdraw: "69328dec",
  borrow: "a415bcad",
  repay: "573ade81",
  getConfiguration: "c44b11f7",
  getUserAccountData: "bf92857c",
  balanceOf: "70a08231"
} as const;

const VARIABLE_RATE_MODE = 2n;
const UINT256_MAX = (1n << 256n) - 1n;

export interface AavePoolActionInput {
  userAddress: string;
  assetAddress: string;
  amount: bigint;
}

export interface AaveReserveFlags {
  active: boolean;
  frozen: boolean;
  paused: boolean;
  borrowingEnabled: boolean;
}

export interface AavePoolActionState {
  chainId: number;
  poolAddress: string;
  assetAddress: string;
  userAddress: string;
  amount: bigint;
  allowance: bigint;
  needsApprove: boolean;
  flags: AaveReserveFlags;
}

export interface AaveStateDependencies {
  readReserveFlags: (client: EvmRpcClient, assetAddress: string) => Promise<AaveReserveFlags>;
  readAllowance: (
    client: EvmRpcClient,
    assetAddress: string,
    owner: string,
    spender: string
  ) => Promise<bigint>;
}

let stateOverrides: Partial<AaveStateDependencies> | undefined;

export function setAaveStateDependenciesForTests(
  overrides?: Partial<AaveStateDependencies>
): void {
  stateOverrides = overrides;
}

function resolveStateDependencies(): AaveStateDependencies {
  return {
    readReserveFlags,
    readAllowance,
    ...stateOverrides
  };
}

export function parseAavePoolActionInput(raw: unknown, action: string): AavePoolActionInput {
  if (!isRecord(raw)) {
    throw new InvalidShapeInputError(`Aave ${action} input must be an object.`);
  }
  const assetAddress = parseAssetSelector(raw);
  if (isNativeEthAsset(assetAddress)) {
    throw new InvalidShapeInputError("Aave quotes do not wrap native ETH. Pass the ERC-20 underlying.");
  }
  const userAddress = parseEvmAddress(raw.userAddress, "userAddress");
  assertUserIsBeneficiary(raw, userAddress, action);
  return {
    userAddress,
    assetAddress,
    amount: parsePositiveBaseUnitAmount(raw.amount ?? raw.assetAmount, "amount")
  };
}

export async function resolveAaveSupplyState(
  context: ShapeBuildContext,
  input: AavePoolActionInput
): Promise<AavePoolActionState> {
  return resolveAaveActionState(context, input, { needsAllowance: true, requireBorrowing: false });
}

export async function resolveAaveWithdrawState(
  context: ShapeBuildContext,
  input: AavePoolActionInput
): Promise<AavePoolActionState> {
  return resolveAaveActionState(context, input, { needsAllowance: false, requireBorrowing: false });
}

export async function resolveAaveBorrowState(
  context: ShapeBuildContext,
  input: AavePoolActionInput
): Promise<AavePoolActionState> {
  return resolveAaveActionState(context, input, { needsAllowance: false, requireBorrowing: true });
}

export async function resolveAaveRepayState(
  context: ShapeBuildContext,
  input: AavePoolActionInput
): Promise<AavePoolActionState> {
  return resolveAaveActionState(context, input, { needsAllowance: true, requireBorrowing: false });
}

async function resolveAaveActionState(
  context: ShapeBuildContext,
  input: AavePoolActionInput,
  options: { needsAllowance: boolean; requireBorrowing: boolean }
): Promise<AavePoolActionState> {
  const client = requireEvmClient(context);
  const deps = resolveStateDependencies();
  const flags = await deps.readReserveFlags(client, input.assetAddress);
  assertReserveAcceptsAction(flags, options.requireBorrowing);
  const allowance = options.needsAllowance
    ? await deps.readAllowance(client, input.assetAddress, input.userAddress, AAVE_V3_BASE_POOL)
    : 0n;
  return {
    chainId: client.chainId,
    poolAddress: AAVE_V3_BASE_POOL,
    assetAddress: input.assetAddress,
    userAddress: input.userAddress,
    amount: input.amount,
    allowance,
    needsApprove: options.needsAllowance && allowance < input.amount,
    flags
  };
}

function assertReserveAcceptsAction(flags: AaveReserveFlags, requireBorrowing: boolean): void {
  if (!flags.active) {
    throw new ShapeStateError("Aave reserve is not active.");
  }
  if (flags.paused) {
    throw new ShapeStateError("Aave reserve is paused.");
  }
  if (flags.frozen) {
    throw new ShapeStateError("Aave reserve is frozen.");
  }
  if (requireBorrowing && !flags.borrowingEnabled) {
    throw new ShapeStateError("Aave borrowing is disabled for this reserve.");
  }
}

function parseAssetSelector(raw: Record<string, unknown>): string {
  const value = raw.assetAddress ?? raw.poolId ?? raw.poolAddress;
  return parseEvmAddress(value, "assetAddress");
}

function assertUserIsBeneficiary(
  raw: Record<string, unknown>,
  userAddress: string,
  action: string
): void {
  for (const field of ["onBehalfOf", "receiver", "owner"] as const) {
    const value = readOptionalEvmAddress(raw, field);
    if (value !== undefined && value !== userAddress) {
      throw new InvalidShapeInputError(
        `Aave ${action} quotes require ${field} to equal userAddress.`
      );
    }
  }
}

export async function readReserveFlags(
  client: EvmRpcClient,
  assetAddress: string
): Promise<AaveReserveFlags> {
  const result = await client.call(
    AAVE_V3_BASE_POOL,
    encodeFunctionData(AAVE_POOL_SELECTORS.getConfiguration, [encodeAddressArg(assetAddress)])
  );
  const data = firstWord(result);
  return {
    active: bit(data, 56),
    frozen: bit(data, 57),
    borrowingEnabled: bit(data, 58),
    paused: bit(data, 60)
  };
}

async function readAllowance(
  client: EvmRpcClient,
  assetAddress: string,
  owner: string,
  spender: string
): Promise<bigint> {
  const result = await client.call(
    assetAddress,
    encodeFunctionData(EVM_SELECTORS.allowance, [
      encodeAddressArg(owner),
      encodeAddressArg(spender)
    ])
  );
  return decodeUint256(result);
}

export function encodeApprovePoolCall(assetAddress: string, amount: bigint): string {
  return encodeFunctionData(EVM_SELECTORS.approve, [
    encodeAddressArg(AAVE_V3_BASE_POOL),
    encodeUint256Arg(amount)
  ]);
}

export function encodeSupplyCall(asset: string, amount: bigint, onBehalfOf: string): string {
  return encodeFunctionData(AAVE_POOL_SELECTORS.supply, [
    encodeAddressArg(asset),
    encodeUint256Arg(amount),
    encodeAddressArg(onBehalfOf),
    encodeUint256Arg(0n)
  ]);
}

export function encodeWithdrawCall(asset: string, amount: bigint, to: string): string {
  return encodeFunctionData(AAVE_POOL_SELECTORS.withdraw, [
    encodeAddressArg(asset),
    encodeUint256Arg(amount),
    encodeAddressArg(to)
  ]);
}

export function encodeBorrowCall(asset: string, amount: bigint, onBehalfOf: string): string {
  return encodeFunctionData(AAVE_POOL_SELECTORS.borrow, [
    encodeAddressArg(asset),
    encodeUint256Arg(amount),
    encodeUint256Arg(VARIABLE_RATE_MODE),
    encodeUint256Arg(0n),
    encodeAddressArg(onBehalfOf)
  ]);
}

export function encodeRepayCall(asset: string, amount: bigint, onBehalfOf: string): string {
  return encodeFunctionData(AAVE_POOL_SELECTORS.repay, [
    encodeAddressArg(asset),
    encodeUint256Arg(amount),
    encodeUint256Arg(VARIABLE_RATE_MODE),
    encodeAddressArg(onBehalfOf)
  ]);
}

export function encodeBalanceOfCall(account: string): string {
  return encodeFunctionData(AAVE_POOL_SELECTORS.balanceOf, [encodeAddressArg(account)]);
}

export function encodeUserAccountDataCall(account: string): string {
  return encodeFunctionData(AAVE_POOL_SELECTORS.getUserAccountData, [
    encodeAddressArg(account)
  ]);
}

export interface AaveUserAccountData {
  totalDebtBase: bigint;
  healthFactorWad: bigint;
}

export function decodeUserAccountData(hex: string): AaveUserAccountData {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length < 64 * 6) {
    throw new ShapeStateError("Aave getUserAccountData returned a short payload.");
  }
  return {
    totalDebtBase: BigInt(`0x${clean.slice(64, 128)}`),
    healthFactorWad: BigInt(`0x${clean.slice(64 * 5, 64 * 6)}`)
  };
}

export function healthFactorFromAccount(data: AaveUserAccountData): number | null {
  if (data.totalDebtBase === 0n || data.healthFactorWad <= 0n || data.healthFactorWad === UINT256_MAX) {
    return null;
  }
  const scaled = (data.healthFactorWad * 1_000_000n) / 10n ** 18n;
  const value = Number(scaled) / 1_000_000;
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function firstWord(hex: string): bigint {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length < 64) {
    throw new ShapeStateError("Aave getConfiguration returned a short payload.");
  }
  return BigInt(`0x${clean.slice(0, 64)}`);
}

function bit(data: bigint, position: number): boolean {
  return ((data >> BigInt(position)) & 1n) === 1n;
}

export { AAVE_V3_BASE_POOL, BASE_CHAIN_ID };
