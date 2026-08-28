import { buyPrepaidSession, refreshSessionRemaining } from "./checkout";
import { executeAsHuman as executeHumanTool } from "./human-execute";
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
  executeAsHuman: (name: string, args: unknown) => Promise<unknown>;
}

declare global {
  interface Window {
    __canixWebmcp?: WebmcpPageHandles;
  }
}

export async function mountWebmcpPage(options: { gatewayBaseUrl: string }): Promise<WebmcpPageHandles> {
  const sessionStore = createSessionStore();
  const checkoutRoot = document.querySelector<HTMLElement>("[data-webmcp-checkout]");
  const runRoot = document.querySelector<HTMLElement>("[data-webmcp-run]");
  const demoEnabled = new URLSearchParams(window.location.search).has("demo");
  const fetchImpl = demoEnabled ? createDemoGatewayFetch(sessionStore) : undefined;

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
    setAllText("[data-remaining-research]", receipt ? String(quotaFromReceipt(receipt).remainingResearch) : "—");
    setAllText("[data-remaining-quotes]", receipt ? String(quotaFromReceipt(receipt).remainingQuotes) : "—");
    setAllText("[data-session-expires]", receipt?.expiresAt ?? "—");
    setAllText("[data-session-id]", receipt?.sessionId ?? "None");
    setAllText("[data-session-status]", receipt?.status ?? "none");
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
    },
    executeAsHuman(name, args) {
      return executeHumanTool(name, args, {
        gatewayBaseUrl: options.gatewayBaseUrl,
        sessionStore,
        ...(fetchImpl ? { fetchImpl } : {})
      });
    }
  };
  window.__canixWebmcp = handles;

  if (!checkoutRoot) {
    return handles;
  }

  const errorEl = checkoutRoot.querySelector<HTMLElement>("[data-checkout-error]");
  const noteEl = checkoutRoot.querySelector<HTMLElement>("[data-checkout-note]");
  const demoBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-apply-demo-session]");
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

  bindRunTools(runRoot, handles, render, demoEnabled);

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

function bindRunTools(
  runRoot: HTMLElement | null,
  handles: WebmcpPageHandles,
  render: () => void,
  demoEnabled: boolean
): void {
  if (!runRoot) {
    return;
  }
  const resultEl = runRoot.querySelector<HTMLElement>("[data-run-result]");
  const errorEl = runRoot.querySelector<HTMLElement>("[data-run-error]");
  const noteEl = runRoot.querySelector<HTMLElement>("[data-run-note]");
  const failBtn = runRoot.querySelector<HTMLButtonElement>("[data-demo-fail-closed]");
  if (failBtn) {
    failBtn.hidden = !demoEnabled;
  }

  runRoot.querySelector<HTMLFormElement>("[data-list-opportunities-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const limit = numberOrUndefined(data.get("limit"));
    const protocol = String(data.get("protocol") ?? "").trim();
    await runHumanTool(
      handles,
      "canix_list_opportunities",
      {
        ...(limit !== undefined ? { limit } : {}),
        ...(protocol ? { protocol } : {})
      },
      resultEl,
      errorEl,
      noteEl,
      render
    );
  });

  runRoot.querySelector<HTMLFormElement>("[data-get-plan-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const address = String(data.get("address") ?? "").trim() || handles.getActiveAddress() || "";
    const assetId = Number(data.get("assetId") ?? "0");
    const amount = String(data.get("amount") ?? "").trim();
    await runHumanTool(
      handles,
      "canix_get_plan",
      {
        address,
        budget: { assetId: Number.isFinite(assetId) ? assetId : 0, amount }
      },
      resultEl,
      errorEl,
      noteEl,
      render
    );
  });

  failBtn?.addEventListener("click", async () => {
    const current = handles.getReceipt() ?? demoReceipt();
    handles.applyReceipt({
      ...current,
      remaining: { research: 0, quotes: current.remaining.quotes },
      consumed: { research: current.budget.research, quotes: current.consumed.quotes },
      status: current.remaining.quotes <= 0 ? "exhausted" : current.status
    });
    await runHumanTool(handles, "canix_list_opportunities", { limit: 1 }, resultEl, errorEl, noteEl, render);
  });
}

async function runHumanTool(
  handles: WebmcpPageHandles,
  name: string,
  args: Record<string, unknown>,
  resultEl: HTMLElement | null,
  errorEl: HTMLElement | null,
  noteEl: HTMLElement | null,
  render: () => void
): Promise<void> {
  hideBox(errorEl);
  hideBox(noteEl);
  hideBox(resultEl);
  const result = await handles.executeAsHuman(name, args);
  render();
  const receipt = handles.getReceipt();
  if (isToolError(result)) {
    showJson(errorEl, result);
    return;
  }
  showJson(resultEl, result);
  showText(
    noteEl,
    receipt
      ? `${name} succeeded. Remaining research ${receipt.remaining.research} / quotes ${receipt.remaining.quotes}. Canix did not sign or submit.`
      : `${name} succeeded.`
  );
}

function createDemoGatewayFetch(sessionStore: WebMcpSessionStore): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = headerRecord(init?.headers);
    const sessionId = headers["x-canix-session"] ?? headers["X-Canix-Session"];
    const path = url.pathname;
    const receipt = sessionStore.get();
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "Payment required" }), {
        status: 402,
        headers: { "payment-required": demoPaymentRequiredHeader() }
      });
    }
    if (!receipt || receipt.sessionId !== sessionId) {
      return new Response(JSON.stringify({ error: { code: "SESSION_INVALID", message: "Unknown session receipt." } }), {
        status: 402
      });
    }
    const research = path.includes("/opportunities") || path.includes("/positions") || path.includes("/eligibility");
    const quotes = path.startsWith("/plans") || path.startsWith("/execution") || path === "/swaps/transactions";
    const remainingResearch = research ? Math.max(0, receipt.remaining.research - 1) : receipt.remaining.research;
    const remainingQuotes = quotes ? Math.max(0, receipt.remaining.quotes - 1) : receipt.remaining.quotes;
    const body =
      path === "/plans"
        ? { data: { allocations: [], blocked: [] }, meta: { executionSubmitted: false, signed: false, submitted: false } }
        : { data: [{ id: "opp-demo", protocol: "tinyman", type: "lp" }] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-canix-session-remaining-research": String(remainingResearch),
        "x-canix-session-remaining-quotes": String(remainingQuotes),
        "x-canix-session-expires-at": receipt.expiresAt
      }
    });
  };
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...(headers as Record<string, string>) };
}

function demoPaymentRequiredHeader(): string {
  const json = JSON.stringify({
    x402Version: 2,
    accepts: [{ scheme: "exact", network: "test-network", asset: "1", payTo: "PAYTO", maxAmountRequired: "10000" }]
  });
  return btoa(json);
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function setAllText(selector: string, value: string): void {
  document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    el.textContent = value;
  });
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
