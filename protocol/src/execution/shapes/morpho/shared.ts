import { InvalidShapeInputError, ShapeStateError } from "../../errors.js";
import {
  BASE_CHAIN_ID,
  EVM_SELECTORS,
  decodeAddress,
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
} from "./parse-input.js";

export const MORPHO_DEPOSIT_SHAPE_KEY = "base:morpho:vault:deposit:erc4626";
export const MORPHO_WITHDRAW_SHAPE_KEY = "base:morpho:vault:withdraw:erc4626";
export const MORPHO_REDEEM_SHAPE_KEY = "base:morpho:vault:redeem:erc4626";

export interface MorphoVaultDepositInput {
  userAddress: string;
  vaultAddress: string;
  amount: bigint;
  assetAddress?: string;
  receiver?: string;
}

export interface MorphoVaultWithdrawInput {
  userAddress: string;
  vaultAddress: string;
  amount: bigint;
  assetAddress?: string;
  receiver?: string;
  owner?: string;
}

export interface MorphoVaultRedeemInput {
  userAddress: string;
  vaultAddress: string;
  shares: bigint;
  assetAddress?: string;
  receiver?: string;
  owner?: string;
}

export interface MorphoVaultPreviewState {
  chainId: number;
  vaultAddress: string;
  assetAddress: string;
  userAddress: string;
  receiver: string;
  owner: string;
  amount?: bigint;
  shares?: bigint;
  previewShares?: bigint;
  previewAssets?: bigint;
  allowance: bigint;
  needsApprove: boolean;
}

export interface MorphoVaultStateDependencies {
  resolveVaultAsset: (client: EvmRpcClient, vaultAddress: string) => Promise<string>;
  readAllowance: (
    client: EvmRpcClient,
    assetAddress: string,
    owner: string,
    spender: string
  ) => Promise<bigint>;
  previewDeposit: (client: EvmRpcClient, vaultAddress: string, assets: bigint) => Promise<bigint>;
  previewWithdraw: (client: EvmRpcClient, vaultAddress: string, assets: bigint) => Promise<bigint>;
  previewRedeem: (client: EvmRpcClient, vaultAddress: string, shares: bigint) => Promise<bigint>;
}

let stateOverrides: Partial<MorphoVaultStateDependencies> | undefined;

export function setMorphoVaultStateDependenciesForTests(
  overrides?: Partial<MorphoVaultStateDependencies>
): void {
  stateOverrides = overrides;
}

function resolveStateDependencies(): MorphoVaultStateDependencies {
  return {
    resolveVaultAsset,
    readAllowance,
    previewDeposit,
    previewWithdraw,
    previewRedeem,
    ...stateOverrides
  };
}

export function parseMorphoDepositInput(raw: unknown): MorphoVaultDepositInput {
  if (!isRecord(raw)) {
    throw new InvalidShapeInputError("Morpho deposit input must be an object.");
  }
  const vaultAddress = parseVaultSelector(raw);
  const userAddress = parseEvmAddress(raw.userAddress, "userAddress");
  const assetAddress = readOptionalEvmAddress(raw, "assetAddress");
  const receiver = readOptionalEvmAddress(raw, "receiver");
  return {
    userAddress,
    vaultAddress,
    amount: parsePositiveBaseUnitAmount(raw.amount ?? raw.assetAmount, "amount"),
    ...(assetAddress !== undefined ? { assetAddress } : {}),
    ...(receiver !== undefined ? { receiver } : {})
  };
}

export function parseMorphoWithdrawInput(raw: unknown): MorphoVaultWithdrawInput {
  if (!isRecord(raw)) {
    throw new InvalidShapeInputError("Morpho withdraw input must be an object.");
  }
  const vaultAddress = parseVaultSelector(raw);
  const userAddress = parseEvmAddress(raw.userAddress, "userAddress");
  const assetAddress = readOptionalEvmAddress(raw, "assetAddress");
  const receiver = readOptionalEvmAddress(raw, "receiver");
  const owner = readOptionalEvmAddress(raw, "owner");
  return {
    userAddress,
    vaultAddress,
    amount: parsePositiveBaseUnitAmount(raw.amount ?? raw.assetAmount, "amount"),
    ...(assetAddress !== undefined ? { assetAddress } : {}),
    ...(receiver !== undefined ? { receiver } : {}),
    ...(owner !== undefined ? { owner } : {})
  };
}

export function parseMorphoRedeemInput(raw: unknown): MorphoVaultRedeemInput {
  if (!isRecord(raw)) {
    throw new InvalidShapeInputError("Morpho redeem input must be an object.");
  }
  const vaultAddress = parseVaultSelector(raw);
  const userAddress = parseEvmAddress(raw.userAddress, "userAddress");
  const assetAddress = readOptionalEvmAddress(raw, "assetAddress");
  const receiver = readOptionalEvmAddress(raw, "receiver");
  const owner = readOptionalEvmAddress(raw, "owner");
  return {
    userAddress,
    vaultAddress,
    shares: parsePositiveBaseUnitAmount(raw.shares ?? raw.amount, "shares"),
    ...(assetAddress !== undefined ? { assetAddress } : {}),
    ...(receiver !== undefined ? { receiver } : {}),
    ...(owner !== undefined ? { owner } : {})
  };
}

function parseVaultSelector(raw: Record<string, unknown>): string {
  const value = raw.vaultAddress ?? raw.poolId ?? raw.poolAddress;
  return parseEvmAddress(value, "vaultAddress");
}

export async function resolveMorphoDepositState(
  context: ShapeBuildContext,
  input: MorphoVaultDepositInput
): Promise<MorphoVaultPreviewState> {
  const client = requireEvmClient(context);
  const deps = resolveStateDependencies();
  const assetAddress = await resolveAssetAddress(deps, client, input);
  const allowance = await deps.readAllowance(
    client,
    assetAddress,
    input.userAddress,
    input.vaultAddress
  );
  const previewShares = await deps.previewDeposit(client, input.vaultAddress, input.amount);
  return {
    chainId: client.chainId,
    vaultAddress: input.vaultAddress,
    assetAddress,
    userAddress: input.userAddress,
    receiver: input.receiver ?? input.userAddress,
    owner: input.userAddress,
    amount: input.amount,
    previewShares,
    allowance,
    needsApprove: allowance < input.amount
  };
}

export async function resolveMorphoWithdrawState(
  context: ShapeBuildContext,
  input: MorphoVaultWithdrawInput
): Promise<MorphoVaultPreviewState> {
  const client = requireEvmClient(context);
  const deps = resolveStateDependencies();
  const owner = input.owner ?? input.userAddress;
  if (owner !== input.userAddress) {
    throw new InvalidShapeInputError(
      "Morpho withdraw quotes require owner to equal userAddress (walletless; no share Permit2)."
    );
  }
  const assetAddress = await resolveAssetAddress(deps, client, input);
  const previewShares = await deps.previewWithdraw(client, input.vaultAddress, input.amount);
  return {
    chainId: client.chainId,
    vaultAddress: input.vaultAddress,
    assetAddress,
    userAddress: input.userAddress,
    receiver: input.receiver ?? input.userAddress,
    owner,
    amount: input.amount,
    previewShares,
    allowance: 0n,
    needsApprove: false
  };
}

export async function resolveMorphoRedeemState(
  context: ShapeBuildContext,
  input: MorphoVaultRedeemInput
): Promise<MorphoVaultPreviewState> {
  const client = requireEvmClient(context);
  const deps = resolveStateDependencies();
  const owner = input.owner ?? input.userAddress;
  if (owner !== input.userAddress) {
    throw new InvalidShapeInputError(
      "Morpho redeem quotes require owner to equal userAddress (walletless; no share Permit2)."
    );
  }
  const assetAddress = await resolveAssetAddress(deps, client, input);
  const previewAssets = await deps.previewRedeem(client, input.vaultAddress, input.shares);
  return {
    chainId: client.chainId,
    vaultAddress: input.vaultAddress,
    assetAddress,
    userAddress: input.userAddress,
    receiver: input.receiver ?? input.userAddress,
    owner,
    shares: input.shares,
    previewAssets,
    allowance: 0n,
    needsApprove: false
  };
}

async function resolveAssetAddress(
  deps: MorphoVaultStateDependencies,
  client: EvmRpcClient,
  input: { vaultAddress: string; assetAddress?: string }
): Promise<string> {
  const resolved = input.assetAddress ?? (await deps.resolveVaultAsset(client, input.vaultAddress));
  if (isNativeEthAsset(resolved)) {
    throw new ShapeStateError("Native ETH Morpho vaults are not supported.");
  }
  return resolved;
}

async function resolveVaultAsset(client: EvmRpcClient, vaultAddress: string): Promise<string> {
  const result = await client.call(vaultAddress, encodeFunctionData(EVM_SELECTORS.asset));
  return decodeAddress(result);
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

async function previewDeposit(
  client: EvmRpcClient,
  vaultAddress: string,
  assets: bigint
): Promise<bigint> {
  const result = await client.call(
    vaultAddress,
    encodeFunctionData(EVM_SELECTORS.previewDeposit, [encodeUint256Arg(assets)])
  );
  return decodeUint256(result);
}

async function previewWithdraw(
  client: EvmRpcClient,
  vaultAddress: string,
  assets: bigint
): Promise<bigint> {
  const result = await client.call(
    vaultAddress,
    encodeFunctionData(EVM_SELECTORS.previewWithdraw, [encodeUint256Arg(assets)])
  );
  return decodeUint256(result);
}

async function previewRedeem(
  client: EvmRpcClient,
  vaultAddress: string,
  shares: bigint
): Promise<bigint> {
  const result = await client.call(
    vaultAddress,
    encodeFunctionData(EVM_SELECTORS.previewRedeem, [encodeUint256Arg(shares)])
  );
  return decodeUint256(result);
}

export function encodeApproveCall(assetAddress: string, spender: string, amount: bigint): string {
  return encodeFunctionData(EVM_SELECTORS.approve, [
    encodeAddressArg(spender),
    encodeUint256Arg(amount)
  ]);
}

export function encodeDepositCall(assets: bigint, receiver: string): string {
  return encodeFunctionData(EVM_SELECTORS.deposit, [
    encodeUint256Arg(assets),
    encodeAddressArg(receiver)
  ]);
}

export function encodeWithdrawCall(assets: bigint, receiver: string, owner: string): string {
  return encodeFunctionData(EVM_SELECTORS.withdraw, [
    encodeUint256Arg(assets),
    encodeAddressArg(receiver),
    encodeAddressArg(owner)
  ]);
}

export function encodeRedeemCall(shares: bigint, receiver: string, owner: string): string {
  return encodeFunctionData(EVM_SELECTORS.redeem, [
    encodeUint256Arg(shares),
    encodeAddressArg(receiver),
    encodeAddressArg(owner)
  ]);
}

export { BASE_CHAIN_ID };
