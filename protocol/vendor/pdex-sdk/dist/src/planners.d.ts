import { type AppCallDescriptor, type BigNumberish } from "./transactions.js";
export type PlannerBuilder = (input: any) => AppCallDescriptor;
export declare const v2PlannerBuilders: Record<string, PlannerBuilder>;
export interface PlannerFailure {
    ok: false;
    code: string;
    message: string;
    details: Record<string, unknown>;
}
export interface PlannerSuccess {
    ok: true;
    flow: string;
    descriptor: AppCallDescriptor;
    transactionCount: number;
    resourceManifest: Record<string, unknown>;
    route?: Record<string, unknown>;
    warnings: string[];
}
export type PlannerResult = PlannerFailure | PlannerSuccess;
export declare function plannerFailure(code: string, message?: string, details?: Record<string, unknown>): PlannerFailure;
export declare function plannerOk(flow: string, descriptor: AppCallDescriptor, route?: Record<string, unknown>, warnings?: string[]): PlannerSuccess;
export declare function validatePlannedDescriptor(descriptor: AppCallDescriptor): PlannerFailure | {
    ok: true;
};
export declare function planV2Flow(flow: string, input: Record<string, unknown>): PlannerResult;
export declare function planV2CvaWithdraw(input: {
    sender: string;
    vaultId: BigNumberish;
    shareAmount: BigNumberish;
    stateSnapshot: Record<string, unknown>;
    resources: Record<string, unknown>;
    oraclePayload: Record<string, unknown>;
    preferredMarketId?: BigNumberish;
    minLongAmount?: BigNumberish;
    minShortAmount?: BigNumberish;
    yieldRecallMode?: BigNumberish;
    maxLongReceiptAmount?: BigNumberish;
    maxShortReceiptAmount?: BigNumberish;
    marketYieldRecallCount?: BigNumberish;
}): PlannerResult;
//# sourceMappingURL=planners.d.ts.map