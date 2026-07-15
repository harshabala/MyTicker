// Standalone provider tests. Run with: node test_fixtures/test_price_providers.mjs
import {
  CoinGeckoPriceProvider,
  BinancePriceProvider,
  getCryptoQuotes
} from "../priceProviders.js";

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

let calls = [];
let coinGeckoResponse = { bitcoin: { usd: 65000, usd_24h_change: 1.5, last_updated_at: 100 } };
let binanceResponse = { lastPrice: "3000", priceChangePercent: "-0.5" };
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).includes("coingecko")) {
    if (coinGeckoResponse === "http-failure") return new Response("", { status: 500 });
    if (coinGeckoResponse === "invalid-json") return new Response("{", { status: 200 });
    return new Response(JSON.stringify(coinGeckoResponse), { status: 200 });
  }
  if (String(url).includes("binance")) {
    return new Response(JSON.stringify(binanceResponse), { status: 200 });
  }
  return new Response("", { status: 404 });
};

console.log("\n🪙 Crypto price providers");
const gecko = await new CoinGeckoPriceProvider().getQuotes(["bitcoin"]);
assert(
  gecko[0]?.symbol === "bitcoin" && gecko[0]?.lastPrice === 65000,
  "CoinGecko maps a crypto quote"
);
assert(
  gecko[0]?.updatedAt === 100_000,
  "CoinGecko converts last-updated seconds to milliseconds"
);

const fallback = await getCryptoQuotes(["ethereum"], {
  coinGecko: { getQuotes: async () => [] },
  binance: new BinancePriceProvider()
});
assert(
  fallback[0]?.lastPrice === 3000 && calls.some((url) => url.includes("ETHUSDT")),
  "Binance fetches mapped unresolved asset"
);

coinGeckoResponse = "http-failure";
calls = [];
const httpFallback = await getCryptoQuotes(["ethereum"]);
assert(
  httpFallback[0]?.source === "binance" && calls.some((url) => url.includes("ETHUSDT")),
  "CoinGecko HTTP failure falls back to Binance without throwing"
);

coinGeckoResponse = "invalid-json";
calls = [];
const jsonFallback = await getCryptoQuotes(["ethereum"]);
assert(
  jsonFallback[0]?.source === "binance" && calls.some((url) => url.includes("ETHUSDT")),
  "CoinGecko JSON failure falls back to Binance without throwing"
);

coinGeckoResponse = { bitcoin: { usd: 65000, usd_24h_change: 1.5, last_updated_at: 100 } };
calls = [];
const partialFallback = await getCryptoQuotes(["bitcoin", "ethereum"]);
assert(
  partialFallback.some((quote) => quote.symbol === "bitcoin" && quote.source === "coingecko") &&
    partialFallback.some((quote) => quote.symbol === "ethereum" && quote.source === "binance") &&
    calls.filter((url) => url.includes("binance")).length === 1 &&
    calls.some((url) => url.includes("ETHUSDT")),
  "partial CoinGecko response retains its quote and fetches only unresolved Ethereum from Binance"
);

for (const lastPrice of [null, "", "not-a-price", "0", "-1"]) {
  binanceResponse = { lastPrice, priceChangePercent: "-0.5" };
  const malformedBinance = await new BinancePriceProvider().getQuotes(["ethereum"]);
  assert(malformedBinance.length === 0, `invalid Binance lastPrice ${String(lastPrice)} yields no quote`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
