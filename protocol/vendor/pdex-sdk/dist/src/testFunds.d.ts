import { type SuggestedParams, type Transaction } from "algosdk";
export declare const TEST_FUNDS_RETURN_NOTE = "pex-test-funds-return-v1";
export interface TestFundsAlgoReturnInput {
    sender: string;
    receiver: string;
    amount: number | bigint | string;
    suggestedParams: SuggestedParams;
}
export interface TestFundsAssetOptInInput {
    sender: string;
    assetId: number | bigint | string;
    suggestedParams: SuggestedParams;
}
export declare function buildTestFundsAssetOptInTransaction(input: TestFundsAssetOptInInput): Transaction;
export declare function buildTestFundsAlgoReturnTransaction(input: TestFundsAlgoReturnInput): Transaction;
//# sourceMappingURL=testFunds.d.ts.map