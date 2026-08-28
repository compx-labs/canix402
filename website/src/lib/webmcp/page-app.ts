import { getWebMcpTool } from "./catalog";
import { buyPrepaidSession, refreshSessionRemaining } from "./checkout";
import { executeAsHuman as executeHumanTool } from "./human-execute";
import {
  extractOpportunities,
  formatApy,
  formatTvl,
  mergeEligibility,
  type OpportunityTableRow
} from "./opportunities";
import { createSessionStore, quotaFromReceipt, type WebMcpSessionStore } from "./session-store";
import { argsFromForm } from "./tool-forms";
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
  const tableRoot = document.querySelector<HTMLElement>("[data-webmcp-opportunities]");
  const demoEnabled = new URLSearchParams(window.location.search).has("demo");
  const fetchImpl = demoEnabled ? createDemoGatewayFetch(sessionStore) : undefined;
  const tableState: { rows: OpportunityTableRow[]; source: string } = { rows: [], source: "" };

  const render = (): void => {
    if (checkoutRoot) {
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
    }
    const activeAddress = getActiveWalletAddress();
    if (activeAddress) {
      document.querySelectorAll<HTMLInputElement>('input[name="address"]').forEach((input) => {
        if (input.value.trim() === "") {
          input.value = activeAddress;
        }
      });
    }
    renderOpportunityTable(tableRoot, tableState);
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

  bindToolsDrawer();

  if (!checkoutRoot) {
    bindRunTools(runRoot, tableRoot, tableState, handles, render, demoEnabled);
    render();
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

  bindRunTools(runRoot, tableRoot, tableState, handles, render, demoEnabled);

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

function bindToolsDrawer(): void {
  const drawer = document.querySelector<HTMLElement>("[data-webmcp-tools-drawer]");
  const overlay = document.querySelector<HTMLElement>("[data-tools-overlay]");
  if (!drawer) {
    return;
  }

  const setOpen = (open: boolean): void => {
    drawer.hidden = false;
    overlay && (overlay.hidden = false);
    requestAnimationFrame(() => {
      drawer.classList.toggle("is-open", open);
      overlay?.classList.toggle("is-open", open);
      document.body.classList.toggle("webmcp-tools-open", open);
      document.querySelectorAll<HTMLButtonElement>("[data-open-tools]").forEach((button) => {
        button.setAttribute("aria-expanded", open ? "true" : "false");
      });
      if (open) {
        drawer.querySelector<HTMLInputElement>("[data-tool-filter]")?.focus();
      } else {
        window.setTimeout(() => {
          if (!drawer.classList.contains("is-open")) {
            drawer.hidden = true;
            if (overlay) {
              overlay.hidden = true;
            }
          }
        }, 280);
      }
    });
  };

  document.querySelectorAll("[data-open-tools]").forEach((button) => {
    button.addEventListener("click", () => setOpen(true));
  });
  document.querySelectorAll("[data-close-tools]").forEach((button) => {
    button.addEventListener("click", () => setOpen(false));
  });
  overlay?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.classList.contains("is-open")) {
      setOpen(false);
    }
  });

  const filter = drawer.querySelector<HTMLInputElement>("[data-tool-filter]");
  filter?.addEventListener("input", () => {
    const query = filter.value.trim().toLowerCase();
    drawer.querySelectorAll<HTMLElement>("[data-webmcp-tool]").forEach((card) => {
      const name = card.dataset.webmcpTool ?? "";
      const text = card.textContent?.toLowerCase() ?? "";
      card.hidden = query !== "" && !name.toLowerCase().includes(query) && !text.includes(query);
    });
    drawer.querySelectorAll<HTMLElement>("[data-tool-group]").forEach((group) => {
      const visible = [...group.querySelectorAll<HTMLElement>("[data-webmcp-tool]")].some((card) => !card.hidden);
      group.hidden = !visible;
    });
  });
}

function bindRunTools(
  runRoot: HTMLElement | null,
  tableRoot: HTMLElement | null,
  tableState: { rows: OpportunityTableRow[]; source: string },
  handles: WebmcpPageHandles,
  render: () => void,
  demoEnabled: boolean
): void {
  const resultEl =
    runRoot?.querySelector<HTMLElement>("[data-run-result]") ??
    tableRoot?.querySelector<HTMLElement>("[data-run-result]") ??
    null;
  const errorEl =
    runRoot?.querySelector<HTMLElement>("[data-run-error]") ??
    tableRoot?.querySelector<HTMLElement>("[data-run-error]") ??
    null;
  const noteEl =
    runRoot?.querySelector<HTMLElement>("[data-run-note]") ??
    tableRoot?.querySelector<HTMLElement>("[data-run-note]") ??
    null;
  const failBtn = runRoot?.querySelector<HTMLButtonElement>("[data-demo-fail-closed]");
  if (failBtn) {
    failBtn.hidden = !demoEnabled;
  }

  const run = async (name: string, args: Record<string, unknown>, fillsTable: boolean): Promise<void> => {
    await runHumanTool(handles, tableState, name, args, fillsTable, resultEl, errorEl, noteEl, render);
    if (fillsTable && !isMobileViewport()) {
      return;
    }
    if (fillsTable && tableState.rows.length > 0) {
      document.querySelector<HTMLElement>("[data-close-tools]")?.click();
    }
  };

  document.querySelectorAll<HTMLFormElement>("[data-tool-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = form.dataset.toolForm ?? "";
      const tool = getWebMcpTool(name);
      if (!tool) {
        showJson(errorEl, { error: "UNKNOWN_TOOL", message: `Unknown tool ${name}` });
        return;
      }
      try {
        const args = argsFromForm(form, tool.inputSchema);
        await run(name, args, form.dataset.fillsTable === "true");
      } catch (error) {
        showJson(errorEl, {
          error: "INVALID_ARGUMENT",
          message: error instanceof Error ? error.message : "Invalid tool arguments."
        });
      }
    });
  });

  tableRoot?.querySelector("[data-clear-opportunities]")?.addEventListener("click", () => {
    tableState.rows = [];
    tableState.source = "";
    hideBox(resultEl);
    hideBox(errorEl);
    hideBox(noteEl);
    render();
  });

  tableRoot?.querySelector("[data-check-eligibility]")?.addEventListener("click", () => {
    const ids = selectedOpportunityIds(tableRoot);
    if (ids.length === 0) {
      return;
    }
    openToolForm("canix_check_eligibility", {
      opportunityIds: ids.join(", "),
      address: handles.getActiveAddress() ?? ""
    });
  });

  tableRoot?.querySelector("[data-get-plan]")?.addEventListener("click", () => {
    const ids = selectedOpportunityIds(tableRoot);
    if (ids.length === 0) {
      return;
    }
    openToolForm("canix_get_plan", {
      opportunityIds: ids.join(", "),
      address: handles.getActiveAddress() ?? ""
    });
  });

  failBtn?.addEventListener("click", async () => {
    const current = handles.getReceipt() ?? demoReceipt();
    handles.applyReceipt({
      ...current,
      remaining: { research: 0, quotes: current.remaining.quotes },
      consumed: { research: current.budget.research, quotes: current.consumed.quotes },
      status: current.remaining.quotes <= 0 ? "exhausted" : current.status
    });
    await run("canix_list_opportunities", { limit: 1 }, true);
  });
}

async function runHumanTool(
  handles: WebmcpPageHandles,
  tableState: { rows: OpportunityTableRow[]; source: string },
  name: string,
  args: Record<string, unknown>,
  fillsTable: boolean,
  resultEl: HTMLElement | null,
  errorEl: HTMLElement | null,
  noteEl: HTMLElement | null,
  render: () => void
): Promise<void> {
  hideBox(errorEl);
  hideBox(noteEl);
  hideBox(resultEl);
  const result = await handles.executeAsHuman(name, args);
  const receipt = handles.getReceipt();
  if (isToolError(result)) {
    showJson(errorEl, result);
    render();
    return;
  }

  if (fillsTable) {
    const rows = extractOpportunities(result);
    if (rows) {
      tableState.rows = rows;
      tableState.source = name;
    }
  } else if (name === "canix_check_eligibility") {
    const merged = mergeEligibility(tableState.rows, result);
    if (merged) {
      tableState.rows = merged;
    }
  }

  const loaded = fillsTable ? extractOpportunities(result) : null;
  if (loaded) {
    hideBox(resultEl);
    showText(
      noteEl,
      loaded.length === 0
        ? `${name} returned no opportunities.`
        : `${name} loaded ${loaded.length} opportunit${loaded.length === 1 ? "y" : "ies"}. Remaining research ${receipt?.remaining.research ?? "—"} / quotes ${receipt?.remaining.quotes ?? "—"}.`
    );
  } else {
    showJson(resultEl, result);
    showText(
      noteEl,
      receipt
        ? `${name} succeeded. Remaining research ${receipt.remaining.research} / quotes ${receipt.remaining.quotes}. Canix did not sign or submit.`
        : `${name} succeeded.`
    );
  }
  render();
}

function renderOpportunityTable(
  tableRoot: HTMLElement | null,
  tableState: { rows: OpportunityTableRow[]; source: string }
): void {
  if (!tableRoot) {
    return;
  }
  const body = tableRoot.querySelector<HTMLTableSectionElement>("[data-opportunities-body]");
  const caption = tableRoot.querySelector<HTMLElement>("[data-opportunities-caption]");
  const clearBtn = tableRoot.querySelector<HTMLButtonElement>("[data-clear-opportunities]");
  const eligibilityBtn = tableRoot.querySelector<HTMLButtonElement>("[data-check-eligibility]");
  const planBtn = tableRoot.querySelector<HTMLButtonElement>("[data-get-plan]");
  if (!body) {
    return;
  }

  const selected = selectedOpportunityIds(tableRoot);
  if (clearBtn) {
    clearBtn.disabled = tableState.rows.length === 0;
  }
  if (eligibilityBtn) {
    eligibilityBtn.disabled = selected.length === 0;
  }
  if (planBtn) {
    planBtn.disabled = selected.length === 0;
  }
  if (caption) {
    caption.textContent =
      tableState.rows.length === 0
        ? "Table starts empty. Use Tools to load rows."
        : `${tableState.rows.length} loaded from ${tableState.source}${selected.length ? ` · ${selected.length} selected` : ""}.`;
  }

  if (tableState.rows.length === 0) {
    body.replaceChildren(emptyOpportunityRow());
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const row of tableState.rows) {
    fragment.append(opportunityRow(row, selected.includes(row.opportunityId)));
  }
  body.replaceChildren(fragment);
  body.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-opportunity-id]').forEach((input) => {
    input.addEventListener("change", () => {
      const nextSelected = selectedOpportunityIds(tableRoot);
      if (eligibilityBtn) {
        eligibilityBtn.disabled = nextSelected.length === 0;
      }
      if (planBtn) {
        planBtn.disabled = nextSelected.length === 0;
      }
      if (caption && tableState.rows.length > 0) {
        caption.textContent = `${tableState.rows.length} loaded from ${tableState.source}${
          nextSelected.length ? ` · ${nextSelected.length} selected` : ""
        }.`;
      }
    });
  });
}

function emptyOpportunityRow(): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.dataset.opportunitiesEmpty = "";
  const td = document.createElement("td");
  td.colSpan = 9;
  const wrap = document.createElement("div");
  wrap.className = "webmcp-empty";
  const title = document.createElement("p");
  title.textContent = "No opportunities loaded";
  const copy = document.createElement("p");
  copy.className = "muted";
  copy.textContent = "Open Tools to list, search, or personalize venues. Paid calls need a prepaid session.";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-primary";
  button.dataset.openTools = "";
  button.textContent = "Open tools";
  button.addEventListener("click", () => {
    document.querySelector<HTMLButtonElement>(".webmcp-tools-open")?.click();
  });
  wrap.append(title, copy, button);
  td.append(wrap);
  tr.append(td);
  return tr;
}

function opportunityRow(row: OpportunityTableRow, checked: boolean): HTMLTableRowElement {
  const tr = document.createElement("tr");
  const selectTd = document.createElement("td");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.opportunityId = row.opportunityId;
  checkbox.checked = checked;
  checkbox.setAttribute("aria-label", `Select ${row.opportunityId}`);
  selectTd.append(checkbox);

  tr.append(
    selectTd,
    textCell(row.protocol),
    textCell(row.opportunityType),
    textCell(row.assetPair),
    textCell(formatApy(row.apy, row.yieldBasis)),
    textCell(formatTvl(row.tvlUsd)),
    badgeCell(
      row.executionReady === null ? "—" : row.executionReady ? "Ready" : "Not ready",
      row.executionReady === true ? "badge-free" : row.executionReady === false ? "badge-paid" : ""
    ),
    badgeCell(
      row.canEnter === null ? "—" : row.canEnter ? "Can enter" : "Gated",
      row.canEnter === true ? "badge-free" : row.canEnter === false ? "badge-paid" : ""
    ),
    codeCell(row.opportunityId)
  );
  return tr;
}

function textCell(value: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = value;
  return td;
}

function codeCell(value: string): HTMLTableCellElement {
  const td = document.createElement("td");
  const code = document.createElement("code");
  code.textContent = value;
  td.append(code);
  return td;
}

function badgeCell(label: string, className: string): HTMLTableCellElement {
  const td = document.createElement("td");
  const span = document.createElement("span");
  span.className = className ? `badge ${className}` : "muted";
  span.textContent = label;
  td.append(span);
  return td;
}

function selectedOpportunityIds(tableRoot: HTMLElement | null): string[] {
  if (!tableRoot) {
    return [];
  }
  return [...tableRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-opportunity-id]:checked')]
    .map((input) => input.dataset.opportunityId ?? "")
    .filter((id) => id.length > 0);
}

function openToolForm(name: string, values: Record<string, string>): void {
  document.querySelector<HTMLButtonElement>(".webmcp-tools-open")?.click();
  const card = document.querySelector<HTMLDetailsElement>(`[data-webmcp-tool="${name}"]`);
  if (card) {
    card.open = true;
    card.hidden = false;
    card.scrollIntoView({ block: "nearest" });
  }
  const form = document.querySelector<HTMLFormElement>(`[data-tool-form="${name}"]`);
  if (!form) {
    return;
  }
  for (const [key, value] of Object.entries(values)) {
    const field = form.elements.namedItem(key);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.value = value;
    }
  }
}

function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 720px)").matches;
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
    const body = demoGatewayBody(path);
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

function demoGatewayBody(path: string): unknown {
  if (path.startsWith("/plans")) {
    return {
      data: { allocations: [], blocked: [] },
      meta: { executionSubmitted: false, signed: false, submitted: false }
    };
  }
  if (path.includes("/eligibility")) {
    return {
      data: [
        {
          opportunityId: "tinyman:pool:1002541853",
          protocol: "tinyman",
          canEnter: true
        }
      ]
    };
  }
  if (path.includes("/opportunities")) {
    return {
      data: [
        {
          protocol: "tinyman",
          opportunityType: "lp",
          opportunityId: "tinyman:pool:1002541853",
          assetPair: "ALGO/USDC",
          apy: 12.5,
          yieldBasis: "apy",
          tvlUsd: 2_450_000.5,
          executionReady: true
        }
      ]
    };
  }
  return { data: [{ id: "opp-demo", protocol: "tinyman", type: "lp" }] };
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
