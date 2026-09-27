import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseYahooChart, parseFinnhubQuote, parseCoinGeckoPrices, parseBinanceTicker, parseRetryAfter,
  ProviderBackoff, getAllQuotes, getCryptoQuotes, YahooIndiaPriceProvider, FinnhubPriceProvider,
  sanitizeFinnhubBaseUrl, partitionSymbols, REQUEST_TIMEOUT_MS
} from "../priceProviders.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`../test_fixtures/providers/${name}`, import.meta.url), "utf8"));
const yahooTcs = await fixture("yahoo_chart_tcs_5d.json");
const finnhubAapl = await fixture("finnhub_quote_aapl.json");
const regular = yahooTcs.chart.result[0].meta.currentTradingPeriod.regular;

let requests;
let handler;
beforeEach(() => {
  requests = [];
  handler = () => new Response("{}", { status: 404 });
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return handler(String(url), init);
  };
});
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test("Yahoo: previous close is the prior session's close, not chartPreviousClose (5 sessions ago)", () => {
  const quote = parseYahooChart("TCS.NS", yahooTcs, (regular.start + 3600) * 1000);
  assert.equal(quote.lastPrice, 3556.8);
  assert.equal(quote.prevClose, 3520);
  assert.notEqual(quote.prevClose, yahooTcs.chart.result[0].meta.chartPreviousClose);
  assert.equal(quote.currency, "INR");
  assert.equal(quote.marketState, "open");
  assert.equal(quote.updatedAt, yahooTcs.chart.result[0].meta.regularMarketTime * 1000);
});

test("Yahoo: pre-market, after close, and weekends read as closed", () => {
  assert.equal(parseYahooChart("TCS.NS", yahooTcs, (regular.start - 60) * 1000).marketState, "closed");
  assert.equal(parseYahooChart("TCS.NS", yahooTcs, (regular.end + 60) * 1000).marketState, "closed");
  assert.equal(parseYahooChart("TCS.NS", yahooTcs, (regular.end + 2 * 86400) * 1000).marketState, "closed");
});

test("Yahoo: after the close the last bar is today, so prevClose is still yesterday", () => {
  const data = structuredClone(yahooTcs);
  data.chart.result[0].indicators.quote[0].close[4] = 3556.8;
  assert.equal(parseYahooChart("TCS.NS", data).prevClose, 3520);
});

test("Yahoo: skips null closes (holidays / gaps) when finding the previous session", () => {
  const data = structuredClone(yahooTcs);
  data.chart.result[0].indicators.quote[0].close[3] = null;
  assert.equal(parseYahooChart("TCS.NS", data).prevClose, 3490);
});

test("Yahoo: fallbacks for missing bars and a single-session range", () => {
  const data = structuredClone(yahooTcs);
  const result = data.chart.result[0];
  delete result.indicators;
  assert.equal(parseYahooChart("TCS.NS", data).prevClose, null, "multi-session range never falls back to chartPreviousClose");
  result.meta.previousClose = 3515;
  assert.equal(parseYahooChart("TCS.NS", data).prevClose, 3515);
  delete result.meta.previousClose;
  result.timestamp = [result.timestamp[4]];
  assert.equal(parseYahooChart("TCS.NS", data).prevClose, 3400, "single-session chartPreviousClose is the real previous close");
});

test("Yahoo: malformed or empty payloads yield no quote", () => {
  for (const bad of [null, {}, { chart: { result: [] } }, { chart: { result: [{ meta: { regularMarketPrice: 0 } }] } }, { chart: { result: [{ meta: { regularMarketPrice: "12" } }] } }, { chart: { result: [{ meta: { regularMarketPrice: -1 } }] } }]) {
    assert.equal(parseYahooChart("X.NS", bad), null);
  }
  const data = structuredClone(yahooTcs);
  data.chart.result[0].meta.currency = "GBp";
  assert.equal(parseYahooChart("X.NS", data).currency, null);
});

test("Finnhub: maps a quote; zero price is unknown; zero pc is missing, not a baseline", async () => {
  assert.deepEqual(parseFinnhubQuote("AAPL", finnhubAapl), {
    symbol: "AAPL", lastPrice: 227.52, prevClose: 226.25, updatedAt: finnhubAapl.t * 1000, currency: "USD", marketState: null, source: "finnhub"
  });
  assert.equal(parseFinnhubQuote("NOPE", await fixture("finnhub_quote_unknown.json")), null);
  assert.equal(parseFinnhubQuote("AAPL", { c: 10, pc: 0 }).prevClose, null);
  assert.equal(parseFinnhubQuote("AAPL", { c: "10" }), null);
  assert.equal(parseFinnhubQuote("AAPL", null), null);
});

test("CoinGecko and Binance parsers validate prices", async () => {
  const quotes = parseCoinGeckoPrices(["bitcoin", "ethereum", "solana"], await fixture("coingecko_simple_price.json"));
  assert.deepEqual(quotes.map((q) => [q.symbol, q.lastPrice, q.changePct]), [["bitcoin", 65000, 1.5], ["ethereum", 3000, -0.5]]);
  assert.deepEqual(parseCoinGeckoPrices(["bitcoin"], { bitcoin: { usd: 0 } }), []);
  const eth = parseBinanceTicker("ethereum", await fixture("binance_ticker_eth.json"));
  assert.equal(eth.lastPrice, 3000);
  assert.equal(eth.changePct, -0.5);
  assert.equal(parseBinanceTicker("ethereum", { lastPrice: "3000" }).changePct, null);
});

test("every request carries a timeout signal", async () => {
  handler = async (url) => url.includes("yahoo") ? json(yahooTcs) : url.includes("finnhub") ? json(finnhubAapl) : json(await fixture("coingecko_simple_price.json"));
  await getAllQuotes(["TCS.NS", "AAPL"], { apiKey: "k" });
  await getCryptoQuotes(["bitcoin"]);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((r) => r.init?.signal instanceof AbortSignal));
  assert.ok(REQUEST_TIMEOUT_MS <= 15_000);
});

test("a hung request is aborted after REQUEST_TIMEOUT_MS and yields no quote", async () => {
  const original = AbortSignal.timeout;
  const controller = new AbortController();
  let requestedMs;
  AbortSignal.timeout = (ms) => { requestedMs = ms; return controller.signal; };
  try {
    handler = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))));
    const pending = new YahooIndiaPriceProvider().getQuotes(["TCS.NS"]);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    assert.deepEqual(await pending, []);
    assert.equal(requestedMs, REQUEST_TIMEOUT_MS);
  } finally {
    AbortSignal.timeout = original;
  }
});

test("HTTP errors, malformed JSON, and network failures yield partial results without throwing", async () => {
  handler = (url) => {
    if (url.includes("GOOD.NS")) return json(yahooTcs);
    if (url.includes("BAD.NS")) return new Response("{not json", { status: 200 });
    if (url.includes("GONE.NS")) return new Response("", { status: 404 });
    throw new TypeError("Failed to fetch");
  };
  const quotes = await getAllQuotes(["GOOD.NS", "BAD.NS", "GONE.NS", "DOWN.NS"]);
  assert.deepEqual(quotes.map((q) => q.symbol), ["GOOD.NS"]);
});

test("429 pauses the provider with exponential backoff and honours Retry-After", async () => {
  let now = 1_000_000;
  const backoff = new ProviderBackoff({}, () => now);
  handler = () => json({}, 429, { "retry-after": "120" });
  const symbols = Array.from({ length: 20 }, (_, i) => `S${i}.NS`);
  assert.deepEqual(await getAllQuotes(symbols, { backoff }), []);
  assert.equal(requests.length, 6, "stops after the first batch that hit 429");
  assert.equal(backoff.isBlocked("yahoo"), true);
  assert.equal(backoff.state.yahoo.until, now + 120_000, "Retry-After longer than base backoff wins");

  requests = [];
  await getAllQuotes(symbols, { backoff });
  assert.equal(requests.length, 0, "no requests while paused");

  now += 121_000;
  handler = () => json({}, 503);
  await getAllQuotes(["A.NS"], { backoff });
  assert.equal(backoff.state.yahoo.failures, 2, "a failure after the cooldown escalates");
  assert.equal(backoff.state.yahoo.until - now, 120_000);

  now += 30 * 60_000;
  handler = () => json(yahooTcs);
  assert.equal((await getAllQuotes(["TCS.NS"], { backoff })).length, 1);
  assert.equal(backoff.state.yahoo, undefined, "success resets");
  assert.equal(backoff.isBlocked("finnhub"), false, "other providers unaffected");
});

test("backoff is capped, serialisable, and rejects junk state", () => {
  let now = 0;
  const backoff = new ProviderBackoff({}, () => now);
  for (let i = 0; i < 40; i++) {
    backoff.reportFailure("finnhub");
    now = backoff.state.finnhub.until; // each failure after the cooldown escalates
  }
  now = 0;
  backoff.state.finnhub.until = 0;
  backoff.reportFailure("finnhub");
  assert.equal(backoff.state.finnhub.until, 30 * 60_000);
  const restored = new ProviderBackoff(JSON.parse(JSON.stringify(backoff)), () => now);
  assert.equal(restored.isBlocked("finnhub"), true);
  const junk = new ProviderBackoff({ yahoo: { failures: "x", until: 5 }, evil: { failures: 1, until: 9e15 }, __proto__: { a: 1 } }, () => now);
  assert.deepEqual(junk.toJSON(), {});
});

test("crypto: CoinGecko 429 backs off and Binance covers mapped assets", async () => {
  const backoff = new ProviderBackoff({}, () => 0);
  handler = async (url) => url.includes("coingecko") ? json({}, 429) : json(await fixture("binance_ticker_eth.json"));
  const quotes = await getCryptoQuotes(["ethereum"], {}, { backoff });
  assert.deepEqual(quotes.map((q) => q.source), ["binance"]);
  assert.equal(backoff.isBlocked("coingecko"), true);
  requests = [];
  await getCryptoQuotes(["ethereum"], {}, { backoff });
  assert.ok(!requests.some((r) => r.url.includes("coingecko")));
});

test("parseRetryAfter handles seconds, dates, and junk", () => {
  assert.equal(parseRetryAfter("30"), 30_000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(parseRetryAfter("soon"), 0);
  assert.equal(parseRetryAfter(null), 0);
});

test("Finnhub: key only in the token param, base URL pinned to finnhub.io, skipped without a key", async () => {
  handler = () => json(finnhubAapl);
  await new FinnhubPriceProvider().getQuotes(["AAPL"], { apiKey: "se cret", baseUrl: "https://evil.example/api" });
  assert.equal(requests[0].url, "https://finnhub.io/api/v1/quote?symbol=AAPL&token=se%20cret");
  requests = [];
  assert.deepEqual(await getAllQuotes(["AAPL"], {}), []);
  assert.equal(requests.length, 0);
  assert.equal(sanitizeFinnhubBaseUrl("http://finnhub.io/api/v1"), "https://finnhub.io/api/v1");
  assert.deepEqual(partitionSymbols(["A.NS", "B.BO", "C"]), { india: ["A.NS", "B.BO"], finnhub: ["C"] });
});

test("symbols are URL-encoded", async () => {
  handler = () => json(yahooTcs);
  await getAllQuotes(["M&M.NS"]);
  assert.match(requests[0].url, /chart\/M%26M\.NS\?interval=1d&range=5d/);
});
