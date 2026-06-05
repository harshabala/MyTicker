// Injects the ticker strip into every page and keeps it updated from storage.

import { STORAGE_KEYS, formatSigned, formatSignedCurrency } from "./shared.js";

const TICKER_CONTAINER_ID = "pts-ticker-container";
const TICKER_STYLE_ID = "pts-ticker-style";
const MOTION_STYLE_ID = "pts-motion-style";
const ORIGINAL_MARGIN_ATTR = "data-pts-original-margin-top";
const BODY_TRANSITION_ATTR = "data-pts-body-transition";

const reducedMotionMq = window.matchMedia("(prefers-reduced-motion: reduce)");

function prefersReducedMotion() {
  return reducedMotionMq.matches;
}

reducedMotionMq.addEventListener("change", () => {
  const container = document.getElementById(TICKER_CONTAINER_ID);
  if (container) {
    container.classList.toggle("pts-reduced-motion", prefersReducedMotion());
    chrome.storage.local.get([STORAGE_KEYS.positionsState], (data) => {
      const state = data[STORAGE_KEYS.positionsState];
      if (state) renderTicker(state);
    });
  }
});

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

function loadTickerStyles() {
  if (!document.getElementById(MOTION_STYLE_ID)) {
    const motionLink = document.createElement("link");
    motionLink.id = MOTION_STYLE_ID;
    motionLink.rel = "stylesheet";
    motionLink.href = chrome.runtime.getURL("motion.css");
    document.documentElement.insertBefore(
      motionLink,
      document.documentElement.firstChild
    );
  }

  if (!document.getElementById(TICKER_STYLE_ID)) {
    const link = document.createElement("link");
    link.id = TICKER_STYLE_ID;
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("ticker.css");
    document.documentElement.insertBefore(link, document.documentElement.firstChild);
  }
}

function setBodyMarginTop(px, animate) {
  if (!document.body) return;
  const reduced = prefersReducedMotion();
  const shouldAnimate = animate && !reduced;

  if (shouldAnimate && !document.body.hasAttribute(BODY_TRANSITION_ATTR)) {
    document.body.style.transition = "margin-top var(--motion-medium, 250ms) var(--ease-out, ease)";
    document.body.setAttribute(BODY_TRANSITION_ATTR, "1");
  }

  if (!shouldAnimate && document.body.hasAttribute(BODY_TRANSITION_ATTR)) {
    document.body.style.transition = "";
    document.body.removeAttribute(BODY_TRANSITION_ATTR);
  }

  document.body.style.marginTop = px > 0 ? `${px}px` : "";
}

function ensureTickerContainer() {
  if (document.getElementById(TICKER_CONTAINER_ID)) return;

  if (!document.body) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        ensureTickerContainer();
      },
      { once: true }
    );
    return;
  }

  loadTickerStyles();

  const bar = document.createElement("div");
  bar.id = TICKER_CONTAINER_ID;
  bar.className = "pts-ticker-bar";
  if (prefersReducedMotion()) {
    bar.classList.add("pts-reduced-motion", "pts-ticker-visible");
  }

  document.documentElement.insertBefore(bar, document.body);

  if (!document.body.hasAttribute(ORIGINAL_MARGIN_ATTR)) {
    const rect = document.body.getBoundingClientRect();
    const offset = Math.max(0, rect.top);
    document.body.setAttribute(ORIGINAL_MARGIN_ATTR, String(offset));
  }
  const originalPx = Number(document.body.getAttribute(ORIGINAL_MARGIN_ATTR)) || 0;
  setBodyMarginTop(originalPx + 32, true);

  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => {
      bar.classList.add("pts-ticker-visible");
    });
  }
}

function restoreBodyMargin() {
  if (!document.body || !document.body.hasAttribute(ORIGINAL_MARGIN_ATTR)) return;
  const originalPx = Number(document.body.getAttribute(ORIGINAL_MARGIN_ATTR)) || 0;
  setBodyMarginTop(originalPx, true);

  const cleanup = () => {
    document.body.style.marginTop = originalPx > 0 ? `${originalPx}px` : "";
    if (originalPx === 0) {
      document.body.style.marginTop = "";
    }
    document.body.style.transition = "";
    document.body.removeAttribute(BODY_TRANSITION_ATTR);
    document.body.removeAttribute(ORIGINAL_MARGIN_ATTR);
  };

  if (prefersReducedMotion()) {
    cleanup();
    return;
  }

  document.body.addEventListener("transitionend", cleanup, { once: true });
  setTimeout(cleanup, 320);
}

function removeTickerContainer() {
  const existing = document.getElementById(TICKER_CONTAINER_ID);
  if (!existing) {
    restoreBodyMargin();
    return;
  }

  const finish = () => {
    if (existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    delete existing._ptsParts;
    restoreBodyMargin();
  };

  if (prefersReducedMotion()) {
    finish();
    return;
  }

  existing.classList.remove("pts-ticker-visible");
  existing.classList.add("pts-ticker-exiting");

  const onEnd = (e) => {
    if (e.propertyName !== "opacity") return;
    finish();
  };
  existing.addEventListener("transitionend", onEnd, { once: true });
  setTimeout(finish, 200);
}

function getTickerParts(container) {
  if (!container._ptsParts) {
    const aggregate = document.createElement("div");
    aggregate.className = "pts-aggregate";
    aggregate.setAttribute("role", "status");
    aggregate.setAttribute("aria-label", "Portfolio day profit and loss");

    const scrollWrapper = document.createElement("div");
    scrollWrapper.className = "pts-scroll-wrapper";
    const scrollInner = document.createElement("div");
    scrollInner.className = "pts-scroll-inner";
    scrollWrapper.appendChild(scrollInner);

    container.appendChild(aggregate);
    container.appendChild(scrollWrapper);

    container._ptsParts = {
      stale: null,
      aggregate,
      scrollWrapper,
      scrollInner
    };
  }
  return container._ptsParts;
}

function positionKey(pos) {
  return String(pos.symbol || pos.displayName || "").toUpperCase();
}

function updateStaleIndicator(container, parts, state) {
  if (state?.staleWarning) {
    if (!parts.stale) {
      parts.stale = document.createElement("div");
      parts.stale.className = "pts-stale-indicator";
      parts.stale.setAttribute("role", "status");
      parts.stale.title =
        "Price data may be outdated – check your API key or network";
      container.insertBefore(parts.stale, container.firstChild);
    }
    parts.stale.textContent = "⚠ Stale";
  } else if (parts.stale) {
    parts.stale.remove();
    parts.stale = null;
  }
}

function updateAggregate(parts, state) {
  const aggregate = parts.aggregate;
  const aggPnl = Number(state?.aggregate?.dayPnl) || 0;
  const aggPct = Number(state?.aggregate?.dayPnlPct) || 0;
  const currency = state?.displayCurrency || "INR";
  const dirClass = aggPnl > 0 ? "pts-up" : aggPnl < 0 ? "pts-down" : "pts-flat";
  const newSign = aggPnl > 0 ? "up" : aggPnl < 0 ? "down" : "flat";

  aggregate.classList.remove("pts-up", "pts-down", "pts-flat");
  aggregate.classList.add(dirClass);

  const prevSign = aggregate.dataset.ptsSign;
  if (prevSign && prevSign !== newSign && !prefersReducedMotion()) {
    aggregate.classList.remove("pts-aggregate-flash");
    void aggregate.offsetWidth;
    aggregate.classList.add("pts-aggregate-flash");
  }
  aggregate.dataset.ptsSign = newSign;

  aggregate.textContent = `Today ${formatSignedCurrency(aggPnl, currency)} (${aggPct.toFixed(2)}%)`;
}

function buildItemElement(pos) {
  const item = document.createElement("div");
  item.className = "pts-item";
  item.dataset.ptsKey = positionKey(pos);

  const iconSpan = document.createElement("span");
  iconSpan.className = "pts-icon";

  const nameSpan = document.createElement("span");
  nameSpan.className = "pts-symbol";

  const arrowSpan = document.createElement("span");
  arrowSpan.className = "pts-arrow";

  const changeSpan = document.createElement("span");
  changeSpan.className = "pts-change";

  item.appendChild(iconSpan);
  item.appendChild(nameSpan);
  item.appendChild(arrowSpan);
  item.appendChild(changeSpan);

  return item;
}

function updateItemElement(item, pos) {
  const w5pnl = Number(pos.window5mPnl) || 0;
  const w5pct = Number(pos.window5mPnlPct) || 0;
  const dPnl = Number(pos.dayPnl) || 0;
  const dPct = Number(pos.dayPnlPct) || 0;

  const dirClass = w5pnl > 0 ? "pts-up" : w5pnl < 0 ? "pts-down" : "pts-flat";
  item.classList.remove("pts-up", "pts-down", "pts-flat", "pts-crypto");
  item.classList.add(dirClass);
  if (pos.assetClass === "crypto") {
    item.classList.add("pts-crypto");
  }

  item.dataset.ptsKey = positionKey(pos);
  item.title = `Last: ${pos.lastPrice ?? "—"} | Qty: ${pos.quantity ?? 0} | Day: ${formatSigned(dPnl)} (${dPct.toFixed(2)}%)`;

  const [iconSpan, nameSpan, arrowSpan, changeSpan] = item.children;
  iconSpan.textContent = getInitials(pos.displayName);
  nameSpan.textContent = pos.displayName || pos.symbol || "—";
  arrowSpan.textContent = w5pnl > 0 ? "▲" : w5pnl < 0 ? "▼" : "●";
  changeSpan.textContent = `${formatSigned(w5pnl)} (${w5pct.toFixed(2)}%)`;
}

function updateScrollItems(parts, state) {
  const positions = state?.positions || [];
  const reduced = prefersReducedMotion();
  const scrollInner = parts.scrollInner;
  const slotCount = reduced ? positions.length : positions.length * 2;

  while (scrollInner.children.length > slotCount) {
    scrollInner.removeChild(scrollInner.lastChild);
  }

  for (let i = 0; i < slotCount; i++) {
    const pos = positions[i % positions.length];
    if (!pos) continue;

    let item = scrollInner.children[i];
    if (!item) {
      item = buildItemElement(pos);
      scrollInner.appendChild(item);
    } else if (item.dataset.ptsKey !== positionKey(pos)) {
      updateItemElement(item, pos);
    } else {
      updateItemElement(item, pos);
    }
  }

  parts.scrollInner.classList.toggle("pts-scroll-static", reduced);
}

function renderTicker(state) {
  const container = document.getElementById(TICKER_CONTAINER_ID);
  if (!container) return;

  container.classList.toggle("pts-reduced-motion", prefersReducedMotion());

  const parts = getTickerParts(container);
  updateStaleIndicator(container, parts, state);
  updateAggregate(parts, state);
  updateScrollItems(parts, state);
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