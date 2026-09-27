import algosdk from "algosdk";

import { ShapeStateError } from "../../errors.js";
import {
  MALLOW_BUILDER_FEE_BPS,
  MALLOW_PDEX_ARTIFACT_URL_DEFAULT,
  MALLOW_PDEX_PROXY_URL_DEFAULT
} from "./constants.js";

export interface MallowBuilderFee {
  builderAddress: string;
  builderFeeBps: bigint;
}

export interface MallowPdexConfig {
  proxyUrl: string;
  artifactUrl: string;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function mallowPdexConfig(): MallowPdexConfig {
  return {
    proxyUrl: trimSlash(readEnv("MALLOW_PDEX_PROXY_URL") ?? MALLOW_PDEX_PROXY_URL_DEFAULT),
    artifactUrl: trimSlash(readEnv("MALLOW_PDEX_ARTIFACT_URL") ?? MALLOW_PDEX_ARTIFACT_URL_DEFAULT)
  };
}

/**
 * Builder fee attached to every PEX quote and order group.
 * Production refuses to compile when the address is missing or invalid.
 * Tests and local dev may omit it.
 */
export function mallowBuilderFee(env: NodeJS.ProcessEnv = process.env): MallowBuilderFee | undefined {
  const address = env.MALLOW_BUILDER_ADDRESS?.trim();
  const production = env.NODE_ENV === "production";
  if (!address) {
    if (production) {
      throw new ShapeStateError("Mallow builder address is not configured.", {
        details: { reason: "builder-unconfigured" }
      });
    }
    return undefined;
  }
  if (!algosdk.isValidAddress(address)) {
    throw new ShapeStateError("Mallow builder address is invalid.", {
      details: { reason: "builder-unconfigured" }
    });
  }
  return { builderAddress: address, builderFeeBps: MALLOW_BUILDER_FEE_BPS };
}

/** SDK object plus the snake_case aliases Mallow already sends on quote calls. */
export function quoteBuilderFields(
  builder: MallowBuilderFee | undefined
): Record<string, unknown> {
  if (!builder) {
    return {};
  }
  return {
    builderFee: {
      builderAddress: builder.builderAddress,
      builderFeeBps: builder.builderFeeBps
    },
    builder_address: builder.builderAddress,
    builder_fee_bps: builder.builderFeeBps
  };
}
