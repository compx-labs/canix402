import { type Transaction } from "algosdk";
import { type AccountSessionResponse, type DeploymentState, type PdexApiClient, type PdexApiClientOptions, type V2MarketSummaryResponse, type V2SdkBootstrapState, type V2SdkResourcesState } from "./api.js";
import { type ProtocolManifest } from "./manifest.js";
import { type PdexMarket, type PdexMarketSummary } from "./readModels.js";
import { type Receipt } from "./receipts.js";
import { type PdexV2AppRefs, type V2MarketAssetRefs, type V2TransactionGroupResult } from "./transactions.js";
export interface LoadPdexContextOptions extends PdexApiClientOptions {
    network: string;
}
export interface PdexContext {
    client: PdexApiClient;
    protocol: ProtocolManifest;
    deployment: DeploymentState;
    bootstrap: V2SdkBootstrapState;
    resources: V2SdkResourcesState;
    marketSummary: V2MarketSummaryResponse;
    appIds: Record<string, number>;
    assets: Record<string, number>;
    appRefs: PdexV2AppRefs;
    markets: PdexMarket[];
    pools: PdexMarketSummary["pools"];
    catalog: PdexMarketSummary["catalog"];
    indexedRound?: number;
}
export declare function loadPdexContext(options: LoadPdexContextOptions): Promise<PdexContext>;
export declare function resolvePdexV2AppRefs(appIds: Record<string, number>, manifest?: ProtocolManifest): PdexV2AppRefs;
export declare function pdexMarketAssetRefs(market: Pick<PdexMarket, "indexAssetId" | "longAssetId" | "shortAssetId">): V2MarketAssetRefs;
export interface AuthorizePdexAccountInput {
    client: PdexApiClient;
    address: string;
    network: string;
    genesisId: string;
    genesisHash: string;
    origin: string;
    signMessage: (message: Uint8Array) => Uint8Array | string | Promise<Uint8Array | string>;
    audience?: string;
    scopes?: readonly string[];
    nonce?: string;
    issuedAt?: number;
    lifetimeSeconds?: number;
}
export interface AuthorizedPdexAccount {
    message: string;
    session: AccountSessionResponse;
}
export declare function authorizePdexAccount(input: AuthorizePdexAccountInput): Promise<AuthorizedPdexAccount>;
export type PdexSubmitPhase = "signing" | "submitting" | "confirming" | "confirmed" | "failed";
export interface PdexSubmitProgress {
    phase: PdexSubmitPhase;
    txId?: string;
    error?: unknown;
}
export interface PdexAlgodSubmitClient {
    sendRawTransaction(signedTransactions: Uint8Array[] | Uint8Array): {
        do(): Promise<unknown>;
    };
    pendingTransactionInformation(txId: string): {
        do(): Promise<unknown>;
    };
    status(): {
        do(): Promise<unknown>;
    };
    statusAfterBlock(round: number | bigint): {
        do(): Promise<unknown>;
    };
}
export interface SubmitPdexTransactionGroupInput {
    transactions: Transaction[];
    algod: PdexAlgodSubmitClient;
    signTransactions: (transactions: Transaction[], indexes: number[]) => unknown[] | Promise<unknown[]>;
    waitRounds?: number;
    onProgress?: (progress: PdexSubmitProgress) => void | Promise<void>;
}
export interface SubmittedPdexTransactionGroup {
    txId: string;
    confirmedRound?: number;
    receipt?: Receipt;
    confirmation: Record<string, unknown>;
    group: V2TransactionGroupResult;
}
export declare function submitPdexTransactionGroup(input: SubmitPdexTransactionGroupInput): Promise<SubmittedPdexTransactionGroup>;
export declare function normalizeSignedTransactionBytes(value: unknown): Uint8Array | undefined;
//# sourceMappingURL=integration.d.ts.map