// Minimal classic-script bridge for the content script. Keep this API small:
// background, popup, and options continue to use the ESM shared.js module.
(function exposeMyTickerContentShared(global) {
  const STORAGE_KEYS = {
    settings: "pts_settings",
    holdings: "pts_holdings",
    priceHistory: "pts_price_history",
    positionsState: "pts_positions_state",
    pollHealth: "pts_poll_health",
    onboarding: "pts_onboarding",
    watchlist: "pts_watchlist",
    metrics: "pts_metrics",
    contentScriptStatus: "pts_content_script_status"
  };

  function roundToCents(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return 0;
    // Half away from zero; the tiny relative nudge absorbs binary error (x.xx5).
    const cents = Math.round(Math.abs(raw) * 100 * (1 + 1e-12));
    return cents === 0 ? 0 : Math.sign(raw) * cents / 100;
  }

  function formatSigned(value) {
    const num = roundToCents(value);
    if (num > 0) return `+${num.toFixed(2)}`;
    return num.toFixed(2);
  }

  function formatCurrency(value, currency = "INR") {
    const num = Number(value) || 0;
    const cur = currency === "USD" ? "USD" : "INR";
    try {
      return num.toLocaleString(cur === "INR" ? "en-IN" : "en-US", {
        style: "currency",
        currency: cur,
        maximumFractionDigits: 2
      });
    } catch {
      return cur === "INR" ? `₹${num.toFixed(2)}` : `$${num.toFixed(2)}`;
    }
  }

  function formatSignedCurrency(value, currency = "INR") {
    const num = roundToCents(value);
    const abs = formatCurrency(Math.abs(num), currency);
    if (num > 0) return `+${abs}`;
    if (num < 0) return `-${abs}`;
    return abs;
  }

  function formatQuotePrice(value, currency = "USD") {
    if (!Number.isFinite(value)) return "—";

    const fractionDigits = Math.abs(value) >= 100 ? 2 : 4;
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(value);
  }

  // Mirror of shared.js describeFreshness (content scripts cannot import ESM).
  function describeFreshness(state, now = Date.now(), refreshMinutes = 1) {
    if (!state) return "stale";
    const maxAge = Math.max(5 * 60 * 1000, 3 * Math.max(1, Number(refreshMinutes) || 1) * 60 * 1000);
    const updatedAt = Number(state.updatedAt);
    if (state.staleWarning || !Number.isFinite(updatedAt) || now - updatedAt > maxAge) return "stale";
    return state.marketState === "closed" ? "closed" : "live";
  }

  function normalizeExcludedSiteEntry(input) {
    let raw = String(input || "").trim().toLowerCase();
    if (!raw) return "";
    raw = raw.replace(/^\*+\.?/, "");
    try {
      if (raw.includes("://") || raw.startsWith("//")) {
        const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
        raw = url.hostname;
      } else {
        raw = raw.split("/")[0].split("?")[0].split("#")[0];
      }
    } catch {
      return "";
    }
    raw = raw.replace(/\.$/, "").replace(/^www\./, "");
    if (!raw || raw.length > 253) return "";
    if (
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(raw) &&
      raw !== "localhost"
    ) {
      return "";
    }
    return raw;
  }

  function normalizeExcludedSites(list) {
    const out = [];
    const seen = new Set();
    for (const entry of Array.isArray(list) ? list : []) {
      const host = normalizeExcludedSiteEntry(entry);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      out.push(host);
    }
    return out;
  }

  function isHostTapeExcluded(hostname, excludedSites) {
    const host = String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
    if (!host) return false;
    const list = normalizeExcludedSites(excludedSites);
    for (const rule of list) {
      if (host === rule || host.endsWith(`.${rule}`)) return true;
    }
    return false;
  }

  global.__MYTICKER_CONTENT_SHARED__ = Object.freeze({
    STORAGE_KEYS: Object.freeze(STORAGE_KEYS),
    formatSigned,
    formatSignedCurrency,
    formatQuotePrice,
    describeFreshness,
    normalizeExcludedSites,
    isHostTapeExcluded
  });
})(globalThis);
