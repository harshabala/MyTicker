import {
  STORAGE_KEYS,
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
let activeTab = "holdings"; // holdings | watchlist
let lastPnlPayload = null; // for tab switches without full re-fetch

document.addEventListener("DOMContentLoaded", () => {
  const openOptions = document.getElementById("openOptions");
  const mainContent = document.getElementById("mainContent");
  const tabHoldings = document.getElementById("tabHoldings");
  const tabWatchlist = document.getElementById("tabWatchlist");

  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    applyPopupTheme(data[STORAGE_KEYS.settings]?.tickerStyleConfig?.theme);
  });

  openOptions?.addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });

  tabHoldings?.addEventListener("click", () => setTab("holdings", mainContent));
  tabWatchlist?.addEventListener("click", () => setTab("watchlist", mainContent));
  [tabHoldings, tabWatchlist].filter(Boolean).forEach((tabEl) => {
    tabEl.addEventListener("keydown", (event) => handleTabKeydown(event, mainContent));
  });

  refreshPopup(mainContent);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === "local" &&
      (changes[STORAGE_KEYS.positionsState] ||
        changes[STORAGE_KEYS.holdings] ||
        changes[STORAGE_KEYS.watchlist] ||
        changes.pts_price_api_key)
    ) {
      refreshPopup(mainContent);
    }
    if (areaName === "sync" && changes[STORAGE_KEYS.settings]) {
      applyPopupTheme(changes[STORAGE_KEYS.settings].newValue?.tickerStyleConfig?.theme);
      refreshPopup(mainContent);
    }
  });
});

function applyPopupTheme(theme) {
  const root = document.documentElement;
  if (!root) return;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
}

function openSettings() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("options.html"));
  }
}

function setTab(tab, mainContent) {
  activeTab = tab;
  const tabHoldings = document.getElementById("tabHoldings");
  const tabWatchlist = document.getElementById("tabWatchlist");
  const panels = {
    holdings: document.getElementById("panelHoldings"),
    watchlist: document.getElementById("panelWatchlist")
  };
  [["holdings", tabHoldings], ["watchlist", tabWatchlist]].forEach(([name, tabEl]) => {
    const selected = name === tab;
    tabEl?.setAttribute("aria-selected", selected ? "true" : "false");
    tabEl?.setAttribute("tabindex", selected ? "0" : "-1");
    if (panels[name]) panels[name].hidden = !selected;
  });
  if (lastPnlPayload && currentView === VIEW_PNL) {
    renderActiveTab(mainContent, lastPnlPayload);
  } else {
    refreshPopup(mainContent);
  }
}

function handleTabKeydown(event, mainContent) {
  const tabs = [document.getElementById("tabHoldings"), document.getElementById("tabWatchlist")].filter(Boolean);
  const currentIndex = tabs.indexOf(event.currentTarget);
  let nextIndex = currentIndex;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = tabs.length - 1;
  else return;
  event.preventDefault();
  const nextTab = tabs[nextIndex];
  setTab(nextTab.id === "tabHoldings" ? "holdings" : "watchlist", mainContent);
  nextTab.focus();
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function mountView(container, viewEl, viewName, { animate = false } = {}) {
  viewEl.classList.add("popup-view");
  if (viewEl.parentNode !== container) container.appendChild(viewEl);
  currentView = viewName;
  // Popup data is often refreshed while keyboard navigation is in progress.
  // Keep the default immediate; a future deliberate, non-keyboard transition
  // must opt in and will still honor reduced-motion preferences.
  if (animate && !prefersReducedMotion()) {
    viewEl.classList.add("view-enter");
    requestAnimationFrame(() => {
      viewEl.classList.remove("view-enter");
    });
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
  const holdingsPanel = document.getElementById("panelHoldings");
  const watchlistPanel = document.getElementById("panelWatchlist");

  if (showLoading && !outgoing) {
    const loading = holdingsPanel;
    loading.replaceChildren();
    loading.className = "popup-view loading-state view-enter";
    loading.textContent = "Loading…";
    currentView = VIEW_LOADING;
  }

  const [status, local] = await Promise.all([
    getSetupStatus(),
    chrome.storage.local.get([
      STORAGE_KEYS.positionsState,
      STORAGE_KEYS.watchlist,
      STORAGE_KEYS.onboarding
    ])
  ]);

  const state = local[STORAGE_KEYS.positionsState];
  const watchlistItems = local[STORAGE_KEYS.watchlist] || [];
  lastPnlPayload = { state, watchlistItems, status };

  let nextView = VIEW_PNL;
  if (!status.complete) {
    nextView = VIEW_CHECKLIST;
  } else if (!state?.positions?.length) {
    nextView = VIEW_EMPTY;
  }

  // Show tabs only when fully set up with data
  const tabs = document.querySelector(".tabs");
  if (tabs) tabs.style.display = nextView === VIEW_PNL ? "flex" : "none";

  if (currentView === nextView && outgoing && nextView === VIEW_PNL) {
    updatePnlInPlace(outgoing, state, watchlistItems);
    popupHasRendered = true;
    return;
  }

  if (currentView === nextView && outgoing && nextView === VIEW_CHECKLIST) {
    updateChecklistInPlace(outgoing, status);
    popupHasRendered = true;
    return;
  }

  const loadingEl = container.querySelector(".loading-state");
  if (loadingEl) {
    loadingEl.className = "";
    loadingEl.replaceChildren();
  } else if (outgoing) {
    outgoing.className = "";
    outgoing.replaceChildren();
  }

  const viewEl = holdingsPanel;
  watchlistPanel.replaceChildren();
  watchlistPanel.hidden = true;
  holdingsPanel.hidden = false;
  holdingsPanel.replaceChildren();
  if (nextView === VIEW_CHECKLIST) {
    renderSetupChecklist(viewEl, status);
    if (!checklistStaggered) {
      viewEl.classList.add("checklist-stagger");
      checklistStaggered = true;
    }
  } else if (nextView === VIEW_EMPTY) {
    renderEmptyState(viewEl, status);
  } else {
    renderActiveTab(container, lastPnlPayload);
    popupHasRendered = true;
    return;
  }

  mountView(container, viewEl, nextView);
  popupHasRendered = true;
}

function renderActiveTab(container, payload) {
  const { state, watchlistItems, status } = payload;
  const panel = document.getElementById(activeTab === "watchlist" ? "panelWatchlist" : "panelHoldings");
  if (!panel) return;
  ["holdings", "watchlist"].forEach((name) => {
    const selected = name === activeTab;
    const tab = document.getElementById(name === "holdings" ? "tabHoldings" : "tabWatchlist");
    const tabPanel = document.getElementById(name === "holdings" ? "panelHoldings" : "panelWatchlist");
    tab?.setAttribute("aria-selected", selected ? "true" : "false");
    tab?.setAttribute("tabindex", selected ? "0" : "-1");
    if (tabPanel) tabPanel.hidden = !selected;
  });
  panel.replaceChildren();
  panel.className = "popup-view";
  if (activeTab === "watchlist") {
    renderWatchlistPanel(panel, watchlistItems, state?.watchlist || []);
  } else {
    renderHoldingsPanel(panel, state, status);
  }
  currentView = VIEW_PNL;
}

function openOptionsAtWizardStep(step) {
  markWizardStep(step).then(() => openSettings());
}

function getSetupSteps(status) {
  const steps = [
    {
      done: status.hasHoldings,
      wizardStep: 2,
      label: "Import your holdings",
      hint: "Zerodha CSV works immediately for Indian stocks (no API key)"
    },
    {
      done: status.hasLiveData,
      wizardStep: 2,
      label: status.hasLiveData ? "Live prices ready" : "Prices loading",
      hint: status.hasHoldings
        ? "Fetching live prices… open any tab in a moment"
        : "Import holdings first"
    }
  ];
  if (status.needsUsKey) {
    steps.push({
      done: status.hasApiKey,
      wizardStep: 1,
      label: "Optional: US price key",
      hint: "Needed for US equities; crypto quotes use CoinGecko with Binance fallback"
    });
  }
  return steps;
}

function updateChecklistInPlace(viewEl, status) {
  const steps = getSetupSteps(status);
  const items = viewEl.querySelectorAll(".checklist-item");
  items.forEach((row, i) => {
    const done = !!steps[i]?.done;
    row.classList.toggle("done", done);
    const icon = row.querySelector(".check-icon");
    if (icon) icon.textContent = done ? "✓" : String(i + 1);
  });
}

export function getAggregateDisplay(currency, value, percentage) {
  if (!currency) {
    return { value: "Mixed currencies", percentage: "", className: "pnl-flat" };
  }
  const numericValue = Number(value) || 0;
  const numericPercentage = Number(percentage) || 0;
  const className = numericValue > 0 ? "pnl-positive" : numericValue < 0 ? "pnl-negative" : "pnl-flat";
  return {
    value: formatSignedCurrency(numericValue, currency),
    percentage: `${numericPercentage >= 0 ? "+" : ""}${numericPercentage.toFixed(2)}%`,
    className
  };
}

export function updatePnlInPlace(viewEl, state, watchlistItems) {
  if (activeTab === "watchlist") {
    renderActiveTab(viewEl, { state, watchlistItems, status: null });
    return;
  }
  if (!state?.positions?.length) return;

  const currency = state.displayCurrency;
  const agg = state.aggregate || {};
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const window5mPnl = Number(agg.window5mPnl) || 0;
  const window5mPnlPct = Number(agg.window5mPnlPct) || 0;
  const dayDisplay = getAggregateDisplay(currency, dayPnl, dayPnlPct);
  const fiveDisplay = getAggregateDisplay(currency, window5mPnl, window5mPnlPct);

  const pnlValue = viewEl.querySelector(".pnl-value");
  const pnlPct = viewEl.querySelector(".pnl-pct");
  const fiveValue = viewEl.querySelector("[data-five-value]");
  const holdingsCount = viewEl.querySelector("[data-holdings-count]");
  const livePill = viewEl.querySelector(".live-pill");

  if (pnlValue) {
    pnlValue.className = `pnl-value ${dayDisplay.className}`;
    pnlValue.textContent = dayDisplay.value;
  }
  if (pnlPct) {
    pnlPct.className = `pnl-pct ${dayDisplay.className}`;
    pnlPct.textContent = dayDisplay.percentage;
    pnlPct.hidden = !currency;
  }
  if (fiveValue) fiveValue.className = "stat-cell-value";
  if (fiveValue && currency) {
    fiveValue.innerHTML = "";
    const main = document.createElement("span");
    main.className = fiveDisplay.className;
    main.textContent = fiveDisplay.value;
    const sub = document.createElement("span");
    sub.className = `sub ${fiveDisplay.className}`;
    sub.textContent = fiveDisplay.percentage;
    fiveValue.append(main, sub);
  } else if (fiveValue) {
    fiveValue.className = `stat-cell-value ${fiveDisplay.className}`;
    fiveValue.textContent = fiveDisplay.value;
  }
  if (holdingsCount) {
    holdingsCount.textContent = String(state.positions.length);
  }
  if (livePill) {
    livePill.classList.toggle("is-stale", !!state.staleWarning);
    const label = livePill.querySelector(".live-label");
    if (label) label.textContent = state.staleWarning ? "Stale" : "Live";
  }

  const moversList = viewEl.querySelector(".movers-list");
  if (moversList) {
    moversList.replaceChildren();
    const movers = [...state.positions]
      .filter((p) => p.lastPrice != null)
      .sort(
        (a, b) =>
          Math.abs(Number(b.dayPnlPct) || 0) - Math.abs(Number(a.dayPnlPct) || 0)
      )
      .slice(0, 3);
    for (const pos of movers) {
      moversList.appendChild(buildMoverItem(pos));
    }
  }

  const newSign = currency && dayPnl > 0 ? "up" : currency && dayPnl < 0 ? "down" : "flat";
  lastAggregateSign = newSign;
}

function renderSetupChecklist(container, status) {
  const card = document.createElement("div");
  card.className = "setup-checklist";

  const title = document.createElement("div");
  title.className = "label";
  title.textContent = status.hasHoldings ? "Almost there" : "Get started";
  card.appendChild(title);

  const steps = getSetupSteps(status);
  steps.forEach((step, i) => {
    const row = step.done ? document.createElement("div") : document.createElement("button");
    if (!step.done) row.type = "button";
    row.className = `checklist-item${step.done ? " done" : ""}`;
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
    body.append(lbl, hint);
    row.append(icon, body);
    card.appendChild(row);
  });

  const next = steps.find((s) => !s.done);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-setup";
  if (!next) {
    // Checklist complete: prices/hint already say open any tab; gear CTA is Settings.
    btn.textContent = "Open Settings →";
    btn.addEventListener("click", () => openSettings());
  } else if (next.label.startsWith("Optional")) {
    btn.textContent = "Optional: add US key →";
    btn.addEventListener("click", () => openOptionsAtWizardStep(1));
  } else if (!status.hasHoldings) {
    btn.textContent = "Import holdings →";
    btn.addEventListener("click", () => openOptionsAtWizardStep(2));
  } else {
    btn.textContent = "Open Settings →";
    btn.addEventListener("click", () => openSettings());
  }
  card.appendChild(btn);
  container.appendChild(card);
}

function renderEmptyState(container, status) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const title = document.createElement("div");
  title.className = "title";
  const subtitle = document.createElement("div");
  subtitle.className = "subtitle";
  const isHoldingsEmpty = !status?.hasHoldings;
  if (isHoldingsEmpty) {
    title.textContent = "No holdings yet";
    subtitle.textContent =
      "Import a broker CSV in Settings (Zerodha recommended) to see today's P&L.";
  } else {
    title.textContent = "Waiting for prices";
    subtitle.textContent =
      "Holdings are saved. Prices load automatically for Indian stocks — open any tab in a moment.";
  }
  empty.append(title, subtitle);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-setup";
  if (isHoldingsEmpty) {
    btn.textContent = "Import holdings →";
    btn.addEventListener("click", () => openOptionsAtWizardStep(2));
  } else {
    btn.textContent = "Open Settings →";
    btn.addEventListener("click", () => openSettings());
  }
  empty.appendChild(btn);
  container.appendChild(empty);
}

export function buildMoverItem(pos) {
  const pct = Number(pos.dayPnlPct) || 0;
  const dayPnl = Number(pos.dayPnl) || 0;
  const currency = pos.currency === "INR" || pos.currency === "USD"
    ? pos.currency
    : /\.(NS|BO)$/i.test(pos.symbol || "") ? "INR" : "USD";
  const cls = pct > 0 ? "pnl-positive" : pct < 0 ? "pnl-negative" : "pnl-flat";
  const item = document.createElement("div");
  item.className = "mover-item";

  const nameSpan = document.createElement("span");
  nameSpan.className = "mover-name";
  nameSpan.textContent = pos.displayName || pos.symbol;

  const right = document.createElement("span");
  right.className = "mover-right";
  const moneySpan = document.createElement("span");
  moneySpan.className = `mover-money ${cls}`;
  moneySpan.textContent = formatSignedCurrency(dayPnl, currency);
  const changeSpan = document.createElement("span");
  changeSpan.className = `mover-change ${cls}`;
  changeSpan.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  right.append(moneySpan, changeSpan);
  item.append(nameSpan, right);
  return item;
}

export function renderHoldingsPanel(container, state, status) {
  if (!state?.positions?.length) {
    renderEmptyState(container, status);
    return;
  }

  const currency = state.displayCurrency;
  const agg = state.aggregate || {};
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const window5mPnl = Number(agg.window5mPnl) || 0;
  const window5mPnlPct = Number(agg.window5mPnlPct) || 0;
  const dayDisplay = getAggregateDisplay(currency, dayPnl, dayPnlPct);
  const fiveDisplay = getAggregateDisplay(currency, window5mPnl, window5mPnlPct);
  lastAggregateSign = currency && dayPnl > 0 ? "up" : currency && dayPnl < 0 ? "down" : "flat";
  const firstValue = status && !status.firstValueSeen;

  // Hero
  const hero = document.createElement("div");
  hero.className = "hero-card";

  const live = document.createElement("div");
  live.className = "sr-only";
  live.dataset.pnlLive = "1";
  live.setAttribute("aria-live", "polite");
  live.textContent = currency ? `Today ${formatSignedCurrency(dayPnl, currency)}` : "Today, mixed currencies";

  const heroTop = document.createElement("div");
  heroTop.className = "hero-top";
  const heroLabel = document.createElement("div");
  heroLabel.className = "hero-label";
  heroLabel.id = "pnl-heading";
  heroLabel.textContent = "Your day so far";
  const livePill = document.createElement("span");
  livePill.className = `live-pill${state.staleWarning ? " is-stale" : ""}`;
  const liveDot = document.createElement("span");
  liveDot.className = "dot";
  const liveLabel = document.createElement("span");
  liveLabel.className = "live-label";
  liveLabel.textContent = state.staleWarning ? "Stale" : "Live";
  livePill.append(liveDot, liveLabel);
  heroTop.append(heroLabel, livePill);

  const pnlRow = document.createElement("div");
  pnlRow.className = "pnl-row";
  const pnlValue = document.createElement("span");
  pnlValue.className = `pnl-value ${dayDisplay.className}`;
  pnlValue.textContent = dayDisplay.value;
  const pnlPct = document.createElement("span");
  pnlPct.className = `pnl-pct ${dayDisplay.className}`;
  pnlPct.textContent = dayDisplay.percentage;
  pnlPct.hidden = !currency;
  pnlRow.append(pnlValue, pnlPct);

  const grid = document.createElement("div");
  grid.className = "stat-grid";
  const cell5 = document.createElement("div");
  cell5.className = "stat-cell";
  cell5.innerHTML = `<div class="stat-cell-label">5-min change</div>`;
  const fiveVal = document.createElement("div");
  fiveVal.className = "stat-cell-value";
  fiveVal.dataset.fiveValue = "1";
  const fiveMain = document.createElement("span");
  fiveMain.className = fiveDisplay.className;
  fiveMain.textContent = fiveDisplay.value;
  fiveVal.append(fiveMain);
  if (currency) {
    const fiveSub = document.createElement("span");
    fiveSub.className = `sub ${fiveDisplay.className}`;
    fiveSub.textContent = fiveDisplay.percentage;
    fiveVal.append(fiveSub);
  }
  cell5.appendChild(fiveVal);

  const cellH = document.createElement("div");
  cellH.className = "stat-cell";
  cellH.innerHTML = `<div class="stat-cell-label">Holdings</div>`;
  const hVal = document.createElement("div");
  hVal.className = "stat-cell-value";
  hVal.dataset.holdingsCount = "1";
  hVal.textContent = String(state.positions.length);
  cellH.appendChild(hVal);
  grid.append(cell5, cellH);

  const help = document.createElement("div");
  help.className = "help-row";
  const helpLink = document.createElement("a");
  helpLink.href = "https://github.com/harshabala/MyTicker#for-technical-users";
  helpLink.target = "_blank";
  helpLink.rel = "noopener noreferrer";
  helpLink.textContent = "How P&L is calculated";
  help.append(helpLink);

  hero.append(live, heroTop, pnlRow, grid, help);
  container.appendChild(hero);

  if (firstValue) {
    setOnboarding({ firstValueSeen: true }).catch(() => {});
  }

  // Movers
  const movers = [...state.positions]
    .filter((p) => p.lastPrice != null)
    .sort(
      (a, b) => Math.abs(Number(b.dayPnlPct) || 0) - Math.abs(Number(a.dayPnlPct) || 0)
    )
    .slice(0, 3);

  if (movers.length) {
    const section = document.createElement("div");
    section.className = "movers-section";
    const head = document.createElement("div");
    head.className = "section-head";
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = "Top movers (today)";
    const viewAll = document.createElement("button");
    viewAll.type = "button";
    viewAll.className = "link-quiet";
    viewAll.textContent = "View all →";
    viewAll.addEventListener("click", () => openSettings());
    head.append(label, viewAll);
    section.appendChild(head);

    const list = document.createElement("div");
    list.className = "movers-list";
    list.setAttribute("role", "list");
    for (const pos of movers) {
      list.appendChild(buildMoverItem(pos));
    }
    section.appendChild(list);
    container.appendChild(section);
  }

}

export function renderWatchlistPanel(container, watchlistItems, watchlistPrices) {
  const panel = document.createElement("div");
  panel.className = "watchlist-panel";
  const priceMap = Object.fromEntries((watchlistPrices || []).map((w) => [w.symbol, w]));

  if (!watchlistItems.length) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.textContent =
      "Nothing on your watchlist yet. Add symbols in MyTicker settings → Watchlist. Watchlist is the second strip group, after holdings.";
    panel.appendChild(empty);
  } else {
    for (const item of watchlistItems) {
      const row = document.createElement("div");
      row.className = "watchlist-item";
      const sym = document.createElement("span");
      sym.className = "watch-symbol";
      sym.textContent = item.displayName || item.symbol;
      const asset = document.createElement("span");
      asset.className = "watch-asset";
      asset.textContent = formatWatchlistAssetLabel(item);
      const priceEl = document.createElement("span");
      priceEl.className = "watch-price";
      const changeEl = document.createElement("span");
      changeEl.className = "watch-change";
      const pd = priceMap[item.symbol];
      if (pd?.lastPrice != null) {
        const isInr = (pd.currency || item.currency) === "INR";
        priceEl.textContent = isInr
          ? `₹${pd.lastPrice.toFixed(2)}`
          : `$${pd.lastPrice.toFixed(2)}`;
        const pct = Number(pd.changePct) || 0;
        changeEl.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
        changeEl.className = `watch-change ${
          pct > 0 ? "pnl-positive" : pct < 0 ? "pnl-negative" : "pnl-flat"
        }`;
        if (pd.stale) {
          changeEl.textContent = "Stale";
          changeEl.className = "watch-change pnl-flat";
        }
      } else {
        priceEl.textContent = "—";
        changeEl.textContent = "Unavailable";
        changeEl.className = "watch-change pnl-flat";
      }
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "watch-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `Remove ${item.displayName}`);
      removeBtn.addEventListener("click", async () => {
        const data = await chrome.storage.local.get([STORAGE_KEYS.watchlist]);
        const updated = (data[STORAGE_KEYS.watchlist] || []).filter(
          (w) => (w.canonicalKey || `equity:${w.symbol}`) !== (item.canonicalKey || `equity:${item.symbol}`)
        );
        await chrome.storage.local.set({ [STORAGE_KEYS.watchlist]: updated });
      });
      row.append(sym, asset, priceEl, changeEl, removeBtn);
      panel.appendChild(row);
    }
  }
  container.appendChild(panel);
}

function formatWatchlistAssetLabel(item = {}) {
  if (item.assetClass === "crypto" || String(item.canonicalKey || "").startsWith("crypto:")) return "Crypto · USD";
  const exchange = item.exchange || (String(item.symbol).endsWith(".NS") ? "NSE" : String(item.symbol).endsWith(".BO") ? "BSE" : "");
  if (exchange === "NSE" || exchange === "BSE") return `India · ${exchange} · INR`;
  if (exchange === "INDEX") return "Index · USD";
  if (exchange === "ETF") return "ETF · USD";
  return `US${exchange ? ` · ${exchange}` : ""} · USD`;
}
