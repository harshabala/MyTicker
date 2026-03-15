// Shared data models and helpers for the extension.

export const STORAGE_KEYS = {
  settings: "pts_settings",
  holdings: "pts_holdings",
  priceHistory: "pts_price_history",
  positionsState: "pts_positions_state"
};

export const DEFAULT_SETTINGS = {
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
export function mergePriceSnapshots(history, quotes, timestamp) {
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
export function computePositionsState(holdings, priceHistory, now) {
  const windowStart = now - 5 * 60 * 1000;
  let totalCostDayBase = 0;
  let totalValueNow = 0;
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
        dayPnlPct: 0
      };
    }

    const latest = history[history.length - 1];
    const lastPrice = latest.p;

    // 5-minute baseline: earliest sample >= windowStart; if none, earliest sample overall.
    let baseline5m = history.find((s) => s.t >= windowStart)?.p ?? history[0].p;

    const window5mPnl = (lastPrice - baseline5m) * h.quantity;
    const window5mPnlPct = baseline5m ? ((lastPrice - baseline5m) / baseline5m) * 100 : 0;

    // Daily baseline: use prevClose from latest sample if available, else first sample of the day.
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
      stockDayPnl,
      stockDayPnlPct,
      cryptoDayPnl,
      cryptoDayPnlPct
    }
  };
}

function getStartOfDayTimestamp(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

