import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePositionsState, mergePriceSnapshots, summarizeMarketState, describeFreshness,
  formatSigned, formatSignedCurrency, roundToCents, hydrateTickerQuoteItems
} from "../shared.js";

const NOW = 1_800_000_000_000;
const snap = (p, prevClose, extra = {}) => ({ t: NOW, p, prevClose, ...extra });
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

test("day P&L is (price − previous close) × quantity, per position and in aggregate", () => {
  const state = computePositionsState(
    [{ symbol: "TCS.NS", quantity: 50, currency: "INR" }, { symbol: "INFY.NS", quantity: 75, currency: "INR" }],
    { "TCS.NS": [snap(3600, 3582)], "INFY.NS": [snap(1550, 1548.45)] },
    NOW
  );
  close(state.positions[0].dayPnl, 900, "TCS");
  close(state.positions[0].dayPnlPct, (18 / 3582) * 100, "TCS %");
  close(state.positions[1].dayPnl, 116.25, "INFY");
  close(state.aggregate.dayPnl, 1016.25, "aggregate");
  close(state.aggregate.dayPnlPct, (1016.25 / (3582 * 50 + 1548.45 * 75)) * 100, "aggregate % is value-weighted");
  assert.equal(state.aggregate.currency, "INR");
  assert.equal(state.aggregate.partial, false);
  assert.equal(state.positions[0].stale, false);
});

test("zero or missing previous close is unknown, not a zero baseline", () => {
  for (const prevClose of [0, null, undefined, -5, Number.NaN]) {
    const state = computePositionsState([{ symbol: "AAPL", quantity: 10 }], { AAPL: [snap(200, prevClose)] }, NOW);
    assert.equal(state.positions[0].dayPnl, null, `prevClose ${prevClose}`);
    assert.equal(state.positions[0].dayPnlPct, null);
    assert.equal(state.positions[0].lastPrice, 200);
    assert.equal(state.aggregate.dayPnl, 0, "excluded from the total");
    assert.equal(state.aggregate.partial, true);
  }
});

test("no 15-minute pseudo 'day' baseline when the provider has no previous close", () => {
  const state = computePositionsState(
    [{ symbol: "AAPL", quantity: 1 }],
    { AAPL: [{ t: NOW - 10 * 60_000, p: 100, prevClose: null }, snap(110, null)] },
    NOW
  );
  assert.equal(state.positions[0].dayPnl, null);
});

test("INR and USD are never summed: mixed aggregate is null", () => {
  const state = computePositionsState(
    [{ symbol: "TCS.NS", quantity: 1, currency: "INR" }, { symbol: "AAPL", quantity: 1, currency: "USD" }],
    { "TCS.NS": [snap(110, 100)], AAPL: [snap(210, 200)] },
    NOW
  );
  assert.equal(state.aggregate.currency, null);
  assert.equal(state.aggregate.dayPnl, null);
  assert.equal(state.aggregate.dayPnlPct, null);
  assert.equal(state.aggregate.window5mPnl, null);
  assert.equal(state.aggregate.stockDayPnl, null);
  close(state.positions[0].dayPnl, 10, "per-position values stay in their own currency");
  close(state.positions[1].dayPnl, 10, "per-position USD");
});

test("an unpriced USD holding does not make an INR total 'mixed' but marks it partial", () => {
  const state = computePositionsState(
    [{ symbol: "TCS.NS", quantity: 1 }, { symbol: "AAPL", quantity: 1 }],
    { "TCS.NS": [snap(110, 100)] },
    NOW
  );
  assert.equal(state.aggregate.currency, "INR");
  close(state.aggregate.dayPnl, 10, "INR total");
  assert.equal(state.aggregate.partial, true);
  assert.equal(state.positions[1].stale, true);
  assert.equal(state.positions[1].lastPrice, null);
  assert.equal(state.positions[1].dayPnl, null);
});

test("quote currency overrides a wrong stored holding currency", () => {
  const state = computePositionsState([{ symbol: "AAPL", quantity: 1, currency: "INR" }], { AAPL: [snap(10, 9, { cur: "USD" })] }, NOW);
  assert.equal(state.positions[0].currency, "USD");
  assert.equal(state.aggregate.currency, "USD");
});

test("a holding not refreshed in this poll is stale and keeps its snapshot time", () => {
  const state = computePositionsState([{ symbol: "A.NS", quantity: 1 }], { "A.NS": [{ t: NOW - 60_000, p: 10, prevClose: 9 }] }, NOW);
  assert.equal(state.positions[0].stale, true);
  assert.equal(state.positions[0].priceAt, NOW - 60_000);
});

test("5-minute window uses the first sample inside the window", () => {
  const state = computePositionsState(
    [{ symbol: "A.NS", quantity: 2 }],
    { "A.NS": [{ t: NOW - 10 * 60_000, p: 90, prevClose: 80 }, { t: NOW - 4 * 60_000, p: 100, prevClose: 80 }, snap(105, 80)] },
    NOW
  );
  close(state.positions[0].window5mPnl, 10, "window P&L");
  close(state.positions[0].window5mPnlPct, 5, "window %");
});

test("invalid quantities never produce P&L", () => {
  for (const quantity of [0, -3, Number.NaN, "abc", Infinity]) {
    const state = computePositionsState([{ symbol: "A.NS", quantity }], { "A.NS": [snap(10, 9)] }, NOW);
    assert.equal(state.positions[0].dayPnl, null, String(quantity));
    assert.equal(state.aggregate.dayPnl, 0);
  }
});

test("floating-point rounding never shows -0.00", () => {
  const state = computePositionsState([{ symbol: "A.NS", quantity: 3 }], { "A.NS": [snap(0.1 + 0.2, 0.3)] }, NOW);
  assert.ok(Math.abs(state.positions[0].dayPnl) < 1e-12);
  assert.equal(formatSigned(-0.004), "0.00");
  assert.equal(formatSignedCurrency(-0.004, "INR"), "₹0.00");
  assert.equal(formatSignedCurrency(-0.005, "USD"), "-$0.01");
  assert.equal(formatSignedCurrency(123456.785, "INR"), "+₹1,23,456.79");
  assert.equal(roundToCents(-0.001), 0);
  assert.ok(!Object.is(roundToCents(-0.001), -0));
});

test("mergePriceSnapshots validates quotes and keeps currency and market state", () => {
  const history = mergePriceSnapshots({}, [
    { symbol: "A.NS", lastPrice: 10, prevClose: 0, currency: "INR", marketState: "closed" },
    { symbol: "B.NS", lastPrice: 0 },
    { symbol: "C.NS", lastPrice: Number.NaN },
    { symbol: "", lastPrice: 5 },
    { lastPrice: 5 }
  ], NOW);
  assert.deepEqual(Object.keys(history), ["A.NS"]);
  assert.deepEqual(history["A.NS"][0], { t: NOW, p: 10, prevClose: null, cur: "INR", ms: "closed" });
  assert.deepEqual(mergePriceSnapshots({ X: "corrupt" }, [], NOW), {}, "corrupt history entries are dropped");
});

test("summarizeMarketState", () => {
  assert.equal(summarizeMarketState([{ marketState: "closed" }, { marketState: null }]), "closed");
  assert.equal(summarizeMarketState([{ marketState: "closed" }, { marketState: "open" }]), "open");
  assert.equal(summarizeMarketState([{ marketState: null }]), null);
  assert.equal(summarizeMarketState([]), null);
});

test("describeFreshness: stale flag, age, and closed markets", () => {
  assert.equal(describeFreshness(null, NOW), "stale");
  assert.equal(describeFreshness({ updatedAt: NOW - 60_000 }, NOW), "live");
  assert.equal(describeFreshness({ updatedAt: NOW - 60_000, staleWarning: true }, NOW), "stale");
  assert.equal(describeFreshness({ updatedAt: NOW - 6 * 60_000 }, NOW), "stale", "worker stopped writing");
  assert.equal(describeFreshness({ updatedAt: NOW - 6 * 60_000 }, NOW, 5), "live", "tolerates 3 refresh intervals");
  assert.equal(describeFreshness({ updatedAt: NOW - 16 * 60_000 }, NOW, 5), "stale");
  assert.equal(describeFreshness({ updatedAt: NOW, marketState: "closed" }, NOW), "closed");
  assert.equal(describeFreshness({}, NOW), "stale", "no timestamp is never live");
});

test("content bridge describeFreshness matches shared.js", async () => {
  const vm = await import("node:vm");
  const { readFile } = await import("node:fs/promises");
  const context = vm.createContext({});
  new vm.Script(await readFile(new URL("../contentShared.js", import.meta.url), "utf8")).runInContext(context);
  const bridge = context.__MYTICKER_CONTENT_SHARED__;
  for (const [state, refresh] of [[null, 1], [{ updatedAt: NOW }, 1], [{ updatedAt: NOW - 6 * 60_000 }, 1], [{ updatedAt: NOW - 6 * 60_000 }, 5], [{ updatedAt: NOW, marketState: "closed" }, 1], [{ updatedAt: NOW, staleWarning: true }, 1]]) {
    assert.equal(bridge.describeFreshness(state, NOW, refresh), describeFreshness(state, NOW, refresh));
  }
  assert.equal(bridge.formatSignedCurrency(-0.004, "INR"), formatSignedCurrency(-0.004, "INR"));
});

test("quote-only items keep the last snapshot but are marked stale during an outage", () => {
  const [item] = hydrateTickerQuoteItems([{ symbol: "bitcoin" }], [], { bitcoin: [{ t: 5, p: 100, prevClose: 90 }] });
  assert.equal(item.stale, true);
  close(item.changePct, 11.111111111111111, "derived change");
});
