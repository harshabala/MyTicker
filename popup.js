import { STORAGE_KEYS, DEFAULT_SETTINGS, formatSigned } from "./shared.js";

document.addEventListener("DOMContentLoaded", () => {
  const enabledToggle = document.getElementById("enabledToggle");
  const openOptions = document.getElementById("openOptions");
  const mainContent = document.getElementById("mainContent");

  // Load settings
  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    enabledToggle.checked = !!settings.enabled;
  });

  // Load positions and render
  chrome.storage.local.get([STORAGE_KEYS.positionsState], (data) => {
    const state = data[STORAGE_KEYS.positionsState];
    renderPopupContent(mainContent, state);
  });

  // Toggle handler
  enabledToggle.addEventListener("change", () => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
      const settings = data[STORAGE_KEYS.settings] || {};
      settings.enabled = enabledToggle.checked;
      chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings });
    });
  });

  // Open options
  openOptions.addEventListener("click", (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"));
    }
  });

  // Listen for live updates
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[STORAGE_KEYS.positionsState]) {
      renderPopupContent(mainContent, changes[STORAGE_KEYS.positionsState].newValue);
    }
  });
});

function renderPopupContent(container, state) {
  container.innerHTML = "";

  if (!state || !state.positions || !state.positions.length) {
    container.innerHTML = `
      <div class="summary-card">
        <div class="empty-state">
          <div class="emoji">📈</div>
          <div class="title">No holdings yet</div>
          <div class="subtitle">Import your portfolio CSV or add crypto<br/>holdings in settings to get started.</div>
        </div>
      </div>
    `;
    return;
  }

  const agg = state.aggregate || { dayPnl: 0, dayPnlPct: 0 };
  const dayPnl = Number(agg.dayPnl) || 0;
  const dayPnlPct = Number(agg.dayPnlPct) || 0;
  const pnlClass = dayPnl > 0 ? "pnl-positive" : dayPnl < 0 ? "pnl-negative" : "pnl-flat";

  // Summary card
  const summaryCard = document.createElement("div");
  summaryCard.className = "summary-card";
  summaryCard.innerHTML = `
    <div class="label">Today's P&L</div>
    <div class="pnl-row">
      <span class="pnl-value ${pnlClass}">${formatSigned(dayPnl)}</span>
      <span class="pnl-pct ${pnlClass}">${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%</span>
    </div>
    <div class="holdings-count">${state.positions.length} holding${state.positions.length !== 1 ? "s" : ""} tracked</div>
  `;
  container.appendChild(summaryCard);

  // Status bar
  const statusClass = state.staleWarning ? "stale" : "connected";
  const statusLabel = state.staleWarning ? "Data may be stale" : "Live";
  const statusBar = document.createElement("div");
  statusBar.className = "status-bar";
  statusBar.innerHTML = `
    <span class="status-text"><span class="status-dot ${statusClass}"></span>${statusLabel}</span>
    <span class="status-time">Updated just now</span>
  `;
  container.appendChild(statusBar);

  // Top movers (best + worst by day P&L %)
  const sorted = [...state.positions]
    .filter((p) => p.lastPrice != null)
    .sort((a, b) => (Number(b.dayPnlPct) || 0) - (Number(a.dayPnlPct) || 0));

  if (sorted.length >= 2) {
    const moversSection = document.createElement("div");
    moversSection.className = "movers-section";
    moversSection.innerHTML = `<div class="label">Top Movers</div>`;

    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    for (const pos of [best, worst]) {
      const pct = Number(pos.dayPnlPct) || 0;
      const cls = pct > 0 ? "pnl-positive" : pct < 0 ? "pnl-negative" : "pnl-flat";
      const item = document.createElement("div");
      item.className = "mover-item";
      item.innerHTML = `
        <span class="mover-name">${pos.displayName || pos.symbol}</span>
        <span class="mover-change ${cls}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>
      `;
      moversSection.appendChild(item);
    }

    container.appendChild(moversSection);
  }
}
