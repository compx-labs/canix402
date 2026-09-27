export declare const XALGO_PROPOSER_BOX_NAME: Uint8Array<ArrayBuffer>;
export declare const V2_YIELD_STRATEGY_KIND_NONE = 0;
export declare const V2_YIELD_STRATEGY_KIND_FOLKS_LENDING = 1;
export declare const V2_YIELD_STRATEGY_KIND_XALGO_CONSENSUS = 2;
export declare const V2_YIELD_STATUS_DISABLED = 0;
export declare const V2_YIELD_STATUS_NORMAL = 1;
export declare const V2_YIELD_STATUS_RECALL_ONLY = 2;
export declare const V2_YIELD_STATUS_EMERGENCY = 3;
export declare const V2_YIELD_STATUS_RESERVED = 4;
export interface XAlgoConsensusState {
    consensusAppId: number;
    numProposers: number;
    feeBps: number;
    premiumRaw: bigint;
    premiumBps: number;
    canImmediateMint: boolean;
    canDelayMint: boolean;
    proposers: string[];
}
export declare function parseXalgoProposerBox(value: Uint8Array): string[];
export declare function loadXalgoConsensusState(algodClient: unknown, consensusAppId: number): Promise<XAlgoConsensusState>;
//# sourceMappingURL=externalYield.d.ts.map