import algosdk, { Algodv2, AtomicTransactionComposer, makeEmptyTransactionSigner } from "algosdk";

import { ShapeBuildError, ShapeStateError } from "../../errors.js";
import { HAYSTACK_LAUNCH_APP_CALL_MAX_FEE, HAYSTACK_LAUNCH_APP_ID } from "./launch-constants.js";
import { decodeAssetMapTokenNum, decodeTokenInfoBox, type HaystackLaunchTokenInfo } from "./launch-codec.js";
import { parseIndexedLaunches, type IndexedTokenLaunch } from "./launch-indexer.js";
import { assetBoxName, tokenBoxName } from "./launch-spec.js";

export async function readTokenInfoBox(
  algod: Algodv2,
  tokenNum: number,
  appId = HAYSTACK_LAUNCH_APP_ID
): Promise<HaystackLaunchTokenInfo | null> {
  const value = await readBox(algod, appId, tokenBoxName(tokenNum));
  if (value === null) {
    return null;
  }
  try {
    return decodeTokenInfoBox(value);
  } catch (error) {
    throw new ShapeStateError("Failed to decode HayLaunch token box.", {
      details: { appId, tokenNum },
      cause: error
    });
  }
}

export async function readTokenNumForAsset(
  algod: Algodv2,
  assetId: number,
  appId = HAYSTACK_LAUNCH_APP_ID
): Promise<number | null> {
  const value = await readBox(algod, appId, assetBoxName(assetId));
  if (value === null) {
    return null;
  }
  return decodeAssetMapTokenNum(value);
}

export async function readLaunchGlobal(
  algod: Algodv2,
  appId = HAYSTACK_LAUNCH_APP_ID
): Promise<{
  bondingUsd: bigint;
  priceMultiplier: bigint;
  oracleAppId: number;
  nextTokenNum: number;
}> {
  const application = await algod.getApplicationByID(appId).do();
  const params = application.params;
  if (params === undefined) {
    throw new ShapeStateError("HayLaunch application params were missing.", {
      details: { appId }
    });
  }
  const values = new Map<string, bigint>();
  for (const entry of params.globalState ?? []) {
    const key = Buffer.from(entry.key).toString("utf8");
    values.set(key, BigInt(entry.value.uint ?? 0));
  }
  const bondingUsd = values.get("bondingUsd");
  if (bondingUsd === undefined) {
    throw new ShapeStateError("Application is not HayLaunch (missing bondingUsd).", {
      details: { appId }
    });
  }
  return {
    bondingUsd,
    priceMultiplier: values.get("priceMult") ?? 20_000_000_000n,
    oracleAppId: Number(values.get("oracleAppId") ?? 0n),
    nextTokenNum: Number(values.get("nextTokenNum") ?? 0n)
  };
}

export async function simulateLaunchAbi(params: {
  algod: Algodv2;
  method: algosdk.ABIMethod;
  methodArgs?: algosdk.ABIArgument[];
  appId?: number;
  sender?: string;
}): Promise<unknown> {
  const appId = params.appId ?? HAYSTACK_LAUNCH_APP_ID;
  const suggestedParams = await params.algod.getTransactionParams().do();
  // Readonly helpers such as previewBonding submit an inner call. The default
  // 1000 microALGO fee does not cover that inner transaction.
  suggestedParams.fee = HAYSTACK_LAUNCH_APP_CALL_MAX_FEE;
  suggestedParams.flatFee = true;
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: appId,
    method: params.method,
    methodArgs: params.methodArgs ?? [],
    sender: params.sender ?? algosdk.getApplicationAddress(appId),
    signer: makeEmptyTransactionSigner(),
    suggestedParams
  });
  const response = await atc.simulate(
    params.algod,
    new algosdk.modelsv2.SimulateRequest({
      txnGroups: [],
      allowEmptySignatures: true,
      allowUnnamedResources: true
    })
  );
  const methodResult = response.methodResults[0];
  if (methodResult?.decodeError || methodResult?.returnValue === undefined) {
    throw new ShapeBuildError(`HayLaunch ${params.method.name} simulate failed.`, {
      details: {
        method: params.method.name,
        decodeError: methodResult?.decodeError?.message
      }
    });
  }
  return methodResult.returnValue;
}

export async function searchIndexedLaunches(params: {
  indexer: algosdk.Indexer;
  afterIso: string;
  beforeIso: string;
  appId?: number;
  maxPages?: number;
}): Promise<IndexedTokenLaunch[]> {
  const appId = params.appId ?? HAYSTACK_LAUNCH_APP_ID;
  const launches: IndexedTokenLaunch[] = [];
  let nextToken: string | undefined;
  const maxPages = params.maxPages ?? 20;
  for (let page = 0; page < maxPages; page += 1) {
    let request = params.indexer
      .searchForTransactions()
      .applicationID(appId)
      .txType("appl")
      .afterTime(params.afterIso)
      .beforeTime(params.beforeIso)
      .limit(1000);
    if (nextToken) {
      request = request.nextToken(nextToken);
    }
    const response = await request.do();
    launches.push(...parseIndexedLaunches(response.transactions ?? []));
    nextToken = response.nextToken;
    if (!nextToken) {
      return launches;
    }
  }
  throw new ShapeStateError("HayLaunch indexer window exceeded the page cap.", {
    details: { appId, maxPages }
  });
}

async function readBox(
  algod: Algodv2,
  appId: number,
  name: Uint8Array
): Promise<Uint8Array | null> {
  try {
    const box = await algod.getApplicationBoxByName(appId, name).do();
    return box.value;
  } catch (error) {
    if (isBoxNotFound(error)) {
      return null;
    }
    throw new ShapeStateError("Failed to read HayLaunch box.", {
      details: { appId },
      cause: error
    });
  }
}

function isBoxNotFound(error: unknown): boolean {
  const status = (error as { status?: number; statusCode?: number } | undefined) ?? undefined;
  if (status?.status === 404 || status?.statusCode === 404) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("box not found") || message.includes("no application box");
}
