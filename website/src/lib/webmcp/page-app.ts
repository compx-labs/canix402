import { buyPrepaidSession, refreshSessionRemaining } from "./checkout";
import { createSessionStore, quotaFromReceipt, type WebMcpSessionStore } from "./session-store";
import type { SessionReceipt } from "./types";
import {
  connectWebmcpWallet,
  disconnectWebmcpWallet,
  fetchSuggestedParamsFromWallet,
  getActiveWalletAddress,
  listWebmcpWallets,
  resumeWebmcpWallet,
  webmcpWalletSignTransactions,
  type WebmcpWalletId
} from "./wallet";

export interface WebmcpPageHandles {
  applyReceipt: (receipt: SessionReceipt) => SessionReceipt;
  getReceipt: () => SessionReceipt | null;
  getActiveAddress: () => string | null;
}

declare global {
  interface Window {
    __canixWebmcp?: WebmcpPageHandles;
  }
}

export async function mountWebmcpPage(options: { gatewayBaseUrl: string }): Promise<WebmcpPageHandles> {
  const sessionStore = createSessionStore();
  const checkoutRoot = document.querySelector<HTMLElement>("[data-webmcp-checkout]");

  const render = (): void => {
    if (!checkoutRoot) {
      return;
    }
    const address = getActiveWalletAddress();
    const receipt = sessionStore.get();
    const addressEl = checkoutRoot.querySelector<HTMLElement>("[data-wallet-address]");
    const statusEl = checkoutRoot.querySelector<HTMLElement>("[data-wallet-status]");
    if (addressEl) {
      addressEl.textContent = address ?? "Not connected";
    }
    if (statusEl) {
      statusEl.textContent = address ? "Connected (checkout only)" : "Disconnected";
    }
    checkoutRoot.querySelectorAll<HTMLButtonElement>("[data-connect]").forEach((button) => {
      button.disabled = Boolean(address);
    });
    const disconnectBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-disconnect]");
    if (disconnectBtn) {
      disconnectBtn.hidden = !address;
    }
    const buyBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-buy-session]");
    const refreshBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-refresh-session]");
    const readBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-read-session]");
    if (buyBtn) {
      buyBtn.disabled = !address;
    }
    if (refreshBtn) {
      refreshBtn.disabled = !address;
    }
    if (readBtn) {
      readBtn.disabled = !receipt?.sessionId;
    }
    setText(checkoutRoot, "[data-remaining-research]", receipt ? String(quotaFromReceipt(receipt).remainingResearch) : "—");
    setText(checkoutRoot, "[data-remaining-quotes]", receipt ? String(quotaFromReceipt(receipt).remainingQuotes) : "—");
    setText(checkoutRoot, "[data-session-expires]", receipt?.expiresAt ?? "—");
    setText(checkoutRoot, "[data-session-id]", receipt?.sessionId ?? "None");
    setText(checkoutRoot, "[data-session-status]", receipt?.status ?? "none");
  };

  const handles: WebmcpPageHandles = {
    applyReceipt(receipt) {
      const stored = sessionStore.set(receipt);
      render();
      return stored;
    },
    getReceipt() {
      return sessionStore.get();
    },
    getActiveAddress() {
      return getActiveWalletAddress();
    }
  };
  window.__canixWebmcp = handles;

  if (!checkoutRoot) {
    return handles;
  }

  const errorEl = checkoutRoot.querySelector<HTMLElement>("[data-checkout-error]");
  const noteEl = checkoutRoot.querySelector<HTMLElement>("[data-checkout-note]");
  const demoBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-apply-demo-session]");
  const demoEnabled = new URLSearchParams(window.location.search).has("demo");
  if (demoBtn) {
    demoBtn.hidden = !demoEnabled;
  }

  try {
    const manager = await resumeWebmcpWallet();
    const wallets = listWebmcpWallets();
    checkoutRoot.querySelectorAll<HTMLButtonElement>("[data-connect]").forEach((button) => {
      const id = button.dataset.connect;
      const meta = wallets.find((wallet) => wallet.id === id);
      if (!meta) {
        return;
      }
      const label = button.querySelector("[data-connect-label]");
      if (label) {
        label.textContent = `Connect ${meta.name}`;
      }
      const icon = button.querySelector<HTMLImageElement>("[data-connect-icon]");
      if (icon && meta.icon) {
        icon.src = meta.icon;
        icon.alt = meta.name;
        icon.hidden = false;
      }
    });
    manager.subscribe(() => {
      render();
    });
  } catch (error) {
    showJson(errorEl, {
      error: "WALLET_UNAVAILABLE",
      message: error instanceof Error ? error.message : "use-wallet failed to start."
    });
  }

  checkoutRoot.querySelectorAll<HTMLButtonElement>("[data-connect]").forEach((button) => {
    button.addEventListener("click", async () => {
      const walletId = button.dataset.connect as WebmcpWalletId | undefined;
      if (!walletId) {
        return;
      }
      hideBox(errorEl);
      hideBox(noteEl);
      try {
        await connectWebmcpWallet(walletId);
        showText(noteEl, `Connected with use-wallet (${walletId}). Wallet is only used to pay for this session.`);
      } catch (error) {
        showJson(errorEl, {
          error: "WALLET_CONNECT_FAILED",
          message: error instanceof Error ? error.message : "Wallet connect was rejected."
        });
      }
      render();
    });
  });

  checkoutRoot.querySelector<HTMLButtonElement>("[data-disconnect]")?.addEventListener("click", async () => {
    hideBox(errorEl);
    hideBox(noteEl);
    await disconnectWebmcpWallet();
    render();
  });

  checkoutRoot.querySelector<HTMLButtonElement>("[data-buy-session]")?.addEventListener("click", () => {
    void runCheckout(sessionStore, options.gatewayBaseUrl, "create", errorEl, noteEl, render);
  });
  checkoutRoot.querySelector<HTMLButtonElement>("[data-refresh-session]")?.addEventListener("click", () => {
    void runCheckout(sessionStore, options.gatewayBaseUrl, "refresh", errorEl, noteEl, render);
  });
  checkoutRoot.querySelector<HTMLButtonElement>("[data-read-session]")?.addEventListener("click", async () => {
    hideBox(errorEl);
    hideBox(noteEl);
    const result = await refreshSessionRemaining({
      gatewayBaseUrl: options.gatewayBaseUrl,
      sessionStore
    });
    if (isToolError(result)) {
      showJson(errorEl, result);
    } else {
      const receipt = sessionStore.get();
      showText(
        noteEl,
        receipt
          ? `Remaining research ${receipt.remaining.research} / quotes ${receipt.remaining.quotes}.`
          : "Session remaining updated."
      );
    }
    render();
  });

  demoBtn?.addEventListener("click", () => {
    handles.applyReceipt(demoReceipt());
    hideBox(errorEl);
    showText(
      noteEl,
      "Mocked 13.8 session applied (demo). Remaining N/M is 50 / 10. This is not a live USDC purchase."
    );
  });

  render();
  return handles;
}

async function runCheckout(
  sessionStore: WebMcpSessionStore,
  gatewayBaseUrl: string,
  mode: "create" | "refresh",
  errorEl: HTMLElement | null,
  noteEl: HTMLElement | null,
  render: () => void
): Promise<void> {
  hideBox(errorEl);
  hideBox(noteEl);
  const sender = getActiveWalletAddress();
  if (!sender) {
    showJson(errorEl, {
      error: "WALLET_REQUIRED",
      message: "Connect Pera or Defly with use-wallet before paying USDC."
    });
    return;
  }
  const result = await buyPrepaidSession({
    gatewayBaseUrl,
    sender,
    sessionStore,
    mode,
    signTransactions: webmcpWalletSignTransactions(),
    fetchSuggestedParams: fetchSuggestedParamsFromWallet
  });
  if (isToolError(result)) {
    showJson(errorEl, result);
  } else {
    const receipt = sessionStore.get();
    showText(
      noteEl,
      receipt
        ? `Session ${receipt.sessionId} active. Remaining research ${receipt.remaining.research} / quotes ${receipt.remaining.quotes}.`
        : "Session purchased."
    );
  }
  render();
}

function demoReceipt(): SessionReceipt {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 14_400 * 1000).toISOString();
  return {
    uri: "canix://session/csess_demo",
    sessionId: "csess_demo",
    createdAt,
    expiresAt,
    ttlSeconds: 14_400,
    budget: { research: 50, quotes: 10 },
    remaining: { research: 50, quotes: 10 },
    consumed: { research: 0, quotes: 0 },
    status: "active"
  };
}

function isToolError(result: unknown): result is { error: string; message?: string } {
  return Boolean(result && typeof result === "object" && typeof (result as { error?: unknown }).error === "string");
}

function setText(root: HTMLElement, selector: string, value: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (el) {
    el.textContent = value;
  }
}

function showJson(el: HTMLElement | null, payload: unknown): void {
  if (!el) {
    return;
  }
  el.hidden = false;
  el.textContent = JSON.stringify(payload, null, 2);
  if (payload && typeof payload === "object" && "error" in payload) {
    el.dataset.errorCode = String((payload as { error: unknown }).error);
  }
}

function showText(el: HTMLElement | null, message: string): void {
  if (!el) {
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function hideBox(el: HTMLElement | null): void {
  if (!el) {
    return;
  }
  el.hidden = true;
  el.textContent = "";
  delete el.dataset.errorCode;
}
