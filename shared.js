// Shared data models and helpers for the extension (ES module).

const STORAGE_KEYS = {
  settings: "pts_settings",
  settingsSchema: "pts_settings_schema_version",
  holdings: "pts_holdings",
  priceHistory: "pts_price_history",
  positionsState: "pts_positions_state",
  pollHealth: "pts_poll_health",
  onboarding: "pts_onboarding",
  watchlist: "pts_watchlist",
  metrics: "pts_metrics",
  diagnosticsLog: "pts_diagnostics_log",
  contentScriptStatus: "pts_content_script_status"
};

const DIAGNOSTICS_LOG_LIMIT = 40;
const DIAGNOSTIC_EVENTS = new Set([
  "refresh-start",
  "eligible-symbols",
  "provider-results",
  "state-write",
  "refresh-failed",
  "content-script-lifecycle"
]);
const CONTENT_LIFECYCLE_STAGES = new Set([
  "loaded",
  "storage-settings-read",
  "mount-success",
  "render-success",
  "fatal-error"
]);

/**
 * Keep refresh diagnostics operational and safe to copy. This deliberately
 * allows only lifecycle names and aggregate counts: no keys, quantities,
 * symbols, prices, or portfolio values can enter the persisted log.
 */
function sanitizeDiagnosticEntry(entry = {}) {
  const safe = {
    timestamp: Number(entry.timestamp) || Date.now(),
    event: DIAGNOSTIC_EVENTS.has(entry.event) ? entry.event : "unknown"
  };
  for (const key of [
    "holdingsCount", "watchlistCount", "cryptoCount", "equitySymbols",
    "totalSymbols", "equityQuotes", "cryptoQuotes", "quoteCount",
    "coinGeckoQuotes", "binanceQuotes", "yahooQuotes", "finnhubQuotes"
  ]) {
    const value = Number(entry[key]);
    if (Number.isFinite(value) && value >= 0) safe[key] = Math.floor(value);
  }
  if (entry.error && safe.event !== "content-script-lifecycle") safe.error = "Refresh failed";
  if (safe.event === "content-script-lifecycle" && CONTENT_LIFECYCLE_STAGES.has(entry.stage)) {
    safe.stage = entry.stage;
  }
  return safe;
}

/** Return a bounded, newest-last diagnostics log without mutating its input. */
function appendDiagnosticLogEntry(log, entry, limit = DIAGNOSTICS_LOG_LIMIT) {
  const previous = Array.isArray(log) ? log : [];
  const boundedLimit = Math.max(1, Number(limit) || DIAGNOSTICS_LOG_LIMIT);
  return [...previous, sanitizeDiagnosticEntry(entry)].slice(-boundedLimit);
}

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
  schemaVersion: 1,
  enabled: true,
  priceProvider: "finnhub",
  priceProviderConfig: {
    baseUrl: "https://finnhub.io/api/v1",
    refreshMinutes: 1
  },
  tickerStyleConfig: {
    // "system" respects the browser; explicit light/dark remain available.
    theme: "system",
    tickerSpeed: 40,
    tapeScale: "comfortable"
  },
  cryptoConfig: {
    includeCrypto: false,
    mode: "off", // "off" | "top5" | "manual"
    manualHoldings: [] // [{ symbol, quantity }]
  },
  portfolioFilters: {
    showStocks: true,
    showCrypto: true
  }
};

const SETTINGS_SCHEMA_VERSION = 1;
const LEGACY_SYNC_SECRET_FIELDS = new Set(["apiKey", "finnhubApiKey", "finnhub_key", "pts_price_api_key"]);

/**
 * Return the current, secret-free settings shape without mutating the input.
 * API keys used to live in sync settings; deliberately drop those fields here
 * so every migration write removes them from Chrome Sync.
 */
function migrateSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const providerConfig = source.priceProviderConfig && typeof source.priceProviderConfig === "object"
    ? source.priceProviderConfig : {};
  const tickerStyleConfig = source.tickerStyleConfig && typeof source.tickerStyleConfig === "object"
    ? source.tickerStyleConfig : {};
  const cryptoConfig = source.cryptoConfig && typeof source.cryptoConfig === "object" ? source.cryptoConfig : {};
  const portfolioFilters = source.portfolioFilters && typeof source.portfolioFilters === "object" ? source.portfolioFilters : {};
  const cleanProviderConfig = Object.fromEntries(
    Object.entries(providerConfig).filter(([key]) => !LEGACY_SYNC_SECRET_FIELDS.has(key))
  );
  const next = {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(Object.entries(source).filter(([key]) => !LEGACY_SYNC_SECRET_FIELDS.has(key))),
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    priceProviderConfig: { ...DEFAULT_SETTINGS.priceProviderConfig, ...cleanProviderConfig },
    tickerStyleConfig: { ...DEFAULT_SETTINGS.tickerStyleConfig, ...tickerStyleConfig },
    cryptoConfig: normalizeCryptoConfig({ ...DEFAULT_SETTINGS.cryptoConfig, ...cryptoConfig }),
    portfolioFilters: { ...DEFAULT_SETTINGS.portfolioFilters, ...portfolioFilters }
  };
  delete next.priceProviderConfig.apiKey;
  return next;
}

const TAPE_SCALES = new Set(["compact", "comfortable", "large"]);

// The only crypto assets exposed by the settings controls. Keep this catalog
// canonical so storage, quote fetching, and UI labels share one identity.
const CRYPTO_CATALOG = Object.freeze([
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "solana", symbol: "SOL", name: "Solana" }
]);

const CRYPTO_LOOKUP = new Map(CRYPTO_CATALOG.flatMap((coin) => [
  [coin.id, coin], [coin.symbol.toLowerCase(), coin], [coin.name.toLowerCase(), coin]
]));

function resolveCryptoCatalogEntry(input) {
  let raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;
  // Strip common exchange wrappers: BTCUSDT, BTC-USD, X:BTCUSD, BINANCE:BTCUSDT
  raw = raw
    .replace(/^binance:/, "")
    .replace(/^coinbase:/, "")
    .replace(/^x:/, "")
    .replace(/[-_/]/g, "");
  const stripped = raw
    .replace(/(usdt|usdc|busd|fdusd|tusd|inr|usd)$/i, "");
  return (
    CRYPTO_LOOKUP.get(raw) ||
    CRYPTO_LOOKUP.get(stripped) ||
    CRYPTO_LOOKUP.get(raw.replace(/usdt$/, "").replace(/usd$/, "")) ||
    null
  );
}

/** Convert aliases to canonical IDs; sum quantities when the same coin appears more than once. */
function normalizeManualCryptoHoldings(holdings) {
  const selected = new Map();
  for (const holding of Array.isArray(holdings) ? holdings : []) {
    const coin = resolveCryptoCatalogEntry(holding?.symbol);
    const quantity = Number(holding?.quantity);
    if (coin && Number.isFinite(quantity) && quantity > 0) {
      const prev = selected.get(coin.id);
      selected.set(coin.id, { symbol: coin.id, quantity: (prev?.quantity || 0) + quantity });
    }
  }
  return [...selected.values()];
}

/** Migrate legacy includeCrypto settings into one unambiguous mode field. */
function normalizeCryptoConfig(config = {}) {
  const requested = config.mode;
  const mode = config.includeCrypto === false ? "off"
    : ["off", "top5", "manual"].includes(requested) ? requested
    : config.includeCrypto ? "top5" : "off";
  return { ...config, mode, includeCrypto: mode !== "off", manualHoldings: normalizeManualCryptoHoldings(config.manualHoldings) };
}

function normalizeWatchlistSymbol(input, assetType, exchange = "NSE") {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw || assetType === "crypto" || !/^[A-Z0-9&.-]{1,24}$/.test(raw)) return null;
  if (assetType === "india") {
    const base = raw.replace(/\.(NS|BO)$/, "");
    const suffix = exchange === "BSE" ? ".BO" : ".NS";
    return { symbol: `${base}${suffix}`, displayName: base, exchange: exchange === "BSE" ? "BSE" : "NSE", currency: "INR", assetClass: "watchlist" };
  }
  if (!["us", "index", "etf"].includes(assetType)) return null;
  return { symbol: raw, displayName: raw, exchange: assetType === "us" ? "US" : assetType.toUpperCase(), currency: "USD", assetClass: "watchlist" };
}

/** Return a supported named tape density, safely defaulting legacy settings. */
function normalizeTapeScale(value) {
  return TAPE_SCALES.has(value) ? value : DEFAULT_SETTINGS.tickerStyleConfig.tapeScale;
}

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
        currency: inferDisplayCurrency(h),
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
      currency: inferDisplayCurrency(h),
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
 * Format an individual market quote, preserving precision for lower prices.
 */
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

/**
 * Infer a quote currency without changing a source-supplied INR or USD value.
 * Arrays are supported for aggregate displays: a mixed set has no aggregate
 * currency because combining native-currency P&L values would be misleading.
 */
function inferDisplayCurrency(item = {}) {
  if (Array.isArray(item)) {
    const currencies = new Set(item.map((entry) => inferDisplayCurrency(entry)));
    return currencies.size === 1 ? [...currencies][0] : null;
  }
  if (item.currency === "INR" || item.currency === "USD") return item.currency;
  if (item.assetClass === "crypto") return "USD";
  return /\.(NS|BO)$/i.test(item.symbol || "") ? "INR" : "USD";
}

/** Normalise sources for ticker rendering while keeping holdings P&L intact. */
function normalizeTickerItem(item = {}, kind) {
  return {
    ...item,
    ...(kind ? { kind } : {}),
    currency: inferDisplayCurrency(item)
  };
}

/**
 * Normalise sources for ticker rendering while keeping holdings P&L intact.
 */
function buildTickerItems({ positions = [], watchlist = [], crypto = [] } = {}) {
  return [
    ...positions.map((item) => normalizeTickerItem(item, "holding")),
    ...watchlist.map((item) => ({ ...normalizeTickerItem(item, "watchlist"), dayPnl: null })),
    ...crypto.map((item) => ({ ...normalizeTickerItem(item, "crypto"), dayPnl: null }))
  ];
}

/** Add quote-only tape items without changing the holdings P&L state. */
function withTickerItems({ positionsState, watchlist = [], crypto = [] } = {}) {
  return {
    ...positionsState,
    tickerItems: buildTickerItems({
      positions: positionsState?.positions || [],
      watchlist,
      crypto
    })
  };
}

/**
 * Attach current quotes to quote-only tape items. When a provider has no
 * current quote, keep the latest stored snapshot visible and mark it stale.
 */
function hydrateTickerQuoteItems(items = [], quotes = [], priceHistory = {}) {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  return items.map((item) => {
    const quote = quoteBySymbol.get(item.symbol);
    const snapshot = priceHistory[item.symbol]?.at(-1);
    const price = quote?.lastPrice ?? snapshot?.p ?? null;
    const prevClose = quote?.prevClose ?? snapshot?.prevClose ?? null;
    const changePct = Number.isFinite(quote?.changePct)
      ? quote.changePct
      : Number.isFinite(price) && Number.isFinite(prevClose) && prevClose
        ? ((price - prevClose) / prevClose) * 100
        : null;

    return normalizeTickerItem({
      ...item,
      lastPrice: price,
      prevClose,
      changePct,
      currency: quote?.currency || item.currency,
      source: quote?.source || item.source,
      updatedAt: quote?.updatedAt ?? snapshot?.t ?? item.updatedAt,
      stale: !quote && !!snapshot
    }, item.kind);
  });
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

function getStartOfDayTimestamp(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ES module exports for background, options, popup, and content script.
export {
  STORAGE_KEYS,
  DIAGNOSTICS_LOG_LIMIT,
  sanitizeDiagnosticEntry,
  appendDiagnosticLogEntry,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  migrateSettings,
  CRYPTO_CATALOG,
  resolveCryptoCatalogEntry,
  normalizeCryptoConfig,
  normalizeManualCryptoHoldings,
  normalizeWatchlistSymbol,
  normalizeTapeScale,
  ACTIVATION_EVENT,
  isActivated,
  needsFinnhubKey,
  recordActiveDay,
  mergePriceSnapshots,
  computePositionsState,
  formatSigned,
  formatCurrency,
  formatQuotePrice,
  normalizeTickerItem,
  buildTickerItems,
  withTickerItems,
  hydrateTickerQuoteItems,
  formatSignedCurrency,
  inferDisplayCurrency
};
