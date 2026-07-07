import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  formatSignedCurrency
} from "./shared.js";
import { getSetupStatus } from "./onboarding.js";

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
    if (areaName === "local" && changes[STORAGE_KEYS.positionsState]) {
      refreshPopup(mainContent);
    }
    if (areaName === "local" && (changes[STORAGE_KEYS.holdings] || changes.pts_price_api_key)) {
      refreshPopup(mainContent);
    }
  });
});

function setPlatformShortcut(el) {
  if (!el) return;
  const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  const modKey = platform.includes("mac") ? "⌘" : "Ctrl";
  el.textContent = "";
  el.append("Toggle: ");
  const mod = document.createElement("kbd");
  mod.textContent = modKey;
  const shift = document.createElement("kbd");
  shift.textContent = "Shift";
  const y = document.createElement("kbd");
  y.textContent = "Y";
  el.append(mod, "+", shift, "+", y);
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
    waitMs(180)
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

  const [status, local] = await Promise.all([
    getSetupStatus(),
    chrome.storage.local.get([STORAGE_KEYS.positionsState])
  ]);

  const state = local[STORAGE_KEYS.positionsState];
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
      updatePnlInPlace(outgoing, state);
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
    renderEmptyState(viewEl);
  } else {
    renderPopupContent(viewEl, state);
  }

  mountView(container, viewEl, nextView);
  popupHasRendered = true;
}

function updateChecklistInPlace(viewEl, status) {
  const items = viewEl.querySelectorAll(".checklist-item");
  const steps = [
    status.hasApiKey,
    status.hasHoldings,
    status.hasLiveData
  ];
  items.forEach((row, i) => {
    row.classList.toggle("done", !!steps[i]);
    const icon = row.querySelector(".check-icon");
    if (icon) {
      icon.textContent = steps[i] ? "✓" : String(i + 1);
    }
  });
}

function updatePnlInPlace(viewEl, state) {
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
}

function renderSetupChecklist(container, status) {
  const card = document.createElement("div");
  card.className = "summary-card setup-checklist";

  const title = document.createElement("div");
  title.className = "label";
  title.textContent = "Get started (3 steps)";
  card.appendChild(title);

  const steps = [
    {
      done: status.hasApiKey,
      label: "Add Finnhub API key",
      hint: "Free at finnhub.io — takes ~30 seconds"
    },
    {
      done: status.hasHoldings,
      label: "Import broker CSV",
      hint: "Zerodha, Groww, or Upstox holdings export"
    },
    {
      done: status.hasLiveData,
      label: "See live P&L on any tab",
      hint: "Visit a webpage after steps 1 & 2"
    }
  ];

  steps.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = `checklist-item${step.done ? " done" : ""}`;
    row.style.setProperty("--stagger-index", String(i));
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

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-setup btn-pressable";
  btn.textContent = status.hasApiKey ? "Continue setup in Settings →" : "Start setup →";
  btn.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  });
  card.appendChild(btn);

  container.appendChild(card);
}

function renderEmptyState(container) {
  const card = document.createElement("div");
  card.className = "summary-card";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = "Waiting for prices…";
  const subtitle = document.createElement("div");
  subtitle.className = "subtitle";
  subtitle.textContent =
    "Holdings loaded. Open Settings and click Test connection, or wait for the next refresh.";
  empty.appendChild(title);
  empty.appendChild(subtitle);
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

function renderPopupContent(container, state) {
  if (!state || !state.positions || !state.positions.length) {
    renderEmptyState(container);
    return;
  }

  const currency = state.displayCurrency || "INR";
  const agg = state.aggregate || { dayPnl: 0, dayPnlPct: 0 };
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";
  lastAggregateSign = dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "flat";

  const summaryCard = document.createElement("div");
  summaryCard.className = "summary-card";

  const label = document.createElement("div");
  label.className = "label";
  label.textContent = `Today's P&L (${currency})`;

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
  container.appendChild(summaryCard);

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

  const sorted = [...state.positions]
    .filter((p) => p.lastPrice != null)
    .sort((a, b) => (Number(b.dayPnlPct) || 0) - (Number(a.dayPnlPct) || 0));

  if (sorted.length >= 2) {
    const moversSection = document.createElement("div");
    moversSection.className = "movers-section";
    const moversLabel = document.createElement("div");
    moversLabel.className = "label";
    moversLabel.textContent = "Top Movers (today)";
    moversSection.appendChild(moversLabel);

    for (const pos of [sorted[0], sorted[sorted.length - 1]]) {
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
      moversSection.appendChild(item);
    }

    container.appendChild(moversSection);
  }
}