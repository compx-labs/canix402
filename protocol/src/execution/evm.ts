import { ShapeStateError } from "./errors.js";
import type { EvmRpcClient, ShapeBuildContext } from "./types.js";

export const BASE_CHAIN_ID = 8453;
export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const NATIVE_ETH_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const EVM_SELECTORS = {
  approve: "095ea7b3",
  allowance: "dd62ed3e",
  deposit: "6e553f65",
  withdraw: "b460af94",
  redeem: "ba087652",
  previewDeposit: "ef8b30f7",
  previewWithdraw: "0a28a477",
  previewRedeem: "4cdad506",
  asset: "38d52e0f"
} as const;

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function isEvmAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

export function normalizeEvmAddress(value: string): string {
  return value.toLowerCase();
}

export function isNativeEthAsset(address: string): boolean {
  const normalized = normalizeEvmAddress(address);
  return normalized === ZERO_ADDRESS || normalized === NATIVE_ETH_SENTINEL;
}

export function encodeAddressArg(address: string): string {
  return normalizeEvmAddress(address).replace(/^0x/, "").padStart(64, "0");
}

export function encodeUint256Arg(value: bigint): string {
  if (value < 0n) {
    throw new Error("uint256 cannot be negative.");
  }
  return value.toString(16).padStart(64, "0");
}

export function encodeFunctionData(selector: string, args: string[] = []): string {
  return `0x${selector.replace(/^0x/, "")}${args.join("")}`;
}

export function decodeUint256(hex: string): bigint {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0) {
    return 0n;
  }
  return BigInt(`0x${clean}`);
}

export function decodeAddress(hex: string): string {
  const clean = (hex.startsWith("0x") ? hex.slice(2) : hex).padStart(64, "0");
  return `0x${clean.slice(24).toLowerCase()}`;
}

export function requireEvmClient(context: ShapeBuildContext): EvmRpcClient {
  if (!context.evm) {
    throw new ShapeStateError(
      "Base RPC client is required for Morpho quotes. Set BASE_RPC_URL."
    );
  }
  return context.evm;
}

export function createBaseEvmClient(
  rpcUrl: string = process.env.BASE_RPC_URL ?? DEFAULT_BASE_RPC_URL,
  fetchImpl: typeof fetch = fetch
): EvmRpcClient {
  const endpoint = rpcUrl.trim() || DEFAULT_BASE_RPC_URL;

  return {
    chainId: BASE_CHAIN_ID,
    async call(to: string, data: string): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_call",
            params: [{ to, data }, "latest"]
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new ShapeStateError(
            `Base RPC returned non-2xx status: ${response.status}.`
          );
        }
        const payload = (await response.json()) as {
          result?: string;
          error?: { message?: string };
        };
        if (typeof payload.result === "string" && payload.result.length > 0) {
          return payload.result;
        }
        throw new ShapeStateError(
          payload.error?.message ?? "Base RPC eth_call returned no result."
        );
      } catch (error) {
        if (error instanceof ShapeStateError) {
          throw error;
        }
        throw new ShapeStateError("Base RPC eth_call failed.", { cause: error });
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function attachEvmContextIfNeeded(
  shapeKey: string,
  context: ShapeBuildContext
): ShapeBuildContext {
  if (!shapeKey.startsWith("base:")) {
    return context;
  }
  return {
    ...context,
    evm: context.evm ?? createBaseEvmClient()
  };
}
