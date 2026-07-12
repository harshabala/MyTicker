// Injects the ticker strip into every page and keeps it updated from storage.

import { STORAGE_KEYS, formatSigned, formatSignedCurrency } from "./shared.js";

const TICKER_CONTAINER_ID = "pts-ticker-container";
const ORIGINAL_MARGIN_ATTR = "data-pts-original-margin-top";
const BODY_TRANSITION_ATTR = "data-pts-body-transition";

/** Closed shadow root kept in-module so host pages cannot scrape holdings DOM. */
let tickerHost = null;
let tickerShadow = null;
let tickerBar = null;

const reducedMotionMq = window.matchMedia("(prefers-reduced-motion: reduce)");

function prefersReducedMotion() {
  return reducedMotionMq.matches;
}

reducedMotionMq.addEventListener("change", () => {
  if (tickerBar) {
    tickerBar.classList.toggle("pts-reduced-motion", prefersReducedMotion());
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
      ensureTickerContainer(false);
      applyTickerSpeed(settings);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes[STORAGE_KEYS.settings]) {
      const newSettings = changes[STORAGE_KEYS.settings].newValue;
      if (newSettings && newSettings.enabled) {
        ensureTickerContainer(true);
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

function setBodyMarginTop(px, animate, isExit = false) {
  if (!document.body) return;
  const reduced = prefersReducedMotion();
  const shouldAnimate = animate && !reduced;

  if (shouldAnimate) {
    const duration = isExit ? "var(--motion-fast, 150ms)" : "var(--motion-bar-enter, 300ms)";
    document.body.style.transition = `margin-top ${duration} var(--ease-out, ease)`;
    document.body.setAttribute(BODY_TRANSITION_ATTR, "1");
    // Force a reflow so the transition style is registered by the browser before updating margin-top
    void document.body.offsetHeight;
  } else {
    document.body.style.transition = "";
    document.body.removeAttribute(BODY_TRANSITION_ATTR);
  }

  document.body.style.marginTop = px > 0 ? `${px}px` : "";
}

function ensureTickerContainer(animate = false) {
  if (tickerHost && document.documentElement.contains(tickerHost) && tickerBar) return;

  if (!document.body) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        ensureTickerContainer(animate);
      },
      { once: true }
    );
    return;
  }

  // Host is a zero-size mount; UI lives in closed shadow (pages cannot scrape P&L DOM).
  tickerHost = document.createElement("div");
  tickerHost.id = TICKER_CONTAINER_ID;
  tickerHost.setAttribute("data-myticker", "1");
  tickerHost.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483000;pointer-events:none;";

  tickerShadow = tickerHost.attachShadow({ mode: "closed" });

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("ticker.css");
  tickerShadow.appendChild(link);

  tickerBar = document.createElement("div");
  tickerBar.className = "pts-ticker-bar";
  tickerBar.style.pointerEvents = "auto";
  if (prefersReducedMotion() || !animate) {
    tickerBar.classList.add("pts-reduced-motion", "pts-ticker-visible");
  }
  tickerShadow.appendChild(tickerBar);

  document.documentElement.insertBefore(tickerHost, document.body);

  if (!document.body.hasAttribute(ORIGINAL_MARGIN_ATTR)) {
    const rect = document.body.getBoundingClientRect();
    const offset = Math.max(0, rect.top);
    document.body.setAttribute(ORIGINAL_MARGIN_ATTR, String(offset));
  }
  const originalPx = Number(document.body.getAttribute(ORIGINAL_MARGIN_ATTR)) || 0;
  setBodyMarginTop(originalPx + 28, animate, false);

  if (!prefersReducedMotion() && animate) {
    requestAnimationFrame(() => {
      tickerBar.classList.add("pts-ticker-visible");
    });
  }
}

function restoreBodyMargin(animate) {
  if (!document.body || !document.body.hasAttribute(ORIGINAL_MARGIN_ATTR)) return;
  const originalPx = Number(document.body.getAttribute(ORIGINAL_MARGIN_ATTR)) || 0;
  
  if (!animate || prefersReducedMotion()) {
    setBodyMarginTop(originalPx, false);
    document.body.removeAttribute(ORIGINAL_MARGIN_ATTR);
    return;
  }

  setBodyMarginTop(originalPx, true, true);

  const cleanup = () => {
    document.body.style.transition = "";
    document.body.removeAttribute(BODY_TRANSITION_ATTR);
    document.body.removeAttribute(ORIGINAL_MARGIN_ATTR);
  };

  document.body.addEventListener("transitionend", cleanup, { once: true });
  setTimeout(cleanup, 200);
}

function removeTickerContainer() {
  if (!tickerHost || !tickerBar) {
    restoreBodyMargin(false);
    tickerHost = null;
    tickerShadow = null;
    tickerBar = null;
    return;
  }

  const host = tickerHost;
  const bar = tickerBar;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (host.parentNode) host.parentNode.removeChild(host);
    delete bar._ptsParts;
    tickerHost = null;
    tickerShadow = null;
    tickerBar = null;
  };

  if (prefersReducedMotion()) {
    restoreBodyMargin(false);
    finish();
    return;
  }

  bar.classList.remove("pts-ticker-visible");
  bar.classList.add("pts-ticker-exiting");
  restoreBodyMargin(true);

  const onEnd = (e) => {
    if (e.propertyName !== "opacity") return;
    finish();
  };
  bar.addEventListener("transitionend", onEnd, { once: true });
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
  const sym = String(pos.symbol || pos.displayName || "").toUpperCase();
  const broker = String(pos.brokerId || "").toUpperCase();
  const exchange = String(pos.exchange || "").toUpperCase();
  return `${sym}|${broker}|${exchange}`;
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
  // Privacy: never expose quantity in title attributes (page-scrape surface)
  item.title = `${pos.displayName || pos.symbol || ""} · Day ${formatSigned(dPnl)} (${dPct.toFixed(2)}%)`;

  const [iconSpan, nameSpan, arrowSpan, changeSpan] = item.children;
  iconSpan.textContent = getInitials(pos.displayName);
  nameSpan.textContent = pos.displayName || pos.symbol || "—";
  arrowSpan.textContent = ""; // color-only deltas (arrows hidden in CSS)
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
    } else {
      updateItemElement(item, pos);
    }
  }

  parts.scrollInner.classList.toggle("pts-scroll-static", reduced);
}

function clearTickerContent(container) {
  const parts = container._ptsParts;
  if (parts?.stale) {
    parts.stale.remove();
    parts.stale = null;
  }
  if (parts?.aggregate) {
    parts.aggregate.textContent = "No holdings — import CSV in Settings";
    parts.aggregate.classList.remove("pts-up", "pts-down", "pts-flat");
    parts.aggregate.classList.add("pts-flat");
    delete parts.aggregate.dataset.ptsSign;
  }
  if (parts?.scrollInner) {
    while (parts.scrollInner.firstChild) {
      parts.scrollInner.removeChild(parts.scrollInner.firstChild);
    }
  }
}

function renderTicker(state) {
  if (!tickerBar) return;

  tickerBar.classList.toggle("pts-reduced-motion", prefersReducedMotion());

  if (!state?.positions?.length) {
    clearTickerContent(tickerBar);
    return;
  }

  const parts = getTickerParts(tickerBar);
  updateStaleIndicator(tickerBar, parts, state);
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
  const value = `${Number(duration)}s`;
  // Set on host document (inherited) and bar if present
  document.documentElement.style.setProperty("--pts-ticker-duration", value);
  if (tickerBar) {
    tickerBar.style.setProperty("--pts-ticker-duration", value);
  }
}