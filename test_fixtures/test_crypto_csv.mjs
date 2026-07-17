/**
 * Crypto wallet CSV import — export presets only; quotes stay CoinGecko/Binance.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseCsv,
  detectCryptoExportPreset,
  mapRowsToCryptoHoldings,
  diagnoseCryptoCsvImport,
  CRYPTO_EXPORT_PRESETS
} from "../csvParser.js";
import { normalizeManualCryptoHoldings, resolveCryptoCatalogEntry } from "../shared.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed += 1;
  console.log("  ✅", msg);
}

console.log("\n🪙 crypto CSV import");

const binanceText = readFileSync(join(__dirname, "sample_crypto_binance.csv"), "utf8");
const binanceRows = parseCsv(binanceText);
ok(detectCryptoExportPreset(binanceRows) === "binance", "detects Binance export headers");
ok(diagnoseCryptoCsvImport(binanceRows, "binance") === null, "Binance CSV validates");
const binanceDraft = mapRowsToCryptoHoldings(binanceRows, "binance");
ok(binanceDraft.some((r) => /btc/i.test(r.symbol)), "maps BTC row");
ok(!binanceDraft.some((r) => /usdt/i.test(r.symbol)), "skips USDT fiat/stable row");
const binanceNorm = normalizeManualCryptoHoldings(binanceDraft);
ok(binanceNorm.some((h) => h.symbol === "bitcoin"), "resolves BTC to bitcoin");
ok(binanceNorm.some((h) => h.symbol === "solana"), "resolves SOL to solana");
ok(!binanceNorm.some((h) => h.symbol === "dogecoin" || String(h.symbol).includes("doge")), "drops non-catalog DOGE");
ok(binanceNorm.find((h) => h.symbol === "bitcoin")?.quantity === 0.5, "keeps BTC quantity");

const coinbaseText = readFileSync(join(__dirname, "sample_crypto_coinbase.csv"), "utf8");
const coinbaseRows = parseCsv(coinbaseText);
ok(detectCryptoExportPreset(coinbaseRows) === "coinbase", "detects Coinbase export headers");
const coinbaseNorm = normalizeManualCryptoHoldings(mapRowsToCryptoHoldings(coinbaseRows, "coinbase"));
ok(coinbaseNorm.some((h) => h.symbol === "ripple"), "maps XRP from Coinbase export");
ok(!coinbaseNorm.some((h) => h.symbol === "usd-coin" || h.symbol === "usdc"), "skips USDC stable");

// Merge sums quantities
const merged = normalizeManualCryptoHoldings([
  { symbol: "BTC", quantity: 1 },
  { symbol: "bitcoin", quantity: 0.5 },
  { symbol: "BTCUSDT", quantity: 0.25 }
]);
ok(merged.length === 1 && Math.abs(merged[0].quantity - 1.75) < 1e-9, "sums quantities for same coin across aliases");

ok(resolveCryptoCatalogEntry("BTC-USD")?.id === "bitcoin", "strips -USD quote suffix");
ok(resolveCryptoCatalogEntry("ETHUSDT")?.id === "ethereum", "strips USDT pair suffix");

ok(Object.keys(CRYPTO_EXPORT_PRESETS).includes("coindcx"), "declares CoinDCX export preset");
ok(Object.keys(CRYPTO_EXPORT_PRESETS).includes("wazirx"), "declares WazirX export preset");

const emptyDiag = diagnoseCryptoCsvImport([], "binance");
ok(typeof emptyDiag === "string" && emptyDiag.length > 0, "empty CSV returns diagnosis");

console.log(`\nResults: ${passed} passed\n`);
