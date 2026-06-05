// Injects the ticker strip into every page and keeps it updated from storage.

import { STORAGE_KEYS, formatSigned } from "./shared.js";

const TICKER_CONTAINER_ID = "pts-ticker-container";
const TICKER_STYLE_ID = "pts-ticker-style";
const ORIGINAL_MARGIN_ATTR = "data-pts-original-margin-top";

init();

function init() {
  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings];
    if (settings?.enabled) {
      ensureTickerContainer();
      applyTickerSpeed(settings);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[STORAGE_KEYS.settings]) {
      const newSettings = changes[STORAGE_KEYS.settings].newValue;
      if (newSettings && newSettings.enabled) {
        ensureTickerContainer();
      } else {
        removeTickerContainer();
      }
      applyTickerSpeed(newSettings);
    }

    if (areaName === "local" && changes[STORAGE_KEYS.positionsState]) {
      const state = changes[STORAGE_KEYS.positionsState].newValue;
      renderTicker(state);
    }
  });

  chrome.storage.local.get([STORAGE_KEYS.positionsState], (data) => {
    const state = data[STORAGE_KEYS.positionsState];
    if (state) {
      renderTicker(state);
    }
  });
}

function ensureTickerContainer() {
  if (document.getElementById(TICKER_CONTAINER_ID)) return;

  if (!document.body) {
    // Body not ready yet; defer until DOM is ready.
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        ensureTickerContainer();
      },
      { once: true }
    );
    return;
  }

  const bar = document.createElement("div");
  bar.id = TICKER_CONTAINER_ID;
  bar.className = "pts-ticker-bar";

  // Load CSS via web_accessible_resources (only once).
  let link = document.getElementById(TICKER_STYLE_ID);
  if (!link) {
    link = document.createElement("link");
    link.id = TICKER_STYLE_ID;
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("ticker.css");
    document.documentElement.insertBefore(link, document.documentElement.firstChild);
  }

  document.documentElement.insertBefore(bar, document.body);

  // Push the page content down, adding to any existing offset.
  if (!document.body.hasAttribute(ORIGINAL_MARGIN_ATTR)) {
    const rect = document.body.getBoundingClientRect();
    const offset = Math.max(0, rect.top);
    document.body.setAttribute(ORIGINAL_MARGIN_ATTR, String(offset));
  }
  const originalPx = Number(document.body.getAttribute(ORIGINAL_MARGIN_ATTR)) || 0;
  document.body.style.marginTop = `${originalPx + 32}px`;
}

function removeTickerContainer() {
  const existing = document.getElementById(TICKER_CONTAINER_ID);
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  if (document.body && document.body.hasAttribute(ORIGINAL_MARGIN_ATTR)) {
    const originalPx = Number(document.body.getAttribute(ORIGINAL_MARGIN_ATTR)) || 0;
    document.body.style.marginTop = originalPx > 0 ? `${originalPx}px` : "";
    document.body.removeAttribute(ORIGINAL_MARGIN_ATTR);
  }
}

function renderTicker(state) {
  const container = document.getElementById(TICKER_CONTAINER_ID);
  if (!container) return;

  container.innerHTML = "";

  // Show stale-data indicator if present
  if (state?.staleWarning) {
    const staleEl = document.createElement("div");
    staleEl.className = "pts-stale-indicator";
    staleEl.textContent = "⚠ Stale";
    staleEl.title = "Price data may be outdated – check your API key or network";
    container.appendChild(staleEl);
  }

  const aggregate = document.createElement("div");
  aggregate.className = "pts-aggregate";
  const aggPnl = Number(state?.aggregate?.dayPnl) || 0;
  const aggPct = Number(state?.aggregate?.dayPnlPct) || 0;
  const aggDirClass = aggPnl > 0 ? "pts-up" : aggPnl < 0 ? "pts-down" : "pts-flat";

  aggregate.classList.add(aggDirClass);
  aggregate.textContent = `Day: ${formatSigned(aggPnl)} (${aggPct.toFixed(2)}%)`;
  container.appendChild(aggregate);

  const scrollWrapper = document.createElement("div");
  scrollWrapper.className = "pts-scroll-wrapper";
  const scrollInner = document.createElement("div");
  scrollInner.className = "pts-scroll-inner";

  const positions = state?.positions || [];

  // Duplicate items to make the marquee feel continuous.
  const items = [...positions, ...positions];

  for (const pos of items) {
    const item = document.createElement("div");
    item.className = "pts-item";

    if (pos.assetClass === "crypto") {
      item.classList.add("pts-crypto");
    }

    // Null-safe: default to 0 if fields are missing (Issue #6)
    const w5pnl = Number(pos.window5mPnl) || 0;
    const w5pct = Number(pos.window5mPnlPct) || 0;
    const dPnl = Number(pos.dayPnl) || 0;
    const dPct = Number(pos.dayPnlPct) || 0;

    const dirClass =
      w5pnl > 0 ? "pts-up" : w5pnl < 0 ? "pts-down" : "pts-flat";
    item.classList.add(dirClass);

    const iconSpan = document.createElement("span");
    iconSpan.className = "pts-icon";
    iconSpan.textContent = getInitials(pos.displayName);

    const nameSpan = document.createElement("span");
    nameSpan.className = "pts-symbol";
    nameSpan.textContent = pos.displayName || pos.symbol || "—";

    const arrowSpan = document.createElement("span");
    arrowSpan.className = "pts-arrow";
    arrowSpan.textContent =
      w5pnl > 0 ? "▲" : w5pnl < 0 ? "▼" : "●";

    const changeSpan = document.createElement("span");
    changeSpan.className = "pts-change";
    changeSpan.textContent = `${formatSigned(w5pnl)} (${w5pct.toFixed(2)}%)`;

    item.title = `Last: ${pos.lastPrice ?? "—"} | Qty: ${pos.quantity ?? 0} | Day: ${formatSigned(dPnl)} (${dPct.toFixed(2)}%)`;

    item.appendChild(iconSpan);
    item.appendChild(nameSpan);
    item.appendChild(arrowSpan);
    item.appendChild(changeSpan);
    scrollInner.appendChild(item);
  }

  scrollWrapper.appendChild(scrollInner);
  container.appendChild(scrollWrapper);
}

function getInitials(name) {
  if (!name) return "";
  const parts = String(name)
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function applyTickerSpeed(settings) {
  const duration =
    settings?.tickerStyleConfig?.tickerSpeed ||
    40;
  document.documentElement.style.setProperty(
    "--pts-ticker-duration",
    `${Number(duration)}s`
  );
}
