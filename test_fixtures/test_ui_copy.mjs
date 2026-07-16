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

const [popupHtml, popupJs, optionsHtml, optionsJs, brandCss, manifestSource, priceProvidersSource, backgroundSource, readmeSource, privacySource, storeListingSource] = await Promise.all([
  readFile(new URL("../popup.html", import.meta.url), "utf8"),
  readFile(new URL("../popup.js", import.meta.url), "utf8"),
  readFile(new URL("../options.html", import.meta.url), "utf8"),
  readFile(new URL("../options.js", import.meta.url), "utf8"),
  readFile(new URL("../brand.css", import.meta.url), "utf8"),
  readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../priceProviders.js", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
  readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
  readFile(new URL("../STORE_LISTING.md", import.meta.url), "utf8")
]);
const manifest = JSON.parse(manifestSource);
const visibleCopy = `${popupHtml}\n${popupJs}\n${optionsHtml}\n${optionsJs}`;
const visibleText = visibleCopy.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

console.log("\n📝 UI copy");
assert(popupHtml.includes("<h1>my ticker</h1>"), "uses lowercase product name in the popup");
assert(optionsHtml.includes("<h1>my ticker settings</h1>"), "uses lowercase product name in settings");
assert(manifest.name === "my ticker", "uses lowercase product name in the extension manifest");
assert(manifest.action?.default_title === "my ticker", "uses lowercase product name in the extension action title");
assert(manifest.version === "0.5.0", "ships the unmistakable 0.5.0 diagnostics build");
assert(optionsHtml.includes('data-tab="diagnostics"'), "includes a Diagnostics settings tab");
assert(optionsHtml.includes('id="copyDiagnosticsButton"'), "includes a copy diagnostics button");
assert(optionsHtml.includes('id="refreshDiagnosticsButton"'), "includes a refresh diagnostics button");
assert(/<button[^>]*id="refreshDiagnosticsButton"[^>]*>Refresh<\/button>/.test(optionsHtml), "Diagnostics Refresh control is a visible button labelled Refresh");
assert(optionsJs.includes('refreshDiagnosticsButton?.addEventListener("click", renderDiagnostics)'), "Diagnostics Refresh control renders current diagnostics on click");
assert(visibleText.includes("What changed"), "includes a visible What changed section");
assert(visibleText.includes("CoinGecko and Binance only"), "does not overclaim unimplemented crypto providers");
assert(visibleText.includes("Ticker enabled") && visibleText.includes("Holdings:") && visibleText.includes("Watchlist:"), "diagnostics copy includes required ticker and item counts");
assert(visibleText.includes("Content script:"), "diagnostics copy includes content-script status");
assert(visibleText.includes("CoinGecko:") && visibleText.includes("Binance:") && visibleText.includes("Yahoo Finance:") && visibleText.includes("Finnhub:"), "diagnostics copy names every active provider");
assert(visibleText.includes("Recent refresh lifecycle"), "diagnostics copy includes the bounded change-log lifecycle");
assert(visibleText.includes("CoinGecko first for supported canonical crypto"), "explains CoinGecko as the primary crypto source");
assert(visibleText.includes("Binance for mapped liquid assets"), "explains the Binance fallback");
assert(visibleText.includes("CoinGecko is primary; Binance is a fallback for mapped liquid pairs."), "uses truthful crypto provider copy");
assert(!/Coinbase (?:is |as )?(?:primary|fallback|provider)/i.test(visibleText) && !/DefiLlama (?:is |as )?(?:primary|fallback|provider)/i.test(visibleText), "does not claim unsupported crypto providers");
assert(visibleText.includes("Live US prices require Finnhub"), "makes the US live-price provider requirement explicit");
assert(visibleText.includes("BTC / Bitcoin") && visibleText.includes("SOL / Solana"), "lists the supported canonical crypto catalog");
assert(optionsHtml.includes('<option value="off">Off</option>') && optionsHtml.includes('<option value="top5">Top 5</option>') && optionsHtml.includes('<option value="manual">Manual</option>'), "uses explicit Off, Top 5, and Manual crypto modes");
assert(optionsHtml.includes('id="cryptoSearch"') && optionsHtml.includes('id="cryptoSelectedChips"'), "provides searchable manual crypto selection with removable chips");
assert(popupJs.includes("Unavailable") && popupJs.includes("Stale"), "popup labels unavailable and stale watchlist quotes");
assert(popupJs.includes("watch-asset") && popupJs.includes("formatWatchlistAssetLabel"), "popup renders a human-readable asset label for each watchlist item");
assert(popupHtml.includes("grid-template-columns: minmax(0, 1fr) auto auto auto auto"), "watchlist grid reserves a column for asset metadata without wrapping remove");
assert(optionsJs.includes("cryptoManualField.hidden = !open") && optionsJs.includes("cryptoManualField.inert = !open"), "non-manual crypto controls are hidden and inert");
assert(!priceProvidersSource.includes("US/crypto: Finnhub"), "price provider header describes the implemented crypto providers");
for (const [name, source] of Object.entries({ backgroundSource, readmeSource, privacySource, storeListingSource })) {
  assert(source.includes("CoinGecko") && source.includes("Binance") && !/US\/crypto|for US stocks and crypto|Finnhub\/Binance/i.test(source), `${name} describes CoinGecko/Binance crypto sourcing without Finnhub crypto`);
}
assert(storeListingSource.includes("Bitcoin/BTC, Ethereum/ETH, BNB, XRP, and Solana/SOL") && !storeListingSource.includes("BINANCE:BTCUSDT"), "store listing describes the actual canonical manual crypto catalog");
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
