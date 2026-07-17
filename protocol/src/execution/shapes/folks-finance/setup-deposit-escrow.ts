import { Account, Algodv2, SuggestedParams, Transaction } from "algosdk";
import { prepareAddDepositEscrowToDeposits } from "@folks-finance/algorand-sdk";

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
import { parseAddress } from "./parse-input.js";
import {
  MainnetDepositsAppId,
  createFolksBuilderAlgodClient,
  getFolksBuilderAlgodSdk,
  getDepositsAppAddress,
  getSuggestedParams
} from "./pool-state.js";

const USER_ESCROW_SETUP_FEE = 2000n;
const ESCROW_APP_OPT_IN_MIN_BALANCE = 250_000n;

const IDENTITY: TransactionShapeIdentity = {
  network: "mainnet",
  protocol: "folks-finance",
  protocolVersion: "v2",
  action: "setup",
  variant: "depositEscrow"
};

export interface FolksSetupDepositEscrowInput {
  userAddress: string;
}

export interface FolksSetupDepositEscrowState {
  depositsAppId: number;
  depositsAppAddress: string;
}

export interface FolksSetupDepositEscrowBuildMetadata {
  escrowAddress: string;
  escrowPrivateKeyBase64: string;
}

export interface FolksSetupDepositEscrowDependencies {
  getSuggestedParams: (algod: Algodv2) => Promise<SuggestedParams>;
  prepareAddDepositEscrowToDeposits: typeof prepareAddDepositEscrowToDeposits;
  mainnetDepositsAppId: number;
}

let dependencyOverrides: Partial<FolksSetupDepositEscrowDependencies> | undefined;

export function setFolksSetupDepositEscrowDependenciesForTests(
  overrides?: Partial<FolksSetupDepositEscrowDependencies>
): void {
  dependencyOverrides = overrides;
}

function resolveDependencies(): FolksSetupDepositEscrowDependencies {
  return {
    getSuggestedParams,
    prepareAddDepositEscrowToDeposits,
    mainnetDepositsAppId: MainnetDepositsAppId,
    ...dependencyOverrides
  };
}

export const folksFinanceSetupDepositEscrowShape: TransactionShapeSpec<
  FolksSetupDepositEscrowInput,
  FolksSetupDepositEscrowState
> = {
  identity: IDENTITY,
  key: buildShapeKey(IDENTITY),
  shapeVersion: "1.1.0",
  title: "Folks Finance v2 add deposit escrow",
  description:
    "Creates and funds a new Folks Finance deposit escrow for the user. Returns a " +
    "3-transaction group that must be signed by both the user and the generated escrow account.",
  supportedOpportunityTypes: ["lending"],
  opportunityRole: "enter",
  requiredInputs: ["userAddress"],
  sources: [
    {
      kind: "sdk",
      description: "@folks-finance/algorand-sdk prepareAddDepositEscrowToDeposits"
    },
    {
      kind: "docs",
      description: "Folks Finance recoverable deposit escrow minimum-balance funding",
      url: "https://docs.folks.finance/introduction/need-help/fees"
    }
  ],

  parseInput(raw: unknown): FolksSetupDepositEscrowInput {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidShapeInputError("Shape input must be an object.");
    }
    const value = raw as Record<string, unknown>;
    return {
      userAddress: parseAddress(value.userAddress)
    };
  },

  async resolveState(
    _context: ShapeBuildContext,
    _input: FolksSetupDepositEscrowInput
  ): Promise<FolksSetupDepositEscrowState> {
    const dependencies = resolveDependencies();
    return {
      depositsAppId: dependencies.mainnetDepositsAppId,
      depositsAppAddress: getDepositsAppAddress(dependencies.mainnetDepositsAppId)
    };
  },

  async build(
    _context: ShapeBuildContext,
    input: FolksSetupDepositEscrowInput,
    state: FolksSetupDepositEscrowState
  ): Promise<ShapeBuildResult> {
    const dependencies = resolveDependencies();
    const warnings = [
      "Store escrowPrivateKeyBase64 securely; it is required to sign the escrow transaction in this group.",
      "The group funds the recoverable 0.25 ALGO minimum balance required by the escrow app opt-in.",
      "After this setup confirms, run setup:optEscrowAsset before deposit:escrow for a specific pool."
    ];

    let params: SuggestedParams;
    try {
      params = await dependencies.getSuggestedParams(createFolksBuilderAlgodClient());
    } catch (error) {
      throw new ShapeBuildError("Failed to fetch suggested params for Folks escrow setup.", {
        cause: error
      });
    }

    let result: { txns: Transaction[]; escrow: Account };
    try {
      result = dependencies.prepareAddDepositEscrowToDeposits(
        state.depositsAppId,
        input.userAddress,
        params
      );
    } catch (error) {
      throw new ShapeBuildError("Failed to generate Folks Finance add-deposit-escrow group.", {
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
        depositsAppId: state.depositsAppId,
        depositsAppAddress: state.depositsAppAddress,
        escrowAddress: result.escrow.addr.toString(),
        escrowPrivateKeyBase64: Buffer.from(result.escrow.sk).toString("base64")
      }
    };
  },

  validate(
    group,
    input: FolksSetupDepositEscrowInput,
    state: FolksSetupDepositEscrowState
  ): ShapeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (group.length !== 3) {
      errors.push(`Expected exactly 3 transactions, received ${group.length}.`);
      return { valid: false, errors, warnings };
    }

    const [fundingTxn, userTxn, escrowTxn] = group;
    if (fundingTxn === undefined || fundingTxn.type !== "pay" || !fundingTxn.payment) {
      errors.push("First transaction must fund the generated escrow.");
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
    } else if (BigInt(userTxn.fee) < USER_ESCROW_SETUP_FEE) {
      errors.push(
        `Second transaction fee must be at least ${USER_ESCROW_SETUP_FEE.toString()} microAlgos.`
      );
    }

    if (escrowTxn === undefined || escrowTxn.type !== "appl" || !escrowTxn.applicationCall) {
      errors.push("Third transaction must be the escrow opt-in application call.");
    } else {
      if (escrowTxn.applicationCall.appIndex !== String(state.depositsAppId)) {
        errors.push("Escrow opt-in must target the Folks deposits application.");
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
