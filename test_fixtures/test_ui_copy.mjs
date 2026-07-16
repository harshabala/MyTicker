// Static UI-copy regression checks. Run with: node test_fixtures/test_ui_copy.mjs
import { readFile } from "node:fs/promises";

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

const [popupHtml, popupJs, optionsHtml, optionsJs, brandCss] = await Promise.all([
  readFile(new URL("../popup.html", import.meta.url), "utf8"),
  readFile(new URL("../popup.js", import.meta.url), "utf8"),
  readFile(new URL("../options.html", import.meta.url), "utf8"),
  readFile(new URL("../options.js", import.meta.url), "utf8"),
  readFile(new URL("../brand.css", import.meta.url), "utf8")
]);
const visibleCopy = `${popupHtml}\n${popupJs}\n${optionsHtml}\n${optionsJs}`;
const visibleText = visibleCopy.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

console.log("\n📝 UI copy");
assert(popupHtml.includes("<h1>my ticker</h1>"), "uses lowercase product name in the popup");
assert(optionsHtml.includes("<h1>my ticker settings</h1>"), "uses lowercase product name in settings");
assert(visibleText.includes("CoinGecko first for supported canonical crypto"), "explains CoinGecko as the primary crypto source");
assert(visibleText.includes("Binance for mapped liquid assets"), "explains the Binance fallback");
assert(visibleText.includes("No Finnhub key is required for crypto quotes"), "states crypto quotes do not require a Finnhub key");
assert(visibleText.includes("Finnhub key is still required for US equities"), "keeps the US-equity Finnhub requirement distinct");
assert(visibleText.includes("third strip group, after holdings and watchlist"), "explains crypto strip placement");
assert(visibleText.includes("second strip group, after holdings"), "explains watchlist strip order");
assert(!visibleText.includes("Finnhub quotes via BINANCE:SYMBOL"), "removes the obsolete Finnhub-only crypto claim");
assert(!visibleText.includes("US equities and crypto need a free Finnhub key"), "removes the obsolete shared Finnhub requirement");
assert(brandCss.includes("--accent: #10b981"), "uses emerald as the shared accent");
assert(popupHtml.includes("font-variant-numeric: tabular-nums") && optionsHtml.includes("font-variant-numeric: tabular-nums"), "uses tabular numerals across market UI");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
