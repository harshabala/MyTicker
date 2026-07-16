// Standalone test script for shared.js core logic.
// Run with: node test_fixtures/test_shared.mjs
// Tests the pure-logic functions without requiring Chrome APIs.

import {
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
  inferDisplayCurrency,
  normalizeTapeScale,
  CRYPTO_CATALOG,
  normalizeWatchlistSymbol,
  resolveCryptoCatalogEntry,
  normalizeCryptoConfig,
  normalizeManualCryptoHoldings,
  normalizeTickerItem,
  formatQuotePrice,
  buildTickerItems,
  withTickerItems,
  hydrateTickerQuoteItems,
  sanitizeDiagnosticEntry,
  appendDiagnosticLogEntry,
  DIAGNOSTICS_LOG_LIMIT
} from "../shared.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

function assertApprox(actual, expected, epsilon, message) {
  assert(
    Math.abs(actual - expected) < epsilon,
    `${message} (got ${actual}, expected ~${expected})`
  );
}

// ── Test Suite: STORAGE_KEYS ──
console.log("\n🔑 STORAGE_KEYS");
assert(STORAGE_KEYS.settings === "pts_settings", "settings key correct");
assert(STORAGE_KEYS.holdings === "pts_holdings", "holdings key correct");
assert(STORAGE_KEYS.priceHistory === "pts_price_history", "priceHistory key correct");
assert(STORAGE_KEYS.positionsState === "pts_positions_state", "positionsState key correct");
assert(STORAGE_KEYS.watchlist === "pts_watchlist", "watchlist key correct");
assert(STORAGE_KEYS.metrics === "pts_metrics", "metrics key correct");
assert(STORAGE_KEYS.diagnosticsLog === "pts_diagnostics_log", "diagnostics log key correct");
assert(STORAGE_KEYS.contentScriptStatus === "pts_content_script_status", "content status key correct");

// ── Test Suite: diagnostics log privacy and bounds ──
console.log("\n🔎 diagnostics log helpers");
const unsafeDiagnostic = sanitizeDiagnosticEntry({
  timestamp: 100,
  event: "refresh-failed",
  holdingsCount: 2,
  quoteCount: 4,
  quantity: 900,
  apiKey: "secret-token",
  portfolioValue: 123456,
  error: "request failed with token=secret-token"
});
assert(unsafeDiagnostic.timestamp === 100 && unsafeDiagnostic.event === "refresh-failed", "keeps timestamp and lifecycle event");
assert(unsafeDiagnostic.holdingsCount === 2 && unsafeDiagnostic.quoteCount === 4, "keeps safe operational counts");
assert(!("quantity" in unsafeDiagnostic) && !("apiKey" in unsafeDiagnostic) && !("portfolioValue" in unsafeDiagnostic), "removes quantities, keys, and portfolio values");
assert(unsafeDiagnostic.error === "Refresh failed", "replaces unsafe error details with a generic label");
const hostileEventDiagnostic = sanitizeDiagnosticEntry({
  timestamp: 101,
  event: "token=secret-token; DROP TABLE diagnostics",
  quoteCount: 1
});
assert(hostileEventDiagnostic.event === "unknown", "replaces hostile lifecycle event text with unknown");
assert(!JSON.stringify(hostileEventDiagnostic).includes("secret-token"), "does not preserve secret-like event input");
const boundedDiagnostics = Array.from({ length: DIAGNOSTICS_LOG_LIMIT + 2 }, (_, i) => ({ timestamp: i, event: "refresh-start" }))
  .reduce((log, entry) => appendDiagnosticLogEntry(log, entry), []);
assert(boundedDiagnostics.length === DIAGNOSTICS_LOG_LIMIT, "caps diagnostics log at its configured bound");
assert(boundedDiagnostics[0].timestamp === 2, "keeps the newest diagnostics entries when bounded");

const contentDiagnostic = appendDiagnosticLogEntry([], {
  timestamp: 123,
  event: "content-script-lifecycle",
  stage: "mount-success",
  origin: "https://www.linkedin.com/feed/",
  error: "unexpected details"
})[0];
assert(contentDiagnostic.event === "content-script-lifecycle", "accepts content lifecycle diagnostics");
assert(contentDiagnostic.stage === "mount-success", "retains the aggregate lifecycle stage");
assert(!("origin" in contentDiagnostic) && !("error" in contentDiagnostic), "content lifecycle log excludes page and error details");

// ── Test Suite: DEFAULT_SETTINGS ──
console.log("\n⚙️  DEFAULT_SETTINGS");
assert(DEFAULT_SETTINGS.enabled === true, "enabled by default");
assert(DEFAULT_SETTINGS.priceProvider === "finnhub", "default provider is finnhub");
assert(DEFAULT_SETTINGS.tickerStyleConfig.tickerSpeed === 40, "default speed is 40s");
assert(DEFAULT_SETTINGS.tickerStyleConfig.tapeScale === "comfortable", "default tape size is comfortable");
assert(DEFAULT_SETTINGS.cryptoConfig.includeCrypto === false, "crypto disabled by default");
assert(normalizeTapeScale("compact") === "compact", "accepts compact tape size");
assert(normalizeTapeScale("large") === "large", "accepts large tape size");
assert(normalizeTapeScale("unknown") === "comfortable", "falls back to comfortable tape size");
assert(normalizeTapeScale() === "comfortable", "uses comfortable tape size when unset");

// ── Test Suite: explicit watchlist and crypto catalog controls ──
console.log("\n🔭 Watchlist and crypto controls");
assert(normalizeWatchlistSymbol(" reliance ", "india", "NSE")?.symbol === "RELIANCE.NS", "normalizes NSE watchlist symbols with .NS");
assert(normalizeWatchlistSymbol("reliance.bo", "india", "BSE")?.symbol === "RELIANCE.BO", "replaces an Indian suffix for the selected BSE exchange");
assert(normalizeWatchlistSymbol("spy", "index")?.symbol === "SPY", "normalizes index and ETF symbols without an exchange suffix");
assert(normalizeWatchlistSymbol("BTC", "crypto") === null, "keeps crypto out of the equity watchlist normalizer");
assert(resolveCryptoCatalogEntry("Bitcoin")?.id === "bitcoin", "finds canonical crypto by full name");
assert(resolveCryptoCatalogEntry("ETH")?.id === "ethereum", "finds canonical crypto by ticker");
assert(resolveCryptoCatalogEntry("dogecoin") === null, "rejects unsupported crypto with no silent substitution");
assert(normalizeCryptoConfig({ includeCrypto: false, mode: "top5" }).mode === "off", "migrates legacy disabled crypto setting to explicit off mode");
assert(normalizeCryptoConfig({ includeCrypto: true, mode: "manual" }).mode === "manual", "keeps legacy enabled manual crypto setting");
const migratedManual = normalizeManualCryptoHoldings([{ symbol: "BTC", quantity: 2 }, { symbol: "BINANCE:BTCUSDT", quantity: 4 }, { symbol: "ETH", quantity: 0 }]);
assert(migratedManual.length === 1 && migratedManual[0].symbol === "bitcoin" && migratedManual[0].quantity === 2, "canonicalizes legacy manual crypto and keeps the first positive quantity per coin");

// ── Test Suite: formatSigned ──
console.log("\n🔢 formatSigned");
assert(formatSigned(42.5) === "+42.50", "positive value shows +");
assert(formatSigned(-10.3) === "-10.30", "negative value shows -");
assert(formatSigned(0) === "0.00", "zero shows 0.00");
assert(formatSigned(null) === "0.00", "null treated as 0");
assert(formatSigned(undefined) === "0.00", "undefined treated as 0");
assert(formatSigned("abc") === "0.00", "NaN string treated as 0");

// ── Test Suite: formatCurrency ──
console.log("\n💰 formatCurrency");
const usd = formatCurrency(1234.5);
assert(usd.includes("1,234.50") || usd.includes("1234.50"), `formatCurrency USD: ${usd}`);
assert(formatCurrency(null) === "$0.00" || formatCurrency(null).includes("0.00"), "null → $0.00");

// ── Test Suite: Live market tape helpers ──
console.log("\n📟 Live market tape helpers");
assert(formatQuotePrice(123.4, "USD").includes("123.40"), "USD quotes at 100+ use two decimals");
assert(formatQuotePrice(12.3456, "INR").includes("12.3456"), "INR quotes below 100 use four decimals");
assert(formatQuotePrice(undefined, "USD") === "—", "missing USD quote is unavailable");
assert(inferDisplayCurrency({ symbol: "RELIANCE.NS" }) === "INR", "NSE symbols infer INR");
assert(inferDisplayCurrency({ symbol: "AAPL" }) === "USD", "US symbols infer USD");
assert(inferDisplayCurrency({ assetClass: "crypto", symbol: "BTC" }) === "USD", "crypto infers USD");
assert(inferDisplayCurrency({ symbol: "AAPL", currency: "INR" }) === "INR", "supplied holding currency wins");

const holdingTickerItem = { symbol: "HOLD", dayPnl: 42.5 };
const watchlistTickerItem = { symbol: "WATCH", dayPnl: 10 };
const cryptoTickerItem = { symbol: "BTC", dayPnl: -10 };
const tickerItems = buildTickerItems({
  positions: [holdingTickerItem],
  watchlist: [watchlistTickerItem],
  crypto: [cryptoTickerItem]
});
assert(
  tickerItems.map((item) => item.symbol).join(",") === "HOLD,WATCH,BTC",
  "ticker items order holdings, watchlist, then crypto"
);
assert(tickerItems[0].kind === "holding" && tickerItems[0].dayPnl === 42.5, "holding preserves day P&L");
assert(tickerItems[1].kind === "watchlist" && tickerItems[1].dayPnl === null, "watchlist has no day P&L");
assert(tickerItems[2].kind === "crypto" && tickerItems[2].dayPnl === null, "crypto has no day P&L");
assert(normalizeTickerItem({ symbol: "RELIANCE.NS" }, "holding").currency === "INR", "normalized Indian ticker item retains INR");

const holdingOnlyState = computePositionsState(
  [{ symbol: "HOLD", displayName: "Holding", quantity: 2, assetClass: "stock", currency: "INR" }],
  { HOLD: [{ t: 1, p: 110, prevClose: 100 }] },
  1
);
assert(holdingOnlyState.positions[0].currency === "INR", "position state retains supplied holding currency");
const tapeState = withTickerItems({
  positionsState: holdingOnlyState,
  watchlist: [{ symbol: "WATCH", displayName: "Watch", quantity: 0, assetClass: "watchlist" }],
  crypto: [{ symbol: "bitcoin", displayName: "Bitcoin", quantity: 0, assetClass: "crypto" }]
});
assert(
  tapeState.tickerItems.map((item) => item.kind).join(",") === "holding,watchlist,crypto",
  "one holding, watchlist, and crypto item stay in ticker order"
);
assertApprox(tapeState.aggregate.dayPnl, 20, 0.01, "ticker quote-only items do not change holdings aggregate");

const outageTickerItem = hydrateTickerQuoteItems(
  [{ symbol: "bitcoin", displayName: "Bitcoin", currency: "USD" }],
  [],
  { bitcoin: [{ t: 123_000, p: 65_000, prevClose: 64_000 }] }
)[0];
assert(
  outageTickerItem.lastPrice === 65_000 && outageTickerItem.prevClose === 64_000,
  "ticker item retains its latest history quote during a provider outage"
);
assert(
  outageTickerItem.stale === true && outageTickerItem.updatedAt === 123_000,
  "history-backed ticker quote is marked stale with its snapshot timestamp"
);

// ── Test Suite: mergePriceSnapshots ──
console.log("\n📊 mergePriceSnapshots");

const now = Date.now();
const history1 = {};
const quotes1 = [
  { symbol: "AAPL", lastPrice: 180, prevClose: 178 },
  { symbol: "MSFT", lastPrice: 385, prevClose: 380 }
];
const merged1 = mergePriceSnapshots(history1, quotes1, now);
assert(merged1["AAPL"].length === 1, "AAPL has 1 snapshot after first merge");
assert(merged1["MSFT"].length === 1, "MSFT has 1 snapshot after first merge");
assert(merged1["AAPL"][0].p === 180, "AAPL price is 180");
assert(merged1["AAPL"][0].prevClose === 178, "AAPL prevClose is 178");

// Second merge with new price.
const quotes2 = [{ symbol: "AAPL", lastPrice: 182, prevClose: 178 }];
const merged2 = mergePriceSnapshots(merged1, quotes2, now + 60000);
assert(merged2["AAPL"].length === 2, "AAPL has 2 snapshots after second merge");
assert(merged2["AAPL"][1].p === 182, "latest AAPL price is 182");

// Stale data pruning (> 15 minutes old).
const oldHistory = {
  "OLD": [{ t: now - 20 * 60 * 1000, p: 100 }]
};
const merged3 = mergePriceSnapshots(oldHistory, [], now);
assert(!merged3["OLD"], "stale symbol pruned after 15 minutes");

// ── Test Suite: computePositionsState ──
console.log("\n📈 computePositionsState");

const holdings = [
  { symbol: "AAPL", displayName: "AAPL", quantity: 10, assetClass: "stock", brokerId: "test" },
  { symbol: "MSFT", displayName: "MSFT", quantity: 5, assetClass: "stock", brokerId: "test" }
];

const testHistory = {
  "AAPL": [
    { t: now - 10 * 60 * 1000, p: 178, prevClose: 175 },
    { t: now - 2 * 60 * 1000, p: 180, prevClose: 175 }
  ],
  "MSFT": [
    { t: now - 10 * 60 * 1000, p: 380, prevClose: 378 },
    { t: now - 1 * 60 * 1000, p: 385, prevClose: 378 }
  ]
};

const state = computePositionsState(holdings, testHistory, now);
assert(state.positions.length === 2, "2 positions computed");

const aaplPos = state.positions.find((p) => p.symbol === "AAPL");
assert(aaplPos !== undefined, "AAPL position exists");
assert(aaplPos.lastPrice === 180, "AAPL last price is 180");

// Day P&L: (180 - 175) * 10 = 50
assertApprox(aaplPos.dayPnl, 50, 0.01, "AAPL day P&L is 50");

// Day P&L %: ((180 - 175) / 175) * 100 ≈ 2.857
assertApprox(aaplPos.dayPnlPct, 2.857, 0.01, "AAPL day P&L % ≈ 2.857");

const msftPos = state.positions.find((p) => p.symbol === "MSFT");
assert(msftPos !== undefined, "MSFT position exists");
// Day P&L: (385 - 378) * 5 = 35
assertApprox(msftPos.dayPnl, 35, 0.01, "MSFT day P&L is 35");

// Aggregate day P&L should be sum
assertApprox(state.aggregate.dayPnl, 85, 0.01, "aggregate day P&L is 85");
assert(state.aggregate.dayPnlPct > 0, "aggregate day P&L % is positive");
// 5-min window: AAPL (180-180)*10=0 from 2m sample baseline… earliest in window is 180 at 2m
// MSFT (385-385)*5=0 — samples at 2m and 1m are both inside 5m window; baseline = first in window
assert(typeof state.aggregate.window5mPnl === "number", "aggregate window5mPnl present");
assert(typeof state.aggregate.window5mPnlPct === "number", "aggregate window5mPnlPct present");

// Empty holdings
const emptyState = computePositionsState([], {}, now);
assert(emptyState.positions.length === 0, "empty holdings → 0 positions");
assert(emptyState.aggregate.dayPnl === 0, "empty → 0 day P&L");

// Holdings with no price history
const noHistState = computePositionsState(
  [{ symbol: "UNKNOWN", displayName: "UNKNOWN", quantity: 100, brokerId: "x" }],
  {},
  now
);
assert(noHistState.positions[0].lastPrice === null, "no-history position has null lastPrice");
assert(noHistState.positions[0].window5mPnl === 0, "no-history position has 0 window P&L");

// ── Currency formatting ──
assert(formatSignedCurrency(1000, "INR").includes("1"), "INR signed format includes digits");
assert(formatSignedCurrency(-50, "USD").startsWith("-"), "USD negative has minus");
assert(inferDisplayCurrency([{ currency: "INR" }, { currency: "INR" }]) === "INR", "infer homogeneous INR aggregate");
assert(inferDisplayCurrency([{ currency: "USD" }]) === "USD", "infer homogeneous USD aggregate");
assert(inferDisplayCurrency([{ currency: "INR" }, { currency: "USD" }]) === null, "mixed holdings have no aggregate currency");

// ── Test Suite: isActivated (India-first — no Finnhub key required) ──
console.log("\n🎯 isActivated / ACTIVATION_EVENT");
assert(ACTIVATION_EVENT === "myticker_activated", "activation event name");
const baseAct = {
  holdingsCount: 1,
  tickerEnabled: true,
  hasSuccessfulRefresh: true
};
assert(isActivated(baseAct) === true, "holdings + enabled + refresh → activated");
assert(isActivated({ ...baseAct, hasApiKey: false }) === true, "API key not required for India path");
assert(isActivated({ ...baseAct, holdingsCount: 0 }) === false, "zero holdings → not activated");
assert(isActivated({ ...baseAct, tickerEnabled: false }) === false, "ticker off → not activated");
assert(
  isActivated({ ...baseAct, hasSuccessfulRefresh: false }) === false,
  "no successful refresh → not activated"
);
assert(needsFinnhubKey([{ symbol: "TCS.NS" }]) === false, "NSE symbol does not need Finnhub");
assert(needsFinnhubKey([{ symbol: "AAPL" }]) === true, "US symbol needs Finnhub");
assert(needsFinnhubKey([{ symbol: "TCS.NS" }, { symbol: "AAPL" }]) === true, "mixed portfolio needs Finnhub");

// ── Test Suite: recordActiveDay ──
console.log("\n📅 recordActiveDay");
const fixedNow = new Date(2026, 6, 10, 15, 0, 0).getTime(); // local 2026-07-10
const day1 = recordActiveDay([], fixedNow);
assert(day1.length === 1, "first day recorded");
assert(day1[0] === "2026-07-10", "local YYYY-MM-DD format");
const day1Again = recordActiveDay(day1, fixedNow + 3600_000);
assert(day1Again.length === 1, "same day deduped");
assert(day1Again !== day1, "returns new array on dedupe");
const nextDay = recordActiveDay(day1, fixedNow + 24 * 3600_000);
assert(nextDay.length === 2, "next day appended");
assert(nextDay[1] === "2026-07-11", "next day is 2026-07-11");
const many = Array.from({ length: 400 }, (_, i) => {
  const d = new Date(2025, 0, 1 + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});
const capped = recordActiveDay(many, fixedNow);
assert(capped.length === 400, "cap stays at 400");
assert(capped[capped.length - 1] === "2026-07-10", "newest day is last after cap");
assert(!capped.includes(many[0]), "oldest day dropped when over cap");

// ── Summary ──
console.log(`\n${"═".repeat(40)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
