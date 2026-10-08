import assert from "node:assert/strict";
import test from "node:test";
import {
  CRYPTO_ID_BY_SYMBOL,
  normalizeCryptoId,
  resolveCryptoCatalogEntry,
} from "../shared.js";

const EXTRA_INPUTS = [
  "Bitcoin",
  "ethereum",
  "BTCUSD",
  "bitcoinusd",
  "coinbase:btc",
  "x:eth",
  "BINANCE:BTCUSDT",
  "not-a-coin",
  "doge",
  "sol",
  "SOL",
];

test("ticker-path normalizeCryptoId matches the old table for every alias", () => {
  for (const [alias, oldId] of Object.entries(CRYPTO_ID_BY_SYMBOL)) {
    assert.equal(normalizeCryptoId(alias), oldId, alias);
  }
});

test("old table vs wide resolver vs ticker path on realistic inputs", () => {
  const rows = [];
  const inputs = [...Object.keys(CRYPTO_ID_BY_SYMBOL), ...EXTRA_INPUTS];
  for (const input of inputs) {
    const raw = String(input || "").trim();
    const pair = raw.split(":").pop().toLowerCase();
    const oldId = CRYPTO_ID_BY_SYMBOL[pair] || (
      ["bitcoin", "ethereum", "binancecoin", "ripple", "solana"].includes(pair) ? pair : null
    );
    const ticker = normalizeCryptoId(input);
    const wide = resolveCryptoCatalogEntry(input)?.id ?? null;
    rows.push({ input, oldId, ticker, wide });
    assert.equal(ticker, oldId, `ticker path drifted for ${input}`);
  }
  const widened = rows.filter((r) => r.oldId == null && r.wide != null);
  // Documented: wide resolver may accept names/usd suffixes the ticker path rejects.
  assert.ok(widened.length >= 1, "expected at least one extra wide-resolver match to document");
});
