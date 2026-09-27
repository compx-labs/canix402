import {
  AERODROME_POOL_FACTORY,
  AERODROME_ROUTER,
  AERODROME_VOTER
} from "../../../adapters/aerodrome.js";
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
  normalizeEvmAddress,
  requireEvmClient
} from "../../evm.js";
import type { EvmRpcClient, ShapeBuildContext } from "../../types.js";
import {
  isRecord,
  parseEvmAddress,
  parsePositiveBaseUnitAmount,
  readOptionalEvmAddress
} from "../morpho/parse-input.js";

export const AERODROME_DEPOSIT_SHAPE_KEY = "base:aerodrome:v2:deposit:gauge";
export const AERODROME_WITHDRAW_SHAPE_KEY = "base:aerodrome:v2:withdraw:gauge";

export const AERODROME_SELECTORS = {
  token0: "0dfe1681",
  token1: "d21220a7",
  stable: "22be3de1",
  factory: "c45a0155",
  gauges: "b9a09fd5",
  isAlive: "1703e5f9",
  addLiquidity: "5a47ddc3",
  removeLiquidity: "0dede6c4",
  quoteAddLiquidity: "ce700c29",
  quoteRemoveLiquidity: "c92de3ec",
  deposit: "b6b55f25",
  withdraw: "2e1a7d4d",
  balanceOf: "70a08231"
} as const;

const DEFAULT_SLIPPAGE_BPS = 50;
const MAX_SLIPPAGE_BPS = 1_000;
const DEADLINE_SECONDS = 20 * 60;
const BPS_SCALE = 10_000n;

export interface AerodromeDepositInput {
  userAddress: string;
  poolAddress: string;
  amountA: bigint;
  amountB: bigint;
  slippageBps: number;
}

export interface AerodromeWithdrawInput {
  userAddress: string;
  poolAddress: string;
  liquidity: bigint;
  slippageBps: number;
}

export interface AerodromePoolView {
  token0: string;
  token1: string;
  stable: boolean;
  factory: string;
  gauge: string;
  alive: boolean;
}

export interface AerodromeQuote {
  amountA: bigint;
  amountB: bigint;
  liquidity: bigint;
}

export interface AerodromeDepositState {
  chainId: number;
  userAddress: string;
  poolAddress: string;
  gaugeAddress: string;
  routerAddress: string;
  token0: string;
  token1: string;
  stable: boolean;
  amountADesired: bigint;
  amountBDesired: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  liquidity: bigint;
  needsApprove0: boolean;
  needsApprove1: boolean;
  needsApproveLp: boolean;
  slippageBps: number;
  deadline: bigint;
}

export interface AerodromeWithdrawState {
  chainId: number;
  userAddress: string;
  poolAddress: string;
  gaugeAddress: string;
  routerAddress: string;
  token0: string;
  token1: string;
  stable: boolean;
  liquidity: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  needsApproveLp: boolean;
  slippageBps: number;
  deadline: bigint;
}

export interface AerodromeStateDependencies {
  readPool: (client: EvmRpcClient, poolAddress: string) => Promise<AerodromePoolView>;
  readAllowance: (
    client: EvmRpcClient,
    token: string,
    owner: string,
    spender: string
  ) => Promise<bigint>;
  quoteAdd: (
    client: EvmRpcClient,
    pool: AerodromePoolView,
    amountA: bigint,
    amountB: bigint
  ) => Promise<AerodromeQuote>;
  quoteRemove: (
    client: EvmRpcClient,
    pool: AerodromePoolView,
    liquidity: bigint
  ) => Promise<Pick<AerodromeQuote, "amountA" | "amountB">>;
}

let stateOverrides: Partial<AerodromeStateDependencies> | undefined;

export function setAerodromeStateDependenciesForTests(
  overrides?: Partial<AerodromeStateDependencies>
): void {
  stateOverrides = overrides;
}

function resolveStateDependencies(): AerodromeStateDependencies {
  return {
    readPool: readAerodromePool,
    readAllowance,
    quoteAdd: quoteAddLiquidity,
    quoteRemove: quoteRemoveLiquidity,
    ...stateOverrides
  };
}

export function parseAerodromeDepositInput(raw: unknown): AerodromeDepositInput {
  if (!isRecord(raw)) {
    throw new InvalidShapeInputError("Aerodrome deposit input must be an object.");
  }
  const userAddress = parseEvmAddress(raw.userAddress, "userAddress");
  assertUserIsBeneficiary(raw, userAddress, "deposit");
  return {
    userAddress,
    poolAddress: parsePoolAddress(raw),
    amountA: parsePositiveBaseUnitAmount(raw.amountA, "amountA"),
    amountB: parsePositiveBaseUnitAmount(raw.amountB, "amountB"),
    slippageBps: parseSlippageBps(raw.slippageBps)
  };
}

export function parseAerodromeWithdrawInput(raw: unknown): AerodromeWithdrawInput {
  if (!isRecord(raw)) {
    throw new InvalidShapeInputError("Aerodrome withdraw input must be an object.");
  }
  const userAddress = parseEvmAddress(raw.userAddress, "userAddress");
  assertUserIsBeneficiary(raw, userAddress, "withdraw");
  return {
    userAddress,
    poolAddress: parsePoolAddress(raw),
    liquidity: parsePositiveBaseUnitAmount(raw.liquidity ?? raw.amount, "liquidity"),
    slippageBps: parseSlippageBps(raw.slippageBps)
  };
}

export async function resolveAerodromeDepositState(
  context: ShapeBuildContext,
  input: AerodromeDepositInput
): Promise<AerodromeDepositState> {
  const client = requireEvmClient(context);
  const deps = resolveStateDependencies();
  const pool = await deps.readPool(client, input.poolAddress);
  assertBasicAlivePool(pool);
  const quoted = await deps.quoteAdd(client, pool, input.amountA, input.amountB);
  if (quoted.liquidity <= 0n || quoted.amountA <= 0n || quoted.amountB <= 0n) {
    throw new ShapeStateError("Aerodrome add-liquidity quote returned no liquidity.");
  }
  const [allowance0, allowance1, lpAllowance] = await Promise.all([
    deps.readAllowance(client, pool.token0, input.userAddress, AERODROME_ROUTER),
    deps.readAllowance(client, pool.token1, input.userAddress, AERODROME_ROUTER),
    deps.readAllowance(client, input.poolAddress, input.userAddress, pool.gauge)
  ]);
  return {
    chainId: client.chainId,
    userAddress: input.userAddress,
    poolAddress: input.poolAddress,
    gaugeAddress: pool.gauge,
    routerAddress: AERODROME_ROUTER,
    token0: pool.token0,
    token1: pool.token1,
    stable: pool.stable,
    amountADesired: input.amountA,
    amountBDesired: input.amountB,
    amountAMin: applySlippage(quoted.amountA, input.slippageBps),
    amountBMin: applySlippage(quoted.amountB, input.slippageBps),
    liquidity: quoted.liquidity,
    needsApprove0: allowance0 < input.amountA,
    needsApprove1: allowance1 < input.amountB,
    needsApproveLp: lpAllowance < quoted.liquidity,
    slippageBps: input.slippageBps,
    deadline: quoteDeadline(context)
  };
}

export async function resolveAerodromeWithdrawState(
  context: ShapeBuildContext,
  input: AerodromeWithdrawInput
): Promise<AerodromeWithdrawState> {
  const client = requireEvmClient(context);
  const deps = resolveStateDependencies();
  const pool = await deps.readPool(client, input.poolAddress);
  assertBasicAlivePool(pool);
  const quoted = await deps.quoteRemove(client, pool, input.liquidity);
  if (quoted.amountA <= 0n || quoted.amountB <= 0n) {
    throw new ShapeStateError("Aerodrome remove-liquidity quote returned no tokens.");
  }
  const lpAllowance = await deps.readAllowance(
    client,
    input.poolAddress,
    input.userAddress,
    AERODROME_ROUTER
  );
  return {
    chainId: client.chainId,
    userAddress: input.userAddress,
    poolAddress: input.poolAddress,
    gaugeAddress: pool.gauge,
    routerAddress: AERODROME_ROUTER,
    token0: pool.token0,
    token1: pool.token1,
    stable: pool.stable,
    liquidity: input.liquidity,
    amountAMin: applySlippage(quoted.amountA, input.slippageBps),
    amountBMin: applySlippage(quoted.amountB, input.slippageBps),
    needsApproveLp: lpAllowance < input.liquidity,
    slippageBps: input.slippageBps,
    deadline: quoteDeadline(context)
  };
}

export function encodeApproveCall(spender: string, amount: bigint): string {
  return encodeFunctionData(EVM_SELECTORS.approve, [
    encodeAddressArg(spender),
    encodeUint256Arg(amount)
  ]);
}

export function encodeAddLiquidityCall(state: AerodromeDepositState): string {
  return encodeFunctionData(AERODROME_SELECTORS.addLiquidity, [
    encodeAddressArg(state.token0),
    encodeAddressArg(state.token1),
    encodeUint256Arg(state.stable ? 1n : 0n),
    encodeUint256Arg(state.amountADesired),
    encodeUint256Arg(state.amountBDesired),
    encodeUint256Arg(state.amountAMin),
    encodeUint256Arg(state.amountBMin),
    encodeAddressArg(state.userAddress),
    encodeUint256Arg(state.deadline)
  ]);
}

export function encodeRemoveLiquidityCall(state: AerodromeWithdrawState): string {
  return encodeFunctionData(AERODROME_SELECTORS.removeLiquidity, [
    encodeAddressArg(state.token0),
    encodeAddressArg(state.token1),
    encodeUint256Arg(state.stable ? 1n : 0n),
    encodeUint256Arg(state.liquidity),
    encodeUint256Arg(state.amountAMin),
    encodeUint256Arg(state.amountBMin),
    encodeAddressArg(state.userAddress),
    encodeUint256Arg(state.deadline)
  ]);
}

export function encodeGaugeDepositCall(liquidity: bigint): string {
  return encodeFunctionData(AERODROME_SELECTORS.deposit, [encodeUint256Arg(liquidity)]);
}

export function encodeGaugeWithdrawCall(liquidity: bigint): string {
  return encodeFunctionData(AERODROME_SELECTORS.withdraw, [encodeUint256Arg(liquidity)]);
}

export async function readAerodromePool(
  client: EvmRpcClient,
  poolAddress: string
): Promise<AerodromePoolView> {
  const [token0, token1, stableWord, factory, gauge] = await Promise.all([
    client.call(poolAddress, encodeFunctionData(AERODROME_SELECTORS.token0)),
    client.call(poolAddress, encodeFunctionData(AERODROME_SELECTORS.token1)),
    client.call(poolAddress, encodeFunctionData(AERODROME_SELECTORS.stable)),
    client.call(poolAddress, encodeFunctionData(AERODROME_SELECTORS.factory)),
    client.call(
      AERODROME_VOTER,
      encodeFunctionData(AERODROME_SELECTORS.gauges, [encodeAddressArg(poolAddress)])
    )
  ]);
  const gaugeAddress = decodeAddress(gauge);
  const alive =
    !isNativeEthAsset(gaugeAddress) &&
    decodeUint256(
      await client.call(
        AERODROME_VOTER,
        encodeFunctionData(AERODROME_SELECTORS.isAlive, [encodeAddressArg(gaugeAddress)])
      )
    ) !== 0n;
  return {
    token0: decodeAddress(token0),
    token1: decodeAddress(token1),
    stable: decodeUint256(stableWord) !== 0n,
    factory: decodeAddress(factory),
    gauge: gaugeAddress,
    alive
  };
}

async function readAllowance(
  client: EvmRpcClient,
  token: string,
  owner: string,
  spender: string
): Promise<bigint> {
  const result = await client.call(
    token,
    encodeFunctionData(EVM_SELECTORS.allowance, [
      encodeAddressArg(owner),
      encodeAddressArg(spender)
    ])
  );
  return decodeUint256(result);
}

async function quoteAddLiquidity(
  client: EvmRpcClient,
  pool: AerodromePoolView,
  amountA: bigint,
  amountB: bigint
): Promise<AerodromeQuote> {
  const result = await client.call(
    AERODROME_ROUTER,
    encodeFunctionData(AERODROME_SELECTORS.quoteAddLiquidity, [
      encodeAddressArg(pool.token0),
      encodeAddressArg(pool.token1),
      encodeUint256Arg(pool.stable ? 1n : 0n),
      encodeAddressArg(AERODROME_POOL_FACTORY),
      encodeUint256Arg(amountA),
      encodeUint256Arg(amountB)
    ])
  );
  const words = decodeStaticWords(result, 3);
  return { amountA: words[0]!, amountB: words[1]!, liquidity: words[2]! };
}

async function quoteRemoveLiquidity(
  client: EvmRpcClient,
  pool: AerodromePoolView,
  liquidity: bigint
): Promise<Pick<AerodromeQuote, "amountA" | "amountB">> {
  const result = await client.call(
    AERODROME_ROUTER,
    encodeFunctionData(AERODROME_SELECTORS.quoteRemoveLiquidity, [
      encodeAddressArg(pool.token0),
      encodeAddressArg(pool.token1),
      encodeUint256Arg(pool.stable ? 1n : 0n),
      encodeAddressArg(AERODROME_POOL_FACTORY),
      encodeUint256Arg(liquidity)
    ])
  );
  const words = decodeStaticWords(result, 2);
  return { amountA: words[0]!, amountB: words[1]! };
}

function assertBasicAlivePool(pool: AerodromePoolView): void {
  if (normalizeEvmAddress(pool.factory) !== AERODROME_POOL_FACTORY) {
    throw new ShapeStateError("Aerodrome pool is not a basic factory pool.");
  }
  if (isNativeEthAsset(pool.token0) || isNativeEthAsset(pool.token1)) {
    throw new ShapeStateError("Aerodrome quotes do not wrap native ETH.");
  }
  if (!pool.alive || isNativeEthAsset(pool.gauge)) {
    throw new ShapeStateError("Aerodrome gauge is not alive.");
  }
}

function parsePoolAddress(raw: Record<string, unknown>): string {
  return parseEvmAddress(raw.poolId ?? raw.poolAddress, "poolId");
}

function parseSlippageBps(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_SLIPPAGE_BPS;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SLIPPAGE_BPS) {
    throw new InvalidShapeInputError(
      `slippageBps must be an integer from 0 to ${MAX_SLIPPAGE_BPS}.`
    );
  }
  return parsed;
}

function assertUserIsBeneficiary(
  raw: Record<string, unknown>,
  userAddress: string,
  action: string
): void {
  for (const field of ["to", "receiver", "owner"] as const) {
    const value = readOptionalEvmAddress(raw, field);
    if (value !== undefined && value !== userAddress) {
      throw new InvalidShapeInputError(
        `Aerodrome ${action} quotes require ${field} to equal userAddress.`
      );
    }
  }
}

function applySlippage(amount: bigint, slippageBps: number): bigint {
  const min = (amount * (BPS_SCALE - BigInt(slippageBps))) / BPS_SCALE;
  if (min <= 0n) {
    throw new ShapeStateError("Aerodrome slippage minimum rounded to zero.");
  }
  return min;
}

function quoteDeadline(context: ShapeBuildContext): bigint {
  const nowMs = context.now?.() ?? Date.now();
  return BigInt(Math.floor(nowMs / 1000) + DEADLINE_SECONDS);
}

function decodeStaticWords(hex: string, count: number): bigint[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length < count * 64) {
    throw new ShapeStateError("Aerodrome quote return data is too short.");
  }
  const words: bigint[] = [];
  for (let index = 0; index < count; index += 1) {
    words.push(BigInt(`0x${clean.slice(index * 64, (index + 1) * 64)}`));
  }
  return words;
}

export { BASE_CHAIN_ID };
