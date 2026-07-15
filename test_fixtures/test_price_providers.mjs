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
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).includes("coingecko")) {
    return new Response(
      JSON.stringify({ bitcoin: { usd: 65000, usd_24h_change: 1.5, last_updated_at: 100 } }),
      { status: 200 }
    );
  }
  if (String(url).includes("binance")) {
    return new Response(
      JSON.stringify({ lastPrice: "3000", priceChangePercent: "-0.5" }),
      { status: 200 }
    );
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

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
