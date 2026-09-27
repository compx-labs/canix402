import {
  connectBaseWallet,
  disconnectBaseWallet,
  listBaseWalletChoices,
  type BaseWalletChoiceRow
} from "./base-wallet";
import {
  connectWebmcpWallet,
  disconnectWebmcpWallet,
  listWebmcpWallets,
  WEBMCP_WALLET_IDS,
  type WebmcpWalletId
} from "./wallet";

export type CheckoutNetwork = "algorand" | "base";

const NETWORK_STORAGE_KEY = "canix402.webmcp.network";

const CHECKOUT_ERROR_COPY: Record<string, string> = {
  WALLET_REQUIRED: "Connect a wallet before paying.",
  WALLET_CONNECT_FAILED: "Wallet connection was rejected.",
  WALLET_UNAVAILABLE: "That wallet is not available in this browser.",
  PAYMENT_REJECTED: "The wallet rejected the USDC payment.",
  PAYMENT_FAILED: "The USDC payment was not accepted. No session was created.",
  PAYMENT_INVALID: "The payment request was invalid.",
  SESSION_EXPIRED: "Your session has expired. Refresh it to keep going.",
  SESSION_EXHAUSTED: "Your session quota is used up. Refresh the session to continue.",
  SESSION_REQUIRED: "Buy a session to use this tool.",
  SESSION_INVALID: "This session is no longer valid. Buy a new one.",
  HUMAN_CHECKOUT_REQUIRED: "Buy or refresh a session with the connected wallet."
};

export function describeCheckoutError(code: string, message?: string): string {
  const known = CHECKOUT_ERROR_COPY[code];
  if (known) {
    return known;
  }
  if (message && message !== code) {
    return message;
  }
  return "Something went wrong. Try again.";
}

export function humanConnectError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Wallet connection was rejected.";
  if (/reject|denied|cancel/i.test(message)) {
    return "Connection rejected in the wallet.";
  }
  if (/chain|wrong network|switch/i.test(message)) {
    return "Wrong network. Switch the wallet to Base and try again.";
  }
  return message;
}

export function lastCheckoutNetwork(): CheckoutNetwork | null {
  try {
    const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
    return stored === "algorand" || stored === "base" ? stored : null;
  } catch {
    return null;
  }
}

export function rememberCheckoutNetwork(network: CheckoutNetwork): void {
  try {
    localStorage.setItem(NETWORK_STORAGE_KEY, network);
  } catch {
    // Private mode can block storage. The choice still applies to this connect.
  }
}

export async function connectRail(network: CheckoutNetwork, walletId: string): Promise<string> {
  if (network === "base") {
    await disconnectWebmcpWallet();
    return connectBaseWallet(walletId);
  }
  if (!WEBMCP_WALLET_IDS.includes(walletId as WebmcpWalletId)) {
    throw Object.assign(new Error("That Algorand wallet is not available."), {
      code: "WALLET_UNAVAILABLE"
    });
  }
  await disconnectBaseWallet();
  return connectWebmcpWallet(walletId as WebmcpWalletId);
}

interface WalletRow {
  id: string;
  name: string;
  icon?: string;
  detected: boolean;
  installUrl?: string;
}

export function mountConnectModal(options: {
  onConnected: (result: { network: CheckoutNetwork; address: string; walletName: string }) => void;
}): { open: (preferred?: CheckoutNetwork) => void; close: () => void } {
  const dialog = document.querySelector<HTMLDialogElement>("[data-connect-modal]");
  const networkStep = dialog?.querySelector<HTMLElement>("[data-modal-step='network']");
  const walletStep = dialog?.querySelector<HTMLElement>("[data-modal-step='wallet']");
  const title = dialog?.querySelector<HTMLElement>("[data-modal-title]");
  const list = dialog?.querySelector<HTMLElement>("[data-wallet-list]");
  const errorEl = dialog?.querySelector<HTMLElement>("[data-modal-error]");
  const walletCopy = dialog?.querySelector<HTMLElement>("[data-wallet-step-copy]");

  const noop = { open: () => undefined, close: () => undefined };
  if (!dialog || !networkStep || !walletStep || !list) {
    return noop;
  }

  let connecting = false;

  const showError = (message: string): void => {
    if (!errorEl) {
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  };

  const clearError = (): void => {
    if (!errorEl) {
      return;
    }
    errorEl.hidden = true;
    errorEl.textContent = "";
  };

  const showNetworkStep = (): void => {
    networkStep.hidden = false;
    walletStep.hidden = true;
    if (title) {
      title.textContent = "Connect a wallet";
    }
    clearError();
    const remembered = lastCheckoutNetwork();
    dialog.querySelectorAll<HTMLButtonElement>("[data-network]").forEach((button) => {
      button.classList.toggle("is-last", button.dataset.network === remembered);
    });
  };

  const rowsFor = (network: CheckoutNetwork): WalletRow[] => {
    if (network === "algorand") {
      return listWebmcpWallets().map((wallet) => ({
        id: wallet.id,
        name: wallet.name,
        icon: wallet.icon,
        detected: true
      }));
    }
    return listBaseWalletChoices().map((wallet) => baseRow(wallet));
  };

  const showWalletStep = (network: CheckoutNetwork): void => {
    networkStep.hidden = true;
    walletStep.hidden = false;
    if (title) {
      title.textContent = network === "base" ? "Base wallets" : "Algorand wallets";
    }
    if (walletCopy) {
      walletCopy.textContent =
        network === "base"
          ? "Pay USDC on Base. Wallets that are not installed stay listed so you can add one."
          : "Pay USDC on Algorand. Pera and Defly open on this device or on your phone.";
    }
    clearError();
    list.replaceChildren();
    for (const wallet of rowsFor(network)) {
      list.append(walletOption(network, wallet));
    }
  };

  const walletOption = (network: CheckoutNetwork, wallet: WalletRow): HTMLElement => {
    const row = document.createElement("div");
    row.className = "webmcp-wallet-option";

    if (wallet.icon) {
      const icon = document.createElement("img");
      icon.src = wallet.icon;
      icon.alt = "";
      icon.width = 28;
      icon.height = 28;
      row.append(icon);
    } else {
      const mark = document.createElement("span");
      mark.className = "webmcp-wallet-mark";
      mark.textContent = wallet.name.slice(0, 1);
      row.append(mark);
    }

    const label = document.createElement("span");
    label.className = "webmcp-wallet-option-name";
    label.textContent = wallet.name;
    row.append(label);

    if (!wallet.detected) {
      const status = document.createElement("span");
      status.className = "muted webmcp-wallet-option-status";
      status.textContent = "Not detected";
      row.append(status);
      if (wallet.installUrl) {
        const link = document.createElement("a");
        link.href = wallet.installUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Install";
        row.append(link);
      }
      return row;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-small";
    button.textContent = "Connect";
    button.addEventListener("click", () => {
      void connectFromRow(network, wallet, row, button);
    });
    row.append(button);
    return row;
  };

  const connectFromRow = async (
    network: CheckoutNetwork,
    wallet: WalletRow,
    row: HTMLElement,
    button: HTMLButtonElement
  ): Promise<void> => {
    if (connecting) {
      return;
    }
    connecting = true;
    clearError();
    dialog.setAttribute("aria-busy", "true");
    list.querySelectorAll<HTMLButtonElement>("button").forEach((item) => {
      item.disabled = true;
    });
    row.classList.add("is-connecting");
    button.textContent = "Approve in your wallet…";
    const spinner = document.createElement("span");
    spinner.className = "webmcp-spinner";
    spinner.setAttribute("aria-hidden", "true");
    button.prepend(spinner);
    try {
      const address = await connectRail(network, wallet.id);
      rememberCheckoutNetwork(network);
      dialog.close();
      options.onConnected({ network, address, walletName: wallet.name });
    } catch (error) {
      showError(humanConnectError(error));
      const message = errorEl?.textContent ?? "";
      if (dialog.open) {
        showWalletStep(network);
        if (message) {
          showError(message);
        }
      }
    } finally {
      connecting = false;
      dialog.removeAttribute("aria-busy");
    }
  };

  dialog.querySelectorAll<HTMLButtonElement>("[data-network]").forEach((button) => {
    button.addEventListener("click", () => {
      const network = button.dataset.network === "base" ? "base" : "algorand";
      showWalletStep(network);
    });
  });
  dialog.querySelector("[data-modal-back]")?.addEventListener("click", () => {
    showNetworkStep();
  });
  dialog.querySelector("[data-modal-close]")?.addEventListener("click", () => {
    dialog.close();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && !connecting) {
      dialog.close();
    }
  });
  dialog.addEventListener("cancel", (event) => {
    if (connecting) {
      event.preventDefault();
    }
  });
  dialog.addEventListener("close", () => {
    connecting = false;
    clearError();
    showNetworkStep();
  });

  return {
    open(preferred) {
      const network = preferred ?? lastCheckoutNetwork();
      if (network) {
        showWalletStep(network);
      } else {
        showNetworkStep();
      }
      if (!dialog.open) {
        window.setTimeout(() => {
          if (!dialog.open) {
            dialog.showModal();
          }
        }, 0);
      }
    },
    close() {
      if (dialog.open && !connecting) {
        dialog.close();
      }
    }
  };
}

function baseRow(wallet: BaseWalletChoiceRow): WalletRow {
  const row: WalletRow = {
    id: wallet.uid,
    name: wallet.name,
    detected: wallet.detected
  };
  if (wallet.icon) {
    row.icon = wallet.icon;
  }
  if (wallet.installUrl) {
    row.installUrl = wallet.installUrl;
  }
  return row;
}
