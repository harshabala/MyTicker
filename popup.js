import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  formatSignedCurrency
} from "./shared.js";
import { getSetupStatus, markWizardStep, setOnboarding } from "./onboarding.js";

const VIEW_CHECKLIST = "checklist";
const VIEW_LOADING = "loading";
const VIEW_PNL = "pnl";
const VIEW_EMPTY = "empty";

let currentView = null;
let checklistStaggered = false;
let lastAggregateSign = null;
let popupHasRendered = false;

document.addEventListener("DOMContentLoaded", () => {
  const enabledToggle = document.getElementById("enabledToggle");
  const openOptions = document.getElementById("openOptions");
  const mainContent = document.getElementById("mainContent");
  const shortcutHint = document.getElementById("shortcutHint");

  setPlatformShortcut(shortcutHint);

  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    enabledToggle.checked = !!settings.enabled;
  });

  refreshPopup(mainContent);

  enabledToggle.addEventListener("change", () => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
      const settings = data[STORAGE_KEYS.settings] || {};
      settings.enabled = enabledToggle.checked;
      chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings });
    });
  });

  openOptions.addEventListener("click", (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"));
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (
      changes[STORAGE_KEYS.positionsState] ||
      changes[STORAGE_KEYS.holdings] ||
      changes[STORAGE_KEYS.watchlist] ||
      changes.pts_price_api_key
    )) {
      refreshPopup(mainContent);
    }
  });
});

async function setPlatformShortcut(el) {
  if (!el) return;
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === "toggle-myticker");
    if (cmd?.shortcut) {
      el.textContent = "";
      el.append("Toggle: ");
      const parts = cmd.shortcut.split("+");
      parts.forEach((part, i) => {
        const kbd = document.createElement("kbd");
        kbd.textContent = part === "Command" ? "⌘" : part === "MacCtrl" ? "⌃" : part === "Alt" ? "⌥" : part;
        el.appendChild(kbd);
        if (i < parts.length - 1) el.append("+");
      });
      return;
    }
  } catch (_) { /* ignore */ }
  // Shortcut not assigned
  el.style.cssText = "color: var(--text-tertiary); font-size: 10px;";
  el.textContent = "Shortcut not set. Visit chrome://extensions/shortcuts";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fadeOutView(viewEl) {
  if (!viewEl || prefersReducedMotion()) return;
  viewEl.classList.add("view-exit");
  // Match --motion-medium settle; never lock input beyond this race
  await Promise.race([
    new Promise((resolve) => {
      viewEl.addEventListener("transitionend", resolve, { once: true });
    }),
    waitMs(260)
  ]);
}

function mountView(container, viewEl, viewName) {
  viewEl.classList.add("popup-view", "view-enter");
  container.appendChild(viewEl);
  currentView = viewName;

  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        viewEl.classList.remove("view-enter");
      });
    });
  } else {
    viewEl.classList.remove("view-enter");
  }
}

let refreshInFlight = false;

async function refreshPopup(container) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    await _refreshPopupInner(container);
  } finally {
    refreshInFlight = false;
  }
}

async function _refreshPopupInner(container) {
  const showLoading = !popupHasRendered;
  const outgoing = container.querySelector(".popup-view");

  if (showLoading && !outgoing) {
    const loading = document.createElement("div");
    loading.className = "popup-view loading-state view-enter";
    loading.textContent = "Loading…";
    container.appendChild(loading);
    currentView = VIEW_LOADING;
  }

  const [status, local, sync] = await Promise.all([
    getSetupStatus(),
    chrome.storage.local.get([
      STORAGE_KEYS.positionsState,
      STORAGE_KEYS.watchlist,
      STORAGE_KEYS.onboarding
    ]),
    chrome.storage.sync.get([STORAGE_KEYS.settings])
  ]);

  const state = local[STORAGE_KEYS.positionsState];
  const watchlistItems = local[STORAGE_KEYS.watchlist] || [];
  const settings = sync[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
  let nextView = VIEW_PNL;
  if (!status.complete) {
    nextView = VIEW_CHECKLIST;
  } else if (!state?.positions?.length) {
    nextView = VIEW_EMPTY;
  }

  if (currentView === nextView && outgoing) {
    if (nextView === VIEW_CHECKLIST) {
      updateChecklistInPlace(outgoing, status);
    } else if (nextView === VIEW_PNL) {
      updatePnlInPlace(outgoing, state, watchlistItems, settings);
    }
    popupHasRendered = true;
    return;
  }

  const loadingEl = container.querySelector(".loading-state");
  if (loadingEl) {
    await fadeOutView(loadingEl);
    loadingEl.remove();
  } else if (outgoing) {
    await fadeOutView(outgoing);
    outgoing.remove();
  }

  container.innerHTML = "";

  const viewEl = document.createElement("div");
  if (nextView === VIEW_CHECKLIST) {
    renderSetupChecklist(viewEl, status);
    if (!checklistStaggered) {
      viewEl.classList.add("checklist-stagger");
      checklistStaggered = true;
    }
  } else if (nextView === VIEW_EMPTY) {
    renderEmptyState(viewEl, status);
  } else {
    await renderPopupContent(viewEl, state, watchlistItems, status, settings);
  }

  mountView(container, viewEl, nextView);
  popupHasRendered = true;
}

function openOptionsAtWizardStep(step) {
  markWizardStep(step).then(() => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"));
    }
  });
}

function updateChecklistInPlace(viewEl, status) {
  const steps = [
    { done: status.hasApiKey, wizardStep: 1 },
    { done: status.hasHoldings, wizardStep: 2 },
    { done: status.hasLiveData, wizardStep: 3 }
  ];
  const items = viewEl.querySelectorAll(".checklist-item");
  items.forEach((row, i) => {
    const done = !!steps[i]?.done;
    row.classList.toggle("done", done);
    const icon = row.querySelector(".check-icon");
    if (icon) {
      icon.textContent = done ? "✓" : String(i + 1);
    }
  });

  const cta = viewEl.querySelector(".btn-setup");
  if (cta) {
    const next = steps.find((s) => !s.done);
    if (next) {
      const labels = {
        1: "Next: Connect price data →",
        2: "Next: Import your holdings →",
        3: "Next: Open any tab to go live →"
      };
      cta.textContent = labels[next.wizardStep] || "Continue setup →";
      cta.dataset.wizardStep = String(next.wizardStep);
    }
  }
}

function updatePnlInPlace(viewEl, state, watchlistItems, settings = DEFAULT_SETTINGS) {
  if (!state?.positions?.length) return;

  const currency = state.displayCurrency || "INR";
  const agg = state.aggregate || { dayPnl: 0, dayPnlPct: 0 };
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";
  const newSign = dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "flat";

  const pnlValue = viewEl.querySelector(".pnl-value");
  const pnlPct = viewEl.querySelector(".pnl-pct");
  const holdingsCount = viewEl.querySelector(".holdings-count");
  const statusTime = viewEl.querySelector(".status-time");
  const summaryCard = viewEl.querySelector(".summary-card");
  const stripLine = viewEl.querySelector(".strip-status-line");

  if (pnlValue) {
    pnlValue.className = `pnl-value ${pnlClass}`;
    pnlValue.textContent = formatSignedCurrency(dayPnl, currency);
  }
  if (pnlPct) {
    pnlPct.className = `pnl-pct ${pnlClass}`;
    pnlPct.textContent = `${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%`;
  }
  if (holdingsCount) {
    holdingsCount.textContent = `${state.positions.length} holding${state.positions.length !== 1 ? "s" : ""} tracked`;
  }
  if (statusTime) {
    statusTime.textContent = formatTimeAgo(state.updatedAt);
  }
  if (stripLine) {
    stripLine.textContent = settings.enabled !== false
      ? "Strip is on. Open any tab."
      : "Strip is off. Flip the toggle above.";
  }

  // Refresh top-3 movers in place when possible
  const moversSection = viewEl.querySelector(".movers-section");
  if (moversSection) {
    const movers = [...state.positions]
      .filter((p) => p.lastPrice != null)
      .sort((a, b) => Math.abs(Number(b.dayPnlPct) || 0) - Math.abs(Number(a.dayPnlPct) || 0))
      .slice(0, 3);
    const existing = moversSection.querySelectorAll(".mover-item");
    existing.forEach((el) => el.remove());
    for (const pos of movers) {
      moversSection.appendChild(buildMoverItem(pos));
    }
  }

  if (
    summaryCard &&
    lastAggregateSign &&
    lastAggregateSign !== newSign &&
    !prefersReducedMotion()
  ) {
    summaryCard.classList.remove("pnl-flash");
    void summaryCard.offsetWidth;
    summaryCard.classList.add("pnl-flash");
  }
  lastAggregateSign = newSign;

  // Update watchlist prices in-place
  for (const w of (state?.watchlist || [])) {
    const priceEl = viewEl.querySelector(`[data-watch-sym="${CSS.escape(w.symbol)}"]`);
    const changeEl = viewEl.querySelector(`[data-watch-chg="${CSS.escape(w.symbol)}"]`);
    if (priceEl && w.lastPrice != null) {
      const isInr = w.symbol.endsWith(".NS") || w.symbol.endsWith(".BO");
      priceEl.textContent = isInr ? `₹${w.lastPrice.toFixed(2)}` : `$${w.lastPrice.toFixed(2)}`;
    }
    if (changeEl) {
      const pct = Number(w.changePct) || 0;
      changeEl.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
      changeEl.className = `watch-change ${pct > 0 ? "pnl-positive" : pct < 0 ? "pnl-negative" : "pnl-flat"}`;
    }
  }
}

function renderSetupChecklist(container, status) {
  const card = document.createElement("div");
  card.className = "summary-card setup-checklist";

  const title = document.createElement("div");
  title.className = "label";
  title.textContent = "Get started (3 steps)";
  card.appendChild(title);

  // Unified order with options wizard: API → holdings → live
  const steps = [
    {
      done: status.hasApiKey,
      wizardStep: 1,
      label: "Connect price data",
      hint: "Free Finnhub key: paste it in Settings"
    },
    {
      done: status.hasHoldings,
      wizardStep: 2,
      label: "Import your holdings",
      hint: "Drop your Zerodha CSV (more formats supported)"
    },
    {
      done: status.hasLiveData,
      wizardStep: 3,
      label: "See it live on any tab",
      hint: "Ticker strip + today's P&L appear automatically"
    }
  ];

  steps.forEach((step, i) => {
    const row = step.done
      ? document.createElement("div")
      : document.createElement("button");
    if (!step.done) {
      row.type = "button";
    }
    row.className = `checklist-item${step.done ? " done" : ""}`;
    row.style.setProperty("--stagger-index", String(i));
    if (!step.done) {
      row.addEventListener("click", () => openOptionsAtWizardStep(step.wizardStep));
    }
    const icon = document.createElement("span");
    icon.className = "check-icon";
    icon.textContent = step.done ? "✓" : String(i + 1);
    const body = document.createElement("div");
    const lbl = document.createElement("div");
    lbl.className = "check-label";
    lbl.textContent = step.label;
    const hint = document.createElement("div");
    hint.className = "check-hint";
    hint.textContent = step.hint;
    body.appendChild(lbl);
    body.appendChild(hint);
    row.appendChild(icon);
    row.appendChild(body);
    card.appendChild(row);
  });

  const next = steps.find((s) => !s.done);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-setup btn-pressable";
  const ctaLabels = {
    1: "Next: Connect price data →",
    2: "Next: Import your holdings →",
    3: "Next: Open any tab to go live →"
  };
  btn.textContent = next ? ctaLabels[next.wizardStep] : "Open Settings →";
  if (next) btn.dataset.wizardStep = String(next.wizardStep);
  btn.addEventListener("click", () => {
    openOptionsAtWizardStep(next?.wizardStep || 1);
  });
  card.appendChild(btn);

  container.appendChild(card);
}

function buildMoverItem(pos) {
  const pct = Number(pos.dayPnlPct) || 0;
  const cls = pct > 0 ? "pnl-positive" : pct < 0 ? "pnl-negative" : "pnl-flat";
  const item = document.createElement("div");
  item.className = "mover-item";

  const nameSpan = document.createElement("span");
  nameSpan.className = "mover-name";
  nameSpan.textContent = pos.displayName || pos.symbol;

  const changeSpan = document.createElement("span");
  changeSpan.className = `mover-change ${cls}`;
  changeSpan.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;

  item.appendChild(nameSpan);
  item.appendChild(changeSpan);
  return item;
}

function renderEmptyState(container, status) {
  const card = document.createElement("div");
  card.className = "summary-card";
  const empty = document.createElement("div");
  empty.className = "empty-state";

  const emoji = document.createElement("div");
  emoji.className = "emoji";

  const title = document.createElement("div");
  title.className = "title";

  const subtitle = document.createElement("div");
  subtitle.className = "subtitle";

  const isHoldingsEmpty = !status || !status.hasHoldings;

  if (isHoldingsEmpty) {
    emoji.textContent = "📂";
    title.textContent = "No holdings imported";
    subtitle.textContent = "Drag-and-drop your Zerodha, Groww, or Upstox CSV holdings export in Settings to view your portfolio P&L here.";
  } else {
    emoji.textContent = "⏳";
    title.textContent = "Waiting for market data…";
    subtitle.textContent = "Your holdings are loaded. Click 'Test connection' in Settings or wait for the next automatic sync.";
  }

  empty.appendChild(emoji);
  empty.appendChild(title);
  empty.appendChild(subtitle);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-setup btn-pressable";
  btn.style.marginTop = "14px";
  btn.textContent = isHoldingsEmpty ? "Import Holdings →" : "Configure Settings →";
  btn.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  });
  empty.appendChild(btn);

  card.appendChild(empty);
  container.appendChild(card);
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "Updated just now";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "Updated just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours}h ago`;
}

async function renderPopupContent(
  container,
  state,
  watchlistItems = [],
  status = null,
  settings = DEFAULT_SETTINGS
) {
  if (!state || !state.positions || !state.positions.length) {
    renderEmptyState(container, status);
    return;
  }

  const currency = state.displayCurrency || "INR";
  const agg = state.aggregate || { dayPnl: 0, dayPnlPct: 0 };
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";
  lastAggregateSign = dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "flat";

  const firstValue = status && !status.firstValueSeen;

  const summaryCard = document.createElement("div");
  summaryCard.className = `summary-card${firstValue ? " first-value" : ""}`;

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = firstValue ? "Your day so far" : `Today's P&L (${currency})`;

  const pnlRow = document.createElement("div");
  pnlRow.className = "pnl-row";

  const pnlValue = document.createElement("span");
  pnlValue.className = `pnl-value ${pnlClass}`;
  pnlValue.textContent = formatSignedCurrency(dayPnl, currency);

  const pnlPct = document.createElement("span");
  pnlPct.className = `pnl-pct ${pnlClass}`;
  pnlPct.textContent = `${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%`;

  pnlRow.appendChild(pnlValue);
  pnlRow.appendChild(pnlPct);

  const holdingsCount = document.createElement("div");
  holdingsCount.className = "holdings-count";
  holdingsCount.textContent = `${state.positions.length} holding${state.positions.length !== 1 ? "s" : ""} tracked`;

  summaryCard.appendChild(label);
  summaryCard.appendChild(pnlRow);
  summaryCard.appendChild(holdingsCount);

  const footnote = document.createElement("p");
  footnote.className = "stats-footnote";
  footnote.append(
    document.createTextNode(
      "P&L = your imported quantities × latest price. 5-min is the short-term move; Daily is measured from the previous close (provider rules). "
    )
  );
  const helpLink = document.createElement("a");
  helpLink.href = "https://github.com/harshabala/MyTicker#features";
  helpLink.target = "_blank";
  helpLink.rel = "noopener noreferrer";
  helpLink.textContent = "How it works";
  footnote.appendChild(helpLink);
  summaryCard.appendChild(footnote);

  const privacy = document.createElement("p");
  privacy.className = "privacy-line";
  privacy.textContent = "Stored only in this browser. Never uploaded.";
  summaryCard.appendChild(privacy);

  container.appendChild(summaryCard);

  if (firstValue) {
    setOnboarding({ firstValueSeen: true }).catch(() => {});
  }

  const statusClass = state.staleWarning ? "stale" : "connected";
  const statusLabel = state.staleWarning ? "Data may be stale" : "Live";
  const statusBar = document.createElement("div");
  statusBar.className = "status-bar";

  const statusText = document.createElement("span");
  statusText.className = "status-text";
  const statusDot = document.createElement("span");
  statusDot.className = `status-dot ${statusClass}`;
  statusText.appendChild(statusDot);
  statusText.appendChild(document.createTextNode(statusLabel));

  const statusTime = document.createElement("span");
  statusTime.className = "status-time";
  statusTime.textContent = formatTimeAgo(state.updatedAt);

  statusBar.appendChild(statusText);
  statusBar.appendChild(statusTime);
  container.appendChild(statusBar);

  // Top movers by absolute day P&L % — up to 3
  const movers = [...state.positions]
    .filter((p) => p.lastPrice != null)
    .sort((a, b) => Math.abs(Number(b.dayPnlPct) || 0) - Math.abs(Number(a.dayPnlPct) || 0))
    .slice(0, 3);

  if (movers.length > 0) {
    const moversSection = document.createElement("div");
    moversSection.className = "movers-section";
    const moversLabel = document.createElement("div");
    moversLabel.className = "label";
    moversLabel.textContent = "Top movers (today)";
    moversSection.appendChild(moversLabel);

    for (const pos of movers) {
      moversSection.appendChild(buildMoverItem(pos));
    }

    container.appendChild(moversSection);
  }

  const stripLine = document.createElement("p");
  stripLine.className = "strip-status-line";
  stripLine.textContent = settings.enabled !== false
    ? "Strip is on. Open any tab."
    : "Strip is off. Flip the toggle above.";
  container.appendChild(stripLine);

  renderWatchlistSection(container, watchlistItems, state?.watchlist || []);
}

function renderWatchlistSection(container, watchlistItems, watchlistPrices) {
  const section = document.createElement("div");
  section.className = "watchlist-section";

  const header = document.createElement("div");
  header.className = "watchlist-header";
  header.textContent = "Watchlist";
  section.appendChild(header);

  const priceMap = Object.fromEntries((watchlistPrices || []).map((w) => [w.symbol, w]));

  if (!watchlistItems.length) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.style.textAlign = "center";
    empty.style.padding = "20px 12px";

    const emoji = document.createElement("div");
    emoji.style.fontSize = "22px";
    emoji.style.marginBottom = "6px";
    emoji.textContent = "🔔";

    const title = document.createElement("div");
    title.style.fontSize = "12px";
    title.style.fontWeight = "600";
    title.style.marginBottom = "4px";
    title.textContent = "Watchlist is empty";

    const desc = document.createElement("div");
    desc.style.fontSize = "11px";
    desc.style.color = "var(--text-tertiary)";
    desc.style.lineHeight = "1.4";
    desc.style.marginBottom = "10px";
    desc.textContent = "Add stock or crypto tickers in Settings to track their live prices here.";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-setup btn-pressable";
    btn.style.width = "auto";
    btn.style.padding = "4px 10px";
    btn.style.fontSize = "10px";
    btn.style.marginTop = "4px";
    btn.textContent = "Add Symbols";
    btn.addEventListener("click", () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });

    empty.appendChild(emoji);
    empty.appendChild(title);
    empty.appendChild(desc);
    empty.appendChild(btn);
    section.appendChild(empty);
  } else {
    for (const item of watchlistItems) {
      const row = document.createElement("div");
      row.className = "watchlist-item";

      const sym = document.createElement("span");
      sym.className = "watch-symbol";
      sym.textContent = item.displayName;

      const priceEl = document.createElement("span");
      priceEl.className = "watch-price";
      priceEl.dataset.watchSym = item.symbol;

      const changeEl = document.createElement("span");
      changeEl.className = "watch-change";
      changeEl.dataset.watchChg = item.symbol;

      const pd = priceMap[item.symbol];
      if (pd?.lastPrice != null) {
        const isInr = item.symbol.endsWith(".NS") || item.symbol.endsWith(".BO");
        priceEl.textContent = isInr ? `₹${pd.lastPrice.toFixed(2)}` : `$${pd.lastPrice.toFixed(2)}`;
        const pct = Number(pd.changePct) || 0;
        changeEl.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
        changeEl.className = `watch-change ${pct > 0 ? "pnl-positive" : pct < 0 ? "pnl-negative" : "pnl-flat"}`;
      } else {
        priceEl.textContent = "–";
      }

      const removeBtn = document.createElement("button");
      removeBtn.className = "watch-remove";
      removeBtn.textContent = "×";
      removeBtn.title = `Remove ${item.displayName}`;
      removeBtn.addEventListener("click", async () => {
        const data = await chrome.storage.local.get([STORAGE_KEYS.watchlist]);
        const updated = (data[STORAGE_KEYS.watchlist] || []).filter((w) => w.symbol !== item.symbol);
        await chrome.storage.local.set({ [STORAGE_KEYS.watchlist]: updated });
        chrome.runtime.sendMessage({ action: "poll-now" }, () => void chrome.runtime.lastError);
      });

      row.append(sym, priceEl, changeEl, removeBtn);
      section.appendChild(row);
    }
  }

  // Add row
  const addRow = document.createElement("div");
  addRow.className = "watchlist-add";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "watchlist-input";
  input.placeholder = "SYMBOL";
  input.maxLength = 20;
  input.setAttribute("aria-label", "Watchlist symbol");

  const exchangeSelect = document.createElement("select");
  exchangeSelect.className = "watchlist-exchange";
  for (const [val, label] of [["NSE", "NSE"], ["BSE", "BSE"], ["US", "US"]]) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    exchangeSelect.appendChild(opt);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "watchlist-add-btn";
  addBtn.textContent = "+";
  addBtn.title = "Add to watchlist";

  const doAdd = async () => {
    const raw = input.value.trim().toUpperCase().replace(/[^A-Z0-9&-]/g, "");
    if (!raw) { input.focus(); return; }
    const exchange = exchangeSelect.value;
    const symbol = exchange === "NSE" ? `${raw}.NS` : exchange === "BSE" ? `${raw}.BO` : raw;
    const data = await chrome.storage.local.get([STORAGE_KEYS.watchlist]);
    const current = data[STORAGE_KEYS.watchlist] || [];
    if (!current.some((w) => w.symbol === symbol)) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.watchlist]: [...current, { symbol, displayName: raw }]
      });
      chrome.runtime.sendMessage({ action: "poll-now" }, () => void chrome.runtime.lastError);
    }
    input.value = "";
    input.focus();
  };

  addBtn.addEventListener("click", doAdd);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });

  addRow.append(input, exchangeSelect, addBtn);
  section.appendChild(addRow);
  container.appendChild(section);
}