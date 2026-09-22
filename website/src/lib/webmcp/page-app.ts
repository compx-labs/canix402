import { displayWalletLabel, lookupNfdName } from "../nfd";
import {
  connectBaseWallet,
  disconnectBaseWallet,
  getBaseWalletAddress,
  listBaseWalletButtons,
  resumeBaseWallet,
  signBaseTransferAuthorization,
  watchBaseWallet
} from "./base-wallet";
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
import {
  createSessionStore,
  isMockedSessionReceipt,
  quotaFromReceipt,
  type WebMcpSessionStore
} from "./session-store";
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

type OpportunityBusy = false | "table" | "tool" | "checkout";

interface OpportunityTableState {
  rows: OpportunityTableRow[];
  source: string;
  busy: OpportunityBusy;
}

declare global {
  interface Window {
    __canixWebmcp?: WebmcpPageHandles;
  }
}

export async function mountWebmcpPage(options: {
  gatewayBaseUrl: string;
  nfdApiBaseUrl?: string;
}): Promise<WebmcpPageHandles> {
  const sessionStore = createSessionStore();
  const checkoutRoot = document.querySelector<HTMLElement>("[data-webmcp-checkout]");
  const runRoot = document.querySelector<HTMLElement>("[data-webmcp-run]");
  const tableRoot = document.querySelector<HTMLElement>("[data-webmcp-opportunities]");
  const tableState: OpportunityTableState = { rows: [], source: "", busy: false };
  const nfdCache = new Map<string, string | null>();
  const nfdInflight = new Map<string, Promise<string | null>>();
  let paintedWalletAddress: string | null = null;

  const paintWalletAddress = (address: string | null, nfdName?: string | null): void => {
    if (!checkoutRoot) {
      return;
    }
    const addressEl = checkoutRoot.querySelector<HTMLElement>("[data-wallet-address]");
    if (!addressEl) {
      return;
    }
    paintedWalletAddress = address;
    if (!address) {
      addressEl.textContent = "Not connected";
      addressEl.removeAttribute("title");
      return;
    }
    addressEl.title = address;
    addressEl.textContent = displayWalletLabel(address, nfdName);
  };

  const resolveWalletNfd = async (address: string): Promise<void> => {
    if (nfdCache.has(address)) {
      if (paintedWalletAddress === address) {
        paintWalletAddress(address, nfdCache.get(address));
      }
      return;
    }
    let pending = nfdInflight.get(address);
    if (!pending) {
      pending = lookupNfdName(address, { apiBaseUrl: options.nfdApiBaseUrl });
      nfdInflight.set(address, pending);
    }
    const name = await pending;
    nfdCache.set(address, name);
    nfdInflight.delete(address);
    if (paintedWalletAddress === address) {
      paintWalletAddress(address, name);
    }
  };

  const render = (): void => {
    if (checkoutRoot) {
      const checkoutWallet = getCheckoutWallet();
      const address = checkoutWallet?.address ?? null;
      const receipt = sessionStore.get();
      const statusEl = checkoutRoot.querySelector<HTMLElement>("[data-wallet-status]");
      const nfdName = checkoutWallet?.rail === "algorand" ? nfdCache.get(checkoutWallet.address) : null;
      paintWalletAddress(address, nfdName);
      if (checkoutWallet?.rail === "algorand") {
        void resolveWalletNfd(checkoutWallet.address);
      }
      if (statusEl) {
        statusEl.textContent = checkoutWallet
          ? `Connected on ${checkoutWallet.rail === "base" ? "Base" : "Algorand"} (checkout only)`
          : "Disconnected";
      }
      checkoutRoot.querySelectorAll<HTMLButtonElement>("[data-connect], [data-connect-base]").forEach((button) => {
        button.disabled = Boolean(checkoutWallet);
      });
      const disconnectBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-disconnect]");
      if (disconnectBtn) {
        disconnectBtn.hidden = !checkoutWallet;
      }
      const buyBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-buy-session]");
      const refreshBtn = checkoutRoot.querySelector<HTMLButtonElement>("[data-refresh-session]");
      if (buyBtn) {
        buyBtn.disabled = !checkoutWallet;
      }
      if (refreshBtn) {
        refreshBtn.disabled = !checkoutWallet;
      }
      setAllText("[data-remaining-research]", receipt ? String(quotaFromReceipt(receipt).remainingResearch) : "—");
      setAllText("[data-remaining-quotes]", receipt ? String(quotaFromReceipt(receipt).remainingQuotes) : "—");
      checkoutRoot.querySelectorAll<HTMLElement>("[data-session-expires]").forEach((el) => {
        el.textContent = receipt?.expiresAt ?? "—";
        el.hidden = !receipt;
      });
    }
    const activeAddress = getActiveWalletAddress();
    if (activeAddress && !tableState.busy) {
      document.querySelectorAll<HTMLInputElement>('input[name="address"]').forEach((input) => {
        if (input.value.trim() === "") {
          input.value = activeAddress;
        }
      });
    }
    renderOpportunityTable(tableRoot, tableState);
    applyBusyControls(tableState.busy);
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
        sessionStore
      });
    }
  };
  window.__canixWebmcp = handles;

  bindToolsDrawer();

  if (!checkoutRoot) {
    bindRunTools(runRoot, tableRoot, tableState, handles, render);
    render();
    return handles;
  }

  const errorEl = checkoutRoot.querySelector<HTMLElement>("[data-checkout-error]");
  const noteEl = checkoutRoot.querySelector<HTMLElement>("[data-checkout-note]");

  const paintBaseWalletButtons = (): void => {
    const host = checkoutRoot.querySelector<HTMLElement>("[data-base-wallets]");
    if (!host) {
      return;
    }
    host.replaceChildren();
    for (const wallet of listBaseWalletButtons()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button";
      button.dataset.connectBase = wallet.uid;
      button.disabled = Boolean(getCheckoutWallet());
      if (wallet.icon) {
        const icon = document.createElement("img");
        icon.src = wallet.icon;
        icon.alt = "";
        icon.width = 20;
        icon.height = 20;
        button.append(icon);
      }
      const label = document.createElement("span");
      label.textContent = `Connect ${wallet.name}`;
      button.append(label);
      button.addEventListener("click", () => {
        void (async () => {
          hideBox(errorEl);
          hideBox(noteEl);
          try {
            await disconnectWebmcpWallet();
            await connectBaseWallet(wallet.uid);
            if (isMockedSessionReceipt(sessionStore.get())) {
              sessionStore.clear();
            }
            showText(noteEl, `Connected ${wallet.name}. Wallet is only used to pay for this session.`);
          } catch (error) {
            showJson(errorEl, {
              error: "WALLET_CONNECT_FAILED",
              message: error instanceof Error ? error.message : "Wallet connect was rejected."
            });
          }
          render();
        })();
      });
      host.append(button);
    }
  };

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
    if (getActiveWalletAddress() && isMockedSessionReceipt(sessionStore.get())) {
      sessionStore.clear();
    }
    manager.subscribe(() => {
      render();
    });
  } catch (error) {
    showJson(errorEl, {
      error: "WALLET_UNAVAILABLE",
      message: error instanceof Error ? error.message : "use-wallet failed to start."
    });
  }

  try {
    await resumeBaseWallet();
    if (getActiveWalletAddress() && getBaseWalletAddress()) {
      await disconnectBaseWallet();
    }
    paintBaseWalletButtons();
    watchBaseWallet({
      onConnection: () => {
        render();
      },
      onConnectors: () => {
        paintBaseWalletButtons();
        render();
      }
    });
  } catch (error) {
    showJson(errorEl, {
      error: "WALLET_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Base wallet failed to start."
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
        await disconnectBaseWallet();
        await connectWebmcpWallet(walletId);
        if (isMockedSessionReceipt(sessionStore.get())) {
          sessionStore.clear();
        }
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
    await disconnectBaseWallet();
    render();
  });

  checkoutRoot.querySelector<HTMLButtonElement>("[data-buy-session]")?.addEventListener("click", () => {
    void withBusy(tableState, "checkout", render, () =>
      runCheckout(sessionStore, options.gatewayBaseUrl, "create", errorEl, noteEl, render)
    );
  });
  checkoutRoot.querySelector<HTMLButtonElement>("[data-refresh-session]")?.addEventListener("click", () => {
    void withBusy(tableState, "checkout", render, () =>
      runCheckout(sessionStore, options.gatewayBaseUrl, "refresh", errorEl, noteEl, render)
    );
  });

  bindRunTools(runRoot, tableRoot, tableState, handles, render);
  startRemainingPoll(sessionStore, options.gatewayBaseUrl, render);

  render();
  return handles;
}

function getCheckoutWallet(): { rail: "algorand" | "base"; address: string } | null {
  const algorandAddress = getActiveWalletAddress();
  if (algorandAddress) {
    return { rail: "algorand", address: algorandAddress };
  }
  const baseAddress = getBaseWalletAddress();
  if (baseAddress) {
    return { rail: "base", address: baseAddress };
  }
  return null;
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
  const checkoutWallet = getCheckoutWallet();
  if (!checkoutWallet) {
    showJson(errorEl, {
      error: "WALLET_REQUIRED",
      message: "Connect Pera, Defly, or a Base wallet before paying USDC."
    });
    return;
  }
  const result =
    checkoutWallet.rail === "base"
      ? await buyPrepaidSession({
          rail: "base",
          gatewayBaseUrl,
          sender: checkoutWallet.address,
          sessionStore,
          mode,
          signTypedData: signBaseTransferAuthorization
        })
      : await buyPrepaidSession({
          gatewayBaseUrl,
          sender: checkoutWallet.address,
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

async function withBusy(
  tableState: OpportunityTableState,
  busy: Exclude<OpportunityBusy, false>,
  render: () => void,
  task: () => Promise<void>
): Promise<void> {
  if (tableState.busy) {
    return;
  }
  tableState.busy = busy;
  render();
  try {
    await task();
  } finally {
    tableState.busy = false;
    render();
  }
}

function applyBusyControls(busy: OpportunityBusy): void {
  const locked = Boolean(busy);
  document.querySelectorAll<HTMLButtonElement>("[data-list-top-opportunities]").forEach((button) => {
    button.disabled = locked;
    if (button.dataset.listTopOpportunities !== undefined) {
      button.textContent = busy === "table" ? "Loading…" : "Get top 25";
    }
  });
  document.querySelectorAll<HTMLFormElement>("[data-tool-form]").forEach((form) => {
    form.querySelectorAll<HTMLButtonElement>("button[type='submit']").forEach((button) => {
      button.disabled = locked;
    });
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select").forEach(
      (field) => {
        field.disabled = locked;
      }
    );
  });
  const buyBtn = document.querySelector<HTMLButtonElement>("[data-buy-session]");
  const refreshBtn = document.querySelector<HTMLButtonElement>("[data-refresh-session]");
  if (locked) {
    if (buyBtn) {
      buyBtn.disabled = true;
    }
    if (refreshBtn) {
      refreshBtn.disabled = true;
    }
  }
}

const TOP_OPPORTUNITIES_LIMIT = 25;
const REMAINING_POLL_MS = 15_000;

function startRemainingPoll(
  sessionStore: WebMcpSessionStore,
  gatewayBaseUrl: string,
  render: () => void
): void {
  let inFlight = false;
  const tick = async (): Promise<void> => {
    if (inFlight || !sessionStore.get()?.sessionId) {
      return;
    }
    inFlight = true;
    try {
      await refreshSessionRemaining({ gatewayBaseUrl, sessionStore });
      render();
    } finally {
      inFlight = false;
    }
  };
  window.setInterval(() => {
    void tick();
  }, REMAINING_POLL_MS);
  void tick();
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
  tableState: OpportunityTableState,
  handles: WebmcpPageHandles,
  render: () => void
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

  const run = async (name: string, args: Record<string, unknown>, fillsTable: boolean): Promise<void> => {
    closeToolsDrawer();
    await withBusy(tableState, fillsTable ? "table" : "tool", render, async () => {
      await runHumanTool(handles, tableState, name, args, fillsTable, resultEl, errorEl, noteEl, render);
    });
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

  tableRoot?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-list-top-opportunities]")) {
      return;
    }
    void run("canix_list_opportunities", { limit: TOP_OPPORTUNITIES_LIMIT }, true);
  });
}

async function runHumanTool(
  handles: WebmcpPageHandles,
  tableState: OpportunityTableState,
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
  tableState: OpportunityTableState
): void {
  if (!tableRoot) {
    return;
  }
  const body = tableRoot.querySelector<HTMLTableSectionElement>("[data-opportunities-body]");
  const table = tableRoot.querySelector<HTMLTableElement>("[data-opportunities-table]");
  const clearBtn = tableRoot.querySelector<HTMLButtonElement>("[data-clear-opportunities]");
  const eligibilityBtn = tableRoot.querySelector<HTMLButtonElement>("[data-check-eligibility]");
  const planBtn = tableRoot.querySelector<HTMLButtonElement>("[data-get-plan]");
  if (!body) {
    return;
  }

  const loadingTable = tableState.busy === "table";
  const locked = Boolean(tableState.busy);
  tableRoot.classList.toggle("is-loading", loadingTable);
  if (table) {
    table.setAttribute("aria-busy", loadingTable ? "true" : "false");
  }

  const selected = selectedOpportunityIds(tableRoot);
  if (clearBtn) {
    clearBtn.disabled = locked || tableState.rows.length === 0;
  }
  if (eligibilityBtn) {
    eligibilityBtn.disabled = locked || selected.length === 0;
  }
  if (planBtn) {
    planBtn.disabled = locked || selected.length === 0;
  }

  if (loadingTable) {
    body.replaceChildren(...skeletonOpportunityRows());
    return;
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
      const lockedNow = Boolean(tableState.busy);
      if (eligibilityBtn) {
        eligibilityBtn.disabled = lockedNow || nextSelected.length === 0;
      }
      if (planBtn) {
        planBtn.disabled = lockedNow || nextSelected.length === 0;
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
  title.className = "muted";
  title.textContent = "No opportunities loaded";
  wrap.append(title);
  td.append(wrap);
  tr.append(td);
  return tr;
}

const SKELETON_ROW_COUNT = 8;
const SKELETON_BAR_WIDTHS = ["1.1rem", "4.8rem", "3.2rem", "5.5rem", "3.6rem", "4.2rem", "3.4rem", "3.8rem", "8.5rem"];

function skeletonOpportunityRows(): HTMLTableRowElement[] {
  return Array.from({ length: SKELETON_ROW_COUNT }, (_, rowIndex) => {
    const tr = document.createElement("tr");
    tr.className = "webmcp-skeleton-row";
    tr.ariaHidden = "true";
    for (let column = 0; column < 9; column += 1) {
      const td = document.createElement("td");
      const bar = document.createElement("span");
      bar.className = "agent-skeleton-bar";
      const width = SKELETON_BAR_WIDTHS[column] ?? "4rem";
      const jitter = ((rowIndex + column) % 3) * 0.35;
      bar.style.width = `calc(${width} + ${jitter}rem)`;
      td.append(bar);
      tr.append(td);
    }
    return tr;
  });
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

function closeToolsDrawer(): void {
  const drawer = document.querySelector<HTMLElement>("[data-webmcp-tools-drawer]");
  if (!drawer?.classList.contains("is-open")) {
    return;
  }
  document.querySelector<HTMLElement>("[data-close-tools]")?.click();
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
