// Shared data models and helpers for the extension (ES module).

const STORAGE_KEYS = {
  settings: "pts_settings",
  holdings: "pts_holdings",
  priceHistory: "pts_price_history",
  positionsState: "pts_positions_state",
  pollHealth: "pts_poll_health",
  onboarding: "pts_onboarding",
  watchlist: "pts_watchlist",
  metrics: "pts_metrics"
};

/**
 * Activation event (India-first).
 * activated = holdings_count >= 1 AND ticker_enabled
 *             AND >= 1 successful price refresh
 * Finnhub API key is NOT required when prices come from Yahoo (NSE/BSE).
 */
const ACTIVATION_EVENT = "myticker_activated";

/**
 * Pure activation predicate.
 * hasApiKey is accepted for backward-compatible call sites but ignored.
 */
function isActivated({ holdingsCount, tickerEnabled, hasSuccessfulRefresh }) {
  return !!(holdingsCount >= 1 && tickerEnabled && hasSuccessfulRefresh);
}

/** True if any symbol needs Finnhub (not .NS / .BO). */
function needsFinnhubKey(holdings) {
  if (!Array.isArray(holdings) || !holdings.length) return false;
  return holdings.some((h) => {
    const s = String(h?.symbol || "");
    return s && !s.endsWith(".NS") && !s.endsWith(".BO");
  });
}

/**
 * Record today's local date in activeDays (dedupe, cap at 400 newest).
 * Returns a new array; does not mutate input.
 */
function recordActiveDay(activeDays, now = Date.now()) {
  const d = new Date(now);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const prev = Array.isArray(activeDays) ? activeDays : [];
  if (prev.includes(today)) return prev.slice();
  const next = [...prev, today];
  if (next.length > 400) return next.slice(next.length - 400);
  return next;
}

const DEFAULT_SETTINGS = {
  enabled: true,
  priceProvider: "finnhub",
  priceProviderConfig: {
    apiKey: "",
    baseUrl: "https://finnhub.io/api/v1",
    refreshMinutes: 1
  },
  tickerStyleConfig: {
    theme: "dark",
    tickerSpeed: 40
  },
  cryptoConfig: {
    includeCrypto: false,
    mode: "top5", // "top5" | "manual"
    manualHoldings: [] // [{ symbol, quantity }]
  },
  portfolioFilters: {
    showStocks: true,
    showCrypto: true
  }
};

/**
 * Merge new quote snapshot into existing history.
 * History shape:
 * {
 *   [symbol]: Array<{ t: number, p: number }>
 * }
 */
function mergePriceSnapshots(history, quotes, timestamp) {
  const next = { ...history };
  const cutoff = timestamp - 15 * 60 * 1000; // keep last 15 minutes

  for (const q of quotes) {
    const list = (next[q.symbol] || []).filter((s) => s.t >= cutoff);
    list.push({ t: timestamp, p: q.lastPrice, prevClose: q.prevClose ?? null });
    next[q.symbol] = list;
  }

  // Also prune any symbols that have become stale.
  for (const [sym, list] of Object.entries(next)) {
    const filtered = list.filter((s) => s.t >= cutoff);
    if (!filtered.length) {
      delete next[sym];
    } else {
      next[sym] = filtered;
    }
  }

  return next;
}

/**
 * Compute 5-minute and daily P&L for each holding.
 * Returns structure:
 * {
 *   positions: [
 *     {
 *       symbol, displayName, quantity, lastPrice,
 *       window5mPnl, window5mPnlPct,
 *       dayPnl, dayPnlPct
 *     }
 *   ],
 *   aggregate: {
 *     dayPnl, dayPnlPct
 *   }
 * }
 */
function computePositionsState(holdings, priceHistory, now) {
  const windowStart = now - 5 * 60 * 1000;
  let totalCostDayBase = 0;
  let totalValueNow = 0;
  let totalCost5mBase = 0;
  let totalValue5mNow = 0;
  let stockCostBase = 0;
  let stockValueNow = 0;
  let cryptoCostBase = 0;
  let cryptoValueNow = 0;

  const positions = holdings.map((h) => {
    const history = priceHistory[h.symbol] || [];
    if (!history.length) {
      return {
        symbol: h.symbol,
        displayName: h.displayName || h.symbol,
        quantity: h.quantity,
        lastPrice: null,
        window5mPnl: 0,
        window5mPnlPct: 0,
        dayPnl: 0,
        dayPnlPct: 0,
        assetClass: h.assetClass || "stock",
        brokerId: h.brokerId
      };
    }

    const latest = history[history.length - 1];
    const lastPrice = latest.p;

    // 5-minute baseline: earliest sample >= windowStart; if none, earliest sample overall.
    let baseline5m = history.find((s) => s.t >= windowStart)?.p ?? history[0].p;

    const window5mPnl = (lastPrice - baseline5m) * h.quantity;
    const window5mPnlPct = baseline5m ? ((lastPrice - baseline5m) / baseline5m) * 100 : 0;
    totalCost5mBase += baseline5m * h.quantity;
    totalValue5mNow += lastPrice * h.quantity;

    // Daily baseline: prefer prevClose from the API (exchange-aware),
    // which correctly handles timezone differences (e.g. an Indian user
    // tracking NYSE stocks sees P&L relative to NYSE's previous close,
    // not midnight IST). Falls back to earliest sample of the local day
    // only when prevClose is unavailable.
    let dayBaseline = latest.prevClose ?? null;
    if (dayBaseline == null) {
      const startOfDay = getStartOfDayTimestamp(now);
      const daySample = history.find((s) => s.t >= startOfDay) ?? history[0];
      dayBaseline = daySample.p;
    }

    const dayPnl = (lastPrice - dayBaseline) * h.quantity;
    const dayPnlPct = dayBaseline ? ((lastPrice - dayBaseline) / dayBaseline) * 100 : 0;

    const positionValueBase = dayBaseline * h.quantity;
    const positionValueNow = lastPrice * h.quantity;

    totalCostDayBase += positionValueBase;
    totalValueNow += positionValueNow;

    const assetClass = h.assetClass || "stock";
    if (assetClass === "crypto") {
      cryptoCostBase += positionValueBase;
      cryptoValueNow += positionValueNow;
    } else {
      stockCostBase += positionValueBase;
      stockValueNow += positionValueNow;
    }

    return {
      symbol: h.symbol,
      displayName: h.displayName || h.symbol,
      quantity: h.quantity,
      lastPrice,
      window5mPnl,
      window5mPnlPct,
      dayPnl,
      dayPnlPct,
      assetClass: h.assetClass || "stock",
      brokerId: h.brokerId
    };
  });

  const aggregateDayPnl = totalValueNow - totalCostDayBase;
  const aggregateDayPnlPct =
    totalCostDayBase > 0 ? (aggregateDayPnl / totalCostDayBase) * 100 : 0;

  const aggregateWindow5mPnl = totalValue5mNow - totalCost5mBase;
  const aggregateWindow5mPnlPct =
    totalCost5mBase > 0 ? (aggregateWindow5mPnl / totalCost5mBase) * 100 : 0;

  const stockDayPnl = stockValueNow - stockCostBase;
  const stockDayPnlPct = stockCostBase > 0 ? (stockDayPnl / stockCostBase) * 100 : 0;

  const cryptoDayPnl = cryptoValueNow - cryptoCostBase;
  const cryptoDayPnlPct =
    cryptoCostBase > 0 ? (cryptoDayPnl / cryptoCostBase) * 100 : 0;

  return {
    positions,
    aggregate: {
      dayPnl: aggregateDayPnl,
      dayPnlPct: aggregateDayPnlPct,
      window5mPnl: aggregateWindow5mPnl,
      window5mPnlPct: aggregateWindow5mPnlPct,
      stockDayPnl,
      stockDayPnlPct,
      cryptoDayPnl,
      cryptoDayPnlPct
    }
  };
}

/**
 * Format a number with a leading sign.
 * Centralised here to avoid duplication across content script and popup.
 */
function formatSigned(value) {
  const num = Number(value) || 0;
  if (num > 0) return `+${num.toFixed(2)}`;
  return num.toFixed(2);
}

/**
 * Format a value as currency (INR or USD).
 */
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

/**
 * Signed currency for P&L displays (e.g. +₹1,234.56).
 */
function formatSignedCurrency(value, currency = "INR") {
  const num = Number(value) || 0;
  const abs = formatCurrency(Math.abs(num), currency);
  if (num > 0) return `+${abs}`;
  if (num < 0) return `-${abs}`;
  return abs;
}

/** Pick INR when most holdings are Indian brokers. */
function inferDisplayCurrency(holdings) {
  if (!holdings?.length) return "INR";
  const inrCount = holdings.filter((h) => (h.currency || "INR") === "INR").length;
  return inrCount >= holdings.length / 2 ? "INR" : "USD";
}

function getStartOfDayTimestamp(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ES module exports for background, options, popup, and content script.
export {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  ACTIVATION_EVENT,
  isActivated,
  needsFinnhubKey,
  recordActiveDay,
  mergePriceSnapshots,
  computePositionsState,
  formatSigned,
  formatCurrency,
  formatSignedCurrency,
  inferDisplayCurrency
};
