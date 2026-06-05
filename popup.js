import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  formatSignedCurrency
} from "./shared.js";
import { getSetupStatus } from "./onboarding.js";

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
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  if (isMac) {
    el.innerHTML = 'Toggle: <kbd>⌘</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd>';
  } else {
    el.innerHTML = 'Toggle: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd>';
  }
}

async function refreshPopup(container) {
  container.innerHTML = "";
  const loading = document.createElement("div");
  loading.className = "loading-state";
  loading.textContent = "Loading…";
  container.appendChild(loading);

  const [status, local] = await Promise.all([
    getSetupStatus(),
    chrome.storage.local.get([STORAGE_KEYS.positionsState])
  ]);

  container.innerHTML = "";

  if (!status.complete) {
    renderSetupChecklist(container, status);
    return;
  }

  renderPopupContent(container, local[STORAGE_KEYS.positionsState]);
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
      hint: "Free at finnhub.io — takes ~30 seconds",
      action: "Open settings → Market Data"
    },
    {
      done: status.hasHoldings,
      label: "Import broker CSV",
      hint: "Zerodha, Groww, or Upstox holdings export",
      action: "Settings → Portfolio Import"
    },
    {
      done: status.hasLiveData,
      label: "See live P&L on any tab",
      hint: "Visit a webpage after steps 1 & 2",
      action: "Ticker appears at the top"
    }
  ];

  steps.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = `checklist-item${step.done ? " done" : ""}`;
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
  btn.className = "btn-setup";
  btn.textContent = status.hasApiKey ? "Continue setup in Settings →" : "Start setup →";
  btn.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  });
  card.appendChild(btn);

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
    const card = document.createElement("div");
    card.className = "summary-card";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Waiting for prices…";
    const subtitle = document.createElement("div");
    subtitle.className = "subtitle";
    subtitle.textContent = "Holdings loaded. Open Settings and click Test connection, or wait for the next refresh.";
    empty.appendChild(title);
    empty.appendChild(subtitle);
    card.appendChild(empty);
    container.appendChild(card);
    return;
  }

  const currency = state.displayCurrency || "INR";
  const agg = state.aggregate || { dayPnl: 0, dayPnlPct: 0 };
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";

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