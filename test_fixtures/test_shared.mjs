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
  formatQuotePrice,
  buildTickerItems,
  withTickerItems,
  hydrateTickerQuoteItems
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

// ── Test Suite: DEFAULT_SETTINGS ──
console.log("\n⚙️  DEFAULT_SETTINGS");
assert(DEFAULT_SETTINGS.enabled === true, "enabled by default");
assert(DEFAULT_SETTINGS.priceProvider === "finnhub", "default provider is finnhub");
assert(DEFAULT_SETTINGS.tickerStyleConfig.tickerSpeed === 40, "default speed is 40s");
assert(DEFAULT_SETTINGS.cryptoConfig.includeCrypto === false, "crypto disabled by default");

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

const holdingOnlyState = computePositionsState(
  [{ symbol: "HOLD", displayName: "Holding", quantity: 2, assetClass: "stock" }],
  { HOLD: [{ t: 1, p: 110, prevClose: 100 }] },
  1
);
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
assert(inferDisplayCurrency([{ currency: "INR" }, { currency: "INR" }]) === "INR", "infer INR majority");
assert(inferDisplayCurrency([{ currency: "USD" }]) === "USD", "infer USD");

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
