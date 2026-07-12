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

function getSetupSteps(status) {
  // India-first: import holdings is the only required setup step.
  // US Finnhub key is optional (shown only when portfolio has non-.NS/.BO symbols).
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
      hint: "Only needed for US stocks or crypto (Finnhub free key)"
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
    if (icon) {
      icon.textContent = done ? "✓" : String(i + 1);
    }
  });

  const cta = viewEl.querySelector(".btn-setup");
  if (cta) {
    const next = steps.find((s) => !s.done);
    if (!next) {
      cta.textContent = "Open any tab to see your strip →";
      cta.dataset.wizardStep = "2";
    } else if (next.label.startsWith("Optional")) {
      cta.textContent = "Optional: add US key in Settings →";
      cta.dataset.wizardStep = "1";
    } else if (!status.hasHoldings) {
      cta.textContent = "Import holdings →";
      cta.dataset.wizardStep = "2";
    } else {
      cta.textContent = "Open Settings →";
      cta.dataset.wizardStep = "2";
    }
  }
}

function shortTimeAgo(timestamp) {
  if (!timestamp) return "just now";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function buildMetaLine(state, settings) {
  const statusLabel = state.staleWarning ? "Stale" : "Live";
  const strip = settings.enabled !== false ? "Strip on" : "Strip off";
  return `${statusLabel} · ${shortTimeAgo(state.updatedAt)} · ${strip}`;
}

function announcePnl(viewEl, dayPnl, dayPnlPct, currency, window5mPnl) {
  const live = viewEl.querySelector("[data-pnl-live]");
  if (!live) return;
  const day = formatSignedCurrency(dayPnl, currency);
  const pct = `${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%`;
  const five = formatSignedCurrency(window5mPnl, currency);
  live.textContent = `Today ${day} (${pct}). Five minute ${five}.`;
}

function updatePnlInPlace(viewEl, state, watchlistItems, settings = DEFAULT_SETTINGS) {
  if (!state?.positions?.length) return;

  const currency = state.displayCurrency || "INR";
  const agg = state.aggregate || { dayPnl: 0, dayPnlPct: 0, window5mPnl: 0, window5mPnlPct: 0 };
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const window5mPnl = Number(agg.window5mPnl) || 0;
  const window5mPnlPct = Number(agg.window5mPnlPct) || 0;
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";
  const fiveClass = window5mPnl > 0 ? "pnl-positive" : window5mPnl < 0 ? "pnl-negative" : "pnl-flat";
  const newSign = dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "flat";

  const pnlValue = viewEl.querySelector(".pnl-value");
  const pnlPct = viewEl.querySelector(".pnl-pct");
  const fiveValue = viewEl.querySelector(".window5m-value");
  const fivePct = viewEl.querySelector(".window5m-pct");
  const holdingsCount = viewEl.querySelector(".holdings-count");
  const metaLine = viewEl.querySelector(".meta-line");
  const summaryCard = viewEl.querySelector(".summary-card");

  if (pnlValue) {
    pnlValue.className = `pnl-value ${pnlClass}`;
    pnlValue.textContent = formatSignedCurrency(dayPnl, currency);
  }
  if (pnlPct) {
    pnlPct.className = `pnl-pct ${pnlClass}`;
    pnlPct.textContent = `${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%`;
  }
  if (fiveValue) {
    fiveValue.className = `window5m-value ${fiveClass}`;
    fiveValue.textContent = formatSignedCurrency(window5mPnl, currency);
  }
  if (fivePct) {
    fivePct.className = `window5m-pct ${fiveClass}`;
    fivePct.textContent = `${window5mPnlPct >= 0 ? "+" : ""}${window5mPnlPct.toFixed(2)}%`;
  }
  if (holdingsCount) {
    holdingsCount.textContent = `${state.positions.length} holding${state.positions.length !== 1 ? "s" : ""}`;
  }
  if (metaLine) {
    metaLine.textContent = buildMetaLine(state, settings);
    metaLine.classList.toggle("is-stale", !!state.staleWarning);
  }

  announcePnl(viewEl, dayPnl, dayPnlPct, currency, window5mPnl);

  const moversSection = viewEl.querySelector(".movers-section");
  if (moversSection) {
    const movers = [...state.positions]
      .filter((p) => p.lastPrice != null)
      .sort((a, b) => Math.abs(Number(b.dayPnlPct) || 0) - Math.abs(Number(a.dayPnlPct) || 0))
      .slice(0, 3);
    const existing = moversSection.querySelectorAll(".mover-item");
    existing.forEach((el) => el.remove());
    for (const pos of movers) {
      moversSection.appendChild(buildMoverItem(pos, currency));
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
  title.textContent = status.hasHoldings ? "Almost there" : "Get started";
  card.appendChild(title);

  const steps = getSetupSteps(status);

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
  if (!next) {
    btn.textContent = "Open any tab to see your strip →";
    btn.addEventListener("click", () => openOptionsAtWizardStep(2));
  } else if (next.label.startsWith("Optional")) {
    btn.textContent = "Optional: add US key →";
    btn.addEventListener("click", () => openOptionsAtWizardStep(1));
  } else if (!status.hasHoldings) {
    btn.textContent = "Import holdings →";
    btn.addEventListener("click", () => openOptionsAtWizardStep(2));
  } else {
    btn.textContent = "Open Settings →";
    btn.addEventListener("click", () => openOptionsAtWizardStep(2));
  }
  card.appendChild(btn);

  container.appendChild(card);
}

function buildMoverItem(pos, currency = "INR") {
  const pct = Number(pos.dayPnlPct) || 0;
  const dayPnl = Number(pos.dayPnl) || 0;
  const cls = pct > 0 ? "pnl-positive" : pct < 0 ? "pnl-negative" : "pnl-flat";
  const item = document.createElement("div");
  item.className = "mover-item";
  item.setAttribute("role", "listitem");

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

function renderEmptyState(container, status) {
  const card = document.createElement("div");
  card.className = "summary-card";
  const empty = document.createElement("div");
  empty.className = "empty-state";

  const title = document.createElement("div");
  title.className = "title";

  const subtitle = document.createElement("div");
  subtitle.className = "subtitle";

  const isHoldingsEmpty = !status || !status.hasHoldings;

  if (isHoldingsEmpty) {
    title.textContent = "No holdings yet";
    subtitle.textContent =
      "Import a broker CSV in Settings (Zerodha recommended) to see today's P&L here.";
  } else {
    title.textContent = "Waiting for prices";
    subtitle.textContent =
      "Holdings are saved. Confirm your price key in Settings, or wait for the next automatic refresh.";
  }

  empty.appendChild(title);
  empty.appendChild(subtitle);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-setup btn-pressable";
  btn.style.marginTop = "14px";
  btn.textContent = isHoldingsEmpty ? "Import holdings →" : "Open Settings →";
  btn.addEventListener("click", () => {
    openOptionsAtWizardStep(isHoldingsEmpty ? 2 : 1);
  });
  empty.appendChild(btn);

  card.appendChild(empty);
  container.appendChild(card);
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
  const agg = state.aggregate || { dayPnl: 0, dayPnlPct: 0, window5mPnl: 0, window5mPnlPct: 0 };
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const window5mPnl = Number(agg.window5mPnl) || 0;
  const window5mPnlPct = Number(agg.window5mPnlPct) || 0;
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";
  const fiveClass = window5mPnl > 0 ? "pnl-positive" : window5mPnl < 0 ? "pnl-negative" : "pnl-flat";
  lastAggregateSign = dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "flat";

  const firstValue = status && !status.firstValueSeen;

  const summaryCard = document.createElement("div");
  summaryCard.className = `summary-card${firstValue ? " first-value" : ""}`;
  summaryCard.setAttribute("aria-labelledby", "pnl-heading");

  // Screen-reader live region for dynamic P&L (visually hidden)
  const live = document.createElement("div");
  live.className = "sr-only";
  live.dataset.pnlLive = "1";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  summaryCard.appendChild(live);

  const label = document.createElement("div");
  label.className = "label";
  label.id = "pnl-heading";
  label.textContent = firstValue ? "Your day so far" : `Today's P&L (${currency})`;

  const pnlRow = document.createElement("div");
  pnlRow.className = "pnl-row";

  const pnlValue = document.createElement("span");
  pnlValue.className = `pnl-value ${pnlClass}`;
  pnlValue.textContent = formatSignedCurrency(dayPnl, currency);

  const pnlPct = document.createElement("span");
  pnlPct.className = `pnl-pct ${pnlClass}`;
  pnlPct.textContent = `${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%`;

  pnlRow.append(pnlValue, pnlPct);

  // Secondary 5-min window (product promise)
  const fiveRow = document.createElement("div");
  fiveRow.className = "window5m-row";
  const fiveLabel = document.createElement("span");
  fiveLabel.className = "window5m-label";
  fiveLabel.textContent = "5-min";
  const fiveValue = document.createElement("span");
  fiveValue.className = `window5m-value ${fiveClass}`;
  fiveValue.textContent = formatSignedCurrency(window5mPnl, currency);
  const fivePct = document.createElement("span");
  fivePct.className = `window5m-pct ${fiveClass}`;
  fivePct.textContent = `${window5mPnlPct >= 0 ? "+" : ""}${window5mPnlPct.toFixed(2)}%`;
  fiveRow.append(fiveLabel, fiveValue, fivePct);

  const holdingsCount = document.createElement("div");
  holdingsCount.className = "holdings-count";
  holdingsCount.textContent = `${state.positions.length} holding${state.positions.length !== 1 ? "s" : ""}`;

  // Single meta line replaces status-bar card + strip line
  const metaLine = document.createElement("p");
  metaLine.className = `meta-line${state.staleWarning ? " is-stale" : ""}`;
  metaLine.textContent = buildMetaLine(state, settings);

  // Methodology collapsed into one quiet link (not always-on disclaimer wall)
  const helpRow = document.createElement("p");
  helpRow.className = "help-row";
  const helpLink = document.createElement("a");
  helpLink.href = "https://github.com/harshabala/MyTicker#for-technical-users";
  helpLink.target = "_blank";
  helpLink.rel = "noopener noreferrer";
  helpLink.textContent = "How P&L is calculated";
  const privacy = document.createElement("span");
  privacy.className = "privacy-inline";
  privacy.textContent = " · Local only";
  helpRow.append(helpLink, privacy);

  summaryCard.append(label, pnlRow, fiveRow, holdingsCount, metaLine, helpRow);
  container.appendChild(summaryCard);

  announcePnl(summaryCard, dayPnl, dayPnlPct, currency, window5mPnl);

  if (firstValue) {
    setOnboarding({ firstValueSeen: true }).catch(() => {});
  }

  if (state.staleWarning) {
    const staleAction = document.createElement("button");
    staleAction.type = "button";
    staleAction.className = "stale-action btn-pressable";
    staleAction.textContent = "Data may be stale. Check connection →";
    staleAction.addEventListener("click", () => openOptionsAtWizardStep(1));
    container.appendChild(staleAction);
  }

  const movers = [...state.positions]
    .filter((p) => p.lastPrice != null)
    .sort((a, b) => Math.abs(Number(b.dayPnlPct) || 0) - Math.abs(Number(a.dayPnlPct) || 0))
    .slice(0, 3);

  if (movers.length > 0) {
    const moversSection = document.createElement("div");
    moversSection.className = "movers-section";
    moversSection.setAttribute("role", "list");
    moversSection.setAttribute("aria-label", "Top movers today");
    const moversLabel = document.createElement("div");
    moversLabel.className = "label";
    moversLabel.textContent = "Top movers (today)";
    moversSection.appendChild(moversLabel);

    for (const pos of movers) {
      moversSection.appendChild(buildMoverItem(pos, currency));
    }

    container.appendChild(moversSection);
  }

  renderWatchlistSection(container, watchlistItems, state?.watchlist || []);
}

function renderWatchlistSection(container, watchlistItems, watchlistPrices) {
  const section = document.createElement("div");
  section.className = "watchlist-section";
  section.setAttribute("aria-label", "Watchlist");

  const header = document.createElement("div");
  header.className = "label watchlist-header";
  header.textContent = "Watchlist";
  section.appendChild(header);

  const priceMap = Object.fromEntries((watchlistPrices || []).map((w) => [w.symbol, w]));

  if (!watchlistItems.length) {
    const empty = document.createElement("div");
    empty.className = "watchlist-empty";
    empty.textContent = "No symbols yet. Add one below, or import holdings for full P&L.";
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
      removeBtn.type = "button";
      removeBtn.className = "watch-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `Remove ${item.displayName} from watchlist`);
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

  const addRow = document.createElement("div");
  addRow.className = "watchlist-add";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "watchlist-input";
  input.placeholder = "SYMBOL";
  input.maxLength = 20;
  input.setAttribute("aria-label", "Watchlist symbol");
  input.id = "watchlistSymbolInput";

  const exchangeSelect = document.createElement("select");
  exchangeSelect.className = "watchlist-exchange";
  exchangeSelect.setAttribute("aria-label", "Exchange");
  exchangeSelect.id = "watchlistExchange";
  for (const [val, label] of [["NSE", "NSE"], ["BSE", "BSE"], ["US", "US"]]) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = label;
    exchangeSelect.appendChild(opt);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "watchlist-add-btn";
  addBtn.textContent = "+";
  addBtn.setAttribute("aria-label", "Add symbol to watchlist");
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