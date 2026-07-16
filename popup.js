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
let activeTab = "holdings"; // holdings | watchlist
let lastPnlPayload = null; // for tab switches without full re-fetch

document.addEventListener("DOMContentLoaded", () => {
  const openOptions = document.getElementById("openOptions");
  const mainContent = document.getElementById("mainContent");
  const shortcutHint = document.getElementById("shortcutHint");
  const tabHoldings = document.getElementById("tabHoldings");
  const tabWatchlist = document.getElementById("tabWatchlist");
  const addWatchBtn = document.getElementById("addWatchBtn");
  const addSheet = document.getElementById("addSheet");
  const quickAddInput = document.getElementById("quickAddInput");
  const quickAddExchange = document.getElementById("quickAddExchange");
  const quickAddBtn = document.getElementById("quickAddBtn");

  setPlatformShortcut(shortcutHint);

  openOptions?.addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });

  tabHoldings?.addEventListener("click", () => setTab("holdings", mainContent));
  tabWatchlist?.addEventListener("click", () => setTab("watchlist", mainContent));

  addWatchBtn?.addEventListener("click", () => {
    const open = addSheet?.classList.toggle("is-open");
    if (addSheet) {
      addSheet.hidden = !open;
      if (open) {
        setTab("watchlist", mainContent);
        quickAddInput?.focus();
      }
    }
  });

  const doQuickAdd = async () => {
    const raw = (quickAddInput?.value || "").trim().toUpperCase().replace(/[^A-Z0-9&-]/g, "");
    if (!raw) {
      quickAddInput?.focus();
      return;
    }
    const exchange = quickAddExchange?.value || "NSE";
    const symbol =
      exchange === "NSE" ? `${raw}.NS` : exchange === "BSE" ? `${raw}.BO` : raw;
    const data = await chrome.storage.local.get([STORAGE_KEYS.watchlist]);
    const current = data[STORAGE_KEYS.watchlist] || [];
    if (!current.some((w) => w.symbol === symbol)) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.watchlist]: [...current, { symbol, displayName: raw }]
      });
      chrome.runtime.sendMessage({ action: "poll-now" }, () => void chrome.runtime.lastError);
    }
    if (quickAddInput) quickAddInput.value = "";
    if (addSheet) {
      addSheet.classList.remove("is-open");
      addSheet.hidden = true;
    }
    setTab("watchlist", mainContent);
  };

  quickAddBtn?.addEventListener("click", doQuickAdd);
  quickAddInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doQuickAdd();
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
      refreshPopup(mainContent);
    }
  });
});

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
  tabHoldings?.setAttribute("aria-selected", tab === "holdings" ? "true" : "false");
  tabWatchlist?.setAttribute("aria-selected", tab === "watchlist" ? "true" : "false");
  if (lastPnlPayload && currentView === VIEW_PNL) {
    renderActiveTab(mainContent, lastPnlPayload);
  } else {
    refreshPopup(mainContent);
  }
}

async function setPlatformShortcut(el) {
  if (!el) return;
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === "toggle-myticker");
    if (cmd?.shortcut) {
      el.hidden = false;
      el.textContent = "";
      el.append("Toggle strip: ");
      const parts = cmd.shortcut.split("+");
      parts.forEach((part, i) => {
        const kbd = document.createElement("kbd");
        kbd.textContent =
          part === "Command" ? "⌘" : part === "MacCtrl" ? "⌃" : part === "Alt" ? "⌥" : part;
        el.appendChild(kbd);
        if (i < parts.length - 1) el.append("+");
      });
      return;
    }
  } catch (_) {
    /* ignore */
  }
  el.hidden = true;
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

  lastPnlPayload = { state, watchlistItems, status, settings };

  let nextView = VIEW_PNL;
  if (!status.complete) {
    nextView = VIEW_CHECKLIST;
  } else if (!state?.positions?.length) {
    nextView = VIEW_EMPTY;
  }

  // Show tabs only when fully set up with data
  const tabs = document.querySelector(".tabs");
  const headerActions = document.querySelector(".header-actions");
  if (tabs) tabs.style.display = nextView === VIEW_PNL ? "flex" : "none";
  if (headerActions) {
    const addBtn = document.getElementById("addWatchBtn");
    if (addBtn) addBtn.style.display = nextView === VIEW_PNL ? "flex" : "none";
  }

  if (currentView === nextView && outgoing && nextView === VIEW_PNL) {
    updatePnlInPlace(outgoing, state, watchlistItems, settings);
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
    renderActiveTab(viewEl, lastPnlPayload);
  }

  mountView(container, viewEl, nextView);
  popupHasRendered = true;
}

function renderActiveTab(container, payload) {
  const { state, watchlistItems, status, settings } = payload;
  container.innerHTML = "";
  container.className = "popup-view";
  if (activeTab === "watchlist") {
    renderWatchlistPanel(container, watchlistItems, state?.watchlist || []);
  } else {
    renderHoldingsPanel(container, state, status, settings);
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
      label: "Prices loading",
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

function shortTimeAgo(timestamp) {
  if (!timestamp) return "just now";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function updatePnlInPlace(viewEl, state, watchlistItems, settings = DEFAULT_SETTINGS) {
  if (activeTab === "watchlist") {
    renderActiveTab(viewEl, { state, watchlistItems, status: null, settings });
    return;
  }
  if (!state?.positions?.length) return;

  const currency = state.displayCurrency;
  const agg = state.aggregate || {};
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const window5mPnl = Number(agg.window5mPnl) || 0;
  const window5mPnlPct = Number(agg.window5mPnlPct) || 0;
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";
  const fiveClass =
    window5mPnl > 0 ? "pnl-positive" : window5mPnl < 0 ? "pnl-negative" : "pnl-flat";

  const pnlValue = viewEl.querySelector(".pnl-value");
  const pnlPct = viewEl.querySelector(".pnl-pct");
  const fiveValue = viewEl.querySelector("[data-five-value]");
  const holdingsCount = viewEl.querySelector("[data-holdings-count]");
  const livePill = viewEl.querySelector(".live-pill");
  const footerMeta = viewEl.querySelector(".footer-meta");
  const stripToggle = viewEl.querySelector("#enabledToggle");

  if (pnlValue && currency) {
    pnlValue.className = `pnl-value ${pnlClass}`;
    pnlValue.textContent = formatSignedCurrency(dayPnl, currency);
  } else if (pnlValue) pnlValue.textContent = "Mixed currencies";
  if (pnlPct) {
    pnlPct.className = `pnl-pct ${pnlClass}`;
    pnlPct.textContent = `${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%`;
  }
  if (fiveValue && currency) {
    fiveValue.innerHTML = "";
    const main = document.createElement("span");
    main.className = fiveClass;
    main.textContent = formatSignedCurrency(window5mPnl, currency);
    const sub = document.createElement("span");
    sub.className = `sub ${fiveClass}`;
    sub.textContent = `${window5mPnlPct >= 0 ? "+" : ""}${window5mPnlPct.toFixed(2)}%`;
    fiveValue.append(main, sub);
  } else if (fiveValue) fiveValue.textContent = "Mixed currencies";
  if (holdingsCount) {
    holdingsCount.textContent = String(state.positions.length);
  }
  if (livePill) {
    livePill.classList.toggle("is-stale", !!state.staleWarning);
    const label = livePill.querySelector(".live-label");
    if (label) label.textContent = state.staleWarning ? "Stale" : "Live";
  }
  if (footerMeta) {
    footerMeta.classList.toggle("is-stale", !!state.staleWarning);
    const t = footerMeta.querySelector(".footer-time");
    if (t) t.textContent = `Last updated ${shortTimeAgo(state.updatedAt)}`;
  }
  if (stripToggle) {
    stripToggle.checked = settings.enabled !== false;
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
      moversList.appendChild(buildMoverItem(pos, currency));
    }
  }

  const newSign = dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "flat";
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
    btn.textContent = "Open any tab to see your strip →";
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
  btn.textContent = isHoldingsEmpty ? "Import holdings →" : "Open Settings →";
  btn.addEventListener("click", () => openOptionsAtWizardStep(isHoldingsEmpty ? 2 : 2));
  empty.appendChild(btn);
  container.appendChild(empty);
}

function buildMoverItem(pos, currency = "INR") {
  const pct = Number(pos.dayPnlPct) || 0;
  const dayPnl = Number(pos.dayPnl) || 0;
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

function renderHoldingsPanel(container, state, status, settings) {
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
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";
  const fiveClass =
    window5mPnl > 0 ? "pnl-positive" : window5mPnl < 0 ? "pnl-negative" : "pnl-flat";
  lastAggregateSign = dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "flat";
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
  heroLabel.textContent = firstValue ? "Your day so far" : "Your day so far";
  const livePill = document.createElement("span");
  livePill.className = `live-pill${state.staleWarning ? " is-stale" : ""}`;
  livePill.innerHTML = `<span class="dot"></span><span class="live-label">${state.staleWarning ? "Stale" : "Live"}</span>`;
  heroTop.append(heroLabel, livePill);

  const pnlRow = document.createElement("div");
  pnlRow.className = "pnl-row";
  const pnlValue = document.createElement("span");
  pnlValue.className = `pnl-value ${pnlClass}`;
  pnlValue.textContent = currency ? formatSignedCurrency(dayPnl, currency) : "Mixed currencies";
  const pnlPct = document.createElement("span");
  pnlPct.className = `pnl-pct ${pnlClass}`;
  pnlPct.textContent = `${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%`;
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
  fiveMain.className = fiveClass;
  fiveMain.textContent = currency ? formatSignedCurrency(window5mPnl, currency) : "Mixed currencies";
  const fiveSub = document.createElement("span");
  fiveSub.className = `sub ${fiveClass}`;
  fiveSub.textContent = `${window5mPnlPct >= 0 ? "+" : ""}${window5mPnlPct.toFixed(2)}%`;
  fiveVal.append(fiveMain, fiveSub);
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
  const sep = document.createElement("span");
  sep.className = "sep";
  sep.textContent = "·";
  const privacy = document.createElement("span");
  privacy.textContent = "Local only";
  help.append(helpLink, sep, privacy);

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
      list.appendChild(buildMoverItem(pos, currency));
    }
    section.appendChild(list);
    container.appendChild(section);
  }

  // Strip control card
  const strip = document.createElement("div");
  strip.className = "strip-card";
  const left = document.createElement("div");
  left.className = "strip-card-left";
  const icon = document.createElement("div");
  icon.className = "strip-card-icon";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 12h3l2-6 4 12 2-6h7"/></svg>';
  const texts = document.createElement("div");
  const t1 = document.createElement("div");
  t1.className = "strip-card-title";
  t1.id = "toggleLabel";
  t1.textContent = "Ticker strip";
  const t2 = document.createElement("div");
  t2.className = "strip-card-sub";
  t2.textContent = "Live market updates in your browser";
  texts.append(t1, t2);
  left.append(icon, texts);

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "toggle-switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = "enabledToggle";
  input.checked = settings.enabled !== false;
  input.setAttribute("aria-labelledby", "toggleLabel");
  const slider = document.createElement("span");
  slider.className = "toggle-slider";
  toggleLabel.append(input, slider);
  input.addEventListener("change", () => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
      const s = data[STORAGE_KEYS.settings] || { ...DEFAULT_SETTINGS };
      s.enabled = input.checked;
      chrome.storage.sync.set({ [STORAGE_KEYS.settings]: s });
    });
  });
  strip.append(left, toggleLabel);
  container.appendChild(strip);

  // Footer meta
  const footer = document.createElement("div");
  footer.className = `footer-meta${state.staleWarning ? " is-stale" : ""}`;
  const time = document.createElement("span");
  time.innerHTML = `<span class="dot"></span><span class="footer-time">Last updated ${shortTimeAgo(state.updatedAt)}</span>`;
  const local = document.createElement("span");
  local.textContent = "Data: Local only";
  footer.append(time, local);
  container.appendChild(footer);
}

function renderWatchlistPanel(container, watchlistItems, watchlistPrices) {
  const panel = document.createElement("div");
  panel.className = "watchlist-panel";
  const priceMap = Object.fromEntries((watchlistPrices || []).map((w) => [w.symbol, w]));

  if (!watchlistItems.length) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.textContent =
      "No symbols yet. Tap + to add a symbol and exchange. Watchlist is the second strip group, after holdings.";
    panel.appendChild(empty);
  } else {
    for (const item of watchlistItems) {
      const row = document.createElement("div");
      row.className = "watchlist-item";
      const sym = document.createElement("span");
      sym.className = "watch-symbol";
      sym.textContent = item.displayName;
      const priceEl = document.createElement("span");
      priceEl.className = "watch-price";
      const changeEl = document.createElement("span");
      changeEl.className = "watch-change";
      const pd = priceMap[item.symbol];
      if (pd?.lastPrice != null) {
        const isInr = item.symbol.endsWith(".NS") || item.symbol.endsWith(".BO");
        priceEl.textContent = isInr
          ? `₹${pd.lastPrice.toFixed(2)}`
          : `$${pd.lastPrice.toFixed(2)}`;
        const pct = Number(pd.changePct) || 0;
        changeEl.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
        changeEl.className = `watch-change ${
          pct > 0 ? "pnl-positive" : pct < 0 ? "pnl-negative" : "pnl-flat"
        }`;
      } else {
        priceEl.textContent = "–";
      }
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "watch-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `Remove ${item.displayName}`);
      removeBtn.addEventListener("click", async () => {
        const data = await chrome.storage.local.get([STORAGE_KEYS.watchlist]);
        const updated = (data[STORAGE_KEYS.watchlist] || []).filter(
          (w) => w.symbol !== item.symbol
        );
        await chrome.storage.local.set({ [STORAGE_KEYS.watchlist]: updated });
      });
      row.append(sym, priceEl, changeEl, removeBtn);
      panel.appendChild(row);
    }
  }
  container.appendChild(panel);
}
