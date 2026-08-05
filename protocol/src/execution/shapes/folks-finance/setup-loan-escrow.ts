import { Account, Algodv2, SuggestedParams, Transaction } from "algosdk";
import { MainnetLoans, prepareCreateUserLoan } from "@folks-finance/algorand-sdk";

import { InvalidShapeInputError, ShapeBuildError } from "../../errors.js";
import { normalizeTransactions } from "../../normalize-transaction.js";
import {
  ShapeBuildContext,
  ShapeBuildResult,
  ShapeValidationResult,
  TransactionShapeIdentity,
  TransactionShapeSpec,
  buildShapeKey
} from "../../types.js";
import { FOLKS_GENERAL_LOAN_APP_ID, parseAddress, parseLoanAppId } from "./parse-input.js";
import {
  createFolksBuilderAlgodClient,
  getFolksBuilderAlgodSdk,
  getSuggestedParams
} from "./pool-state.js";

const USER_LOAN_ESCROW_SETUP_FEE = 2000n;
const ESCROW_APP_OPT_IN_MIN_BALANCE = 250_000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "setup",
  variant: "loanEscrow"
};

export interface FolksSetupLoanEscrowInput {
  userAddress: string;
  loanAppId: number;
}

export interface FolksSetupLoanEscrowState {
  loanAppId: number;
}

export interface FolksSetupLoanEscrowDependencies {
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareCreateUserLoan: typeof prepareCreateUserLoan;
  defaultLoanAppId: number;
}

let dependencyOverrides: Partial<FolksSetupLoanEscrowDependencies> | undefined;

export function setFolksSetupLoanEscrowDependenciesForTests(
  overrides?: Partial<FolksSetupLoanEscrowDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksSetupLoanEscrowDependencies {
  return {
    getSuggestedParams,
    prepareCreateUserLoan,
    defaultLoanAppId: MainnetLoans.GENERAL ?? FOLKS_GENERAL_LOAN_APP_ID,
    ...dependencyOverrides
  };
}

export const folksFinanceSetupLoanEscrowShape: TransactionShapeSpec<
  FolksSetupLoanEscrowInput,
  FolksSetupLoanEscrowState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.0.0",
  title: "Folks Finance v2 create loan escrow",
  description:
    "Creates and funds a new Folks Finance loan escrow for the user. Returns a " +
    "3-transaction group that must be signed by both the user and the generated escrow account. " +
    "loanAppId defaults to MainnetLoans.GENERAL.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress"],
  sources: [
    {
      kind: "sdk",
      description: "@folks-finance/algorand-sdk prepareCreateUserLoan"
    }
  ],

  parseInput(raw: unknown): FolksSetupLoanEscrowInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseAddress(value.userAddress),
      loanAppId: parseLoanAppId(value.loanAppId)
    };
  },

  async resolveState(
    _context: ShapeBuildContext,
    input: FolksSetupLoanEscrowInput
  ): Promise<FolksSetupLoanEscrowState> {
    return { loanAppId: input.loanAppId };
  },

  async build(
    _context: ShapeBuildContext,
    input: FolksSetupLoanEscrowInput,
    state: FolksSetupLoanEscrowState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings = [
      "Store escrowPrivateKeyBase64 securely; it is required to sign the escrow transaction in this group.",
      "The group funds the recoverable 0.25 ALGO minimum balance required by the loan escrow app opt-in.",
      "After this setup confirms, run setup:addCollateral before depositing fAssets and syncing collateral."
    ];

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks loan escrow setup.", {
        cause: error
      });
    }

    let result: { txns: Transaction[]; escrow: Account };
    try {
      result = dependencies.prepareCreateUserLoan(
        state.loanAppId,
        input.userAddress,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance create-loan-escrow group.", {
        cause: error
      });
    }

    const builderAlgosdk = getFolksBuilderAlgodSdk();
    const fundEscrowTxn = builderAlgosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: input.userAddress,
      receiver: result.escrow.addr.toString(),
      amount: ESCROW_APP_OPT_IN_MIN_BALANCE,
      suggestedParams: {
        ...params,
        flatFee: true,
        fee: 1000
      }
    });
    const groupTxns = [fundEscrowTxn as unknown as Transaction, ...result.txns];
    builderAlgosdk.assignGroupID(groupTxns);
    const transactions = normalizeTransactions(groupTxns);

    return {
      transactions,
      warnings,
      metadata: {
        loanAppId: state.loanAppId,
        escrowAddress: result.escrow.addr.toString(),
        escrowPrivateKeyBase64: Buffer.from(result.escrow.sk).toString("base64")
      }
    };
  },

  validate(
    group,
    input: FolksSetupLoanEscrowInput,
    state: FolksSetupLoanEscrowState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 3) {
      errors.push(`Expected exactly 3 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [fundingTxn, userTxn, escrowTxn] = group;
    if (fundingTxn === undefined || fundingTxn.type !== "pay" || !fundingTxn.payment) {
      errors.push("First transaction must fund the generated loan escrow.");
    } else {
      if (fundingTxn.sender !== input.userAddress) {
        errors.push("Escrow funding transaction sender must be the user address.");
      }
      if (BigInt(fundingTxn.payment.amount) < ESCROW_APP_OPT_IN_MIN_BALANCE) {
        errors.push(
          `Escrow funding amount must be at least ${ESCROW_APP_OPT_IN_MIN_BALANCE.toString()} microAlgos.`
        );
      }
      if (escrowTxn !== undefined && fundingTxn.payment.receiver !== escrowTxn.sender) {
        errors.push("Escrow funding receiver must match the escrow opt-in sender.");
      }
    }

    if (userTxn === undefined) {
      errors.push("Missing user registration transaction.");
    } else if (userTxn.sender !== input.userAddress) {
      errors.push("Second transaction sender must be the user address.");
    } else if (BigInt(userTxn.fee) < USER_LOAN_ESCROW_SETUP_FEE) {
      errors.push(
        `Second transaction fee must be at least ${USER_LOAN_ESCROW_SETUP_FEE.toString()} microAlgos.`
      );
    }

    if (escrowTxn === undefined || escrowTxn.type !== "appl" || !escrowTxn.applicationCall) {
      errors.push("Third transaction must be the loan escrow opt-in application call.");
    } else {
      if (escrowTxn.applicationCall.appIndex !== String(state.loanAppId)) {
        errors.push("Escrow opt-in must target the Folks loan application.");
      }
      if (escrowTxn.sender === input.userAddress) {
        errors.push("Escrow opt-in sender must be the generated escrow address, not the user.");
      }
    }

    if (group.some((txn) => !txn.groupPresent)) {
      errors.push("All transactions must belong to a single atomic group.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
};
