// Simple CSV parser and broker presets.

export const BROKER_PRESETS = {
  generic: {
    name: "Generic CSV",
    columns: {
      symbol: "symbol",
      exchange: "exchange",
      quantity: "quantity",
      avgPrice: "avgPrice",
      currency: "currency"
    }
  },
  zerodha: {
    name: "Zerodha (holdings export)",
    columns: {
      symbol: "Instrument",
      exchange: "Exchange",
      quantity: "Qty.",
      avgPrice: "Avg. cost",
      currency: "Currency"
    },
    defaults: {
      exchange: "NSE",
      currency: "INR"
    }
  },
  groww: {
    name: "Groww (holdings export)",
    columns: {
      symbol: "Symbol",
      exchange: "Exchange",
      quantity: "Quantity",
      avgPrice: "Avg price",
      currency: "Currency"
    }
  },
  upstox: {
    name: "Upstox (holdings export)",
    columns: {
      symbol: "Tradingsymbol",
      exchange: "Exchange",
      quantity: "Netqty",
      avgPrice: "Avgprice",
      currency: "Currency"
    }
  }
};

// Hard limits for hostile or accidental inputs. A real holdings export is a
// few KB; the Options page also rejects files over 500 KB before reading.
export const CSV_LIMITS = Object.freeze({
  maxChars: 1_000_000,
  maxRows: 5_000,
  maxColumns: 64,
  maxCellChars: 256,
  maxHoldings: 1_000
});

// Header names that must never become object keys.
const FORBIDDEN_HEADERS = new Set(["__proto__", "constructor", "prototype"]);

export class CsvLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsvLimitError";
  }
}

/**
 * Split CSV text into records of trimmed fields (RFC 4180: quoted fields may
 * contain commas, doubled quotes and newlines). Blank records are dropped.
 */
function splitCsvRecords(text) {
  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    if (record.length >= CSV_LIMITS.maxColumns) throw new CsvLimitError(`CSV has too many columns (max ${CSV_LIMITS.maxColumns}).`);
    record.push(field.trim().slice(0, CSV_LIMITS.maxCellChars));
    field = "";
  };
  const pushRecord = () => {
    pushField();
    if (record.some((value) => value !== "")) {
      if (records.length > CSV_LIMITS.maxRows) throw new CsvLimitError(`CSV has too many rows (max ${CSV_LIMITS.maxRows.toLocaleString("en-US")}). Export holdings only.`);
      records.push(record);
    }
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRecord();
    } else {
      field += ch;
    }
  }
  pushRecord();
  return records;
}

/**
 * Parse CSV text into an array of objects, using the first line as header.
 * Rows are null-prototype objects and prototype-sensitive header names are
 * dropped, so a hostile header can never reach Object.prototype.
 * Throws CsvLimitError when the input exceeds CSV_LIMITS.
 */
export function parseCsv(text) {
  let raw = String(text ?? "");
  if (raw.length > CSV_LIMITS.maxChars) {
    throw new CsvLimitError("CSV is too large (max 1 MB). Export holdings only, not full transaction history.");
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);

  const records = splitCsvRecords(raw);
  if (!records.length) return [];

  const headers = records[0].map((h) => (FORBIDDEN_HEADERS.has(h.toLowerCase()) ? "" : h));
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const row = Object.create(null);
    for (let j = 0; j < headers.length; j++) {
      if (!headers[j] || Object.hasOwn(row, headers[j])) continue;
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a broker number: "1,23,456.78" (Indian grouping), "1,234.5",
 * "₹ 2,650.75", "$10", "(12.5)" (accounting negative). Returns NaN for
 * anything else, including "", "-", "Infinity" and "1e400".
 */
export function parseBrokerNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  let text = String(value ?? "").trim();
  if (!text) return NaN;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/^(?:₹|rs\.?|inr|\$|usd)\s*/i, "").replace(/[\s,\u00a0]/g, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)) return NaN;
  const num = Number(text);
  if (!Number.isFinite(num)) return NaN;
  return negative ? -num : num;
}

// Tickers across NSE/BSE/US: letters, digits, & (M&M), - (BAJAJ-AUTO), . (BRK.B), ^ (indices).
const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9&._^-]{0,39}$/;

function inferCurrencyFromSymbol(symbol) {
  return /\.(NS|BO)$/i.test(symbol) ? "INR" : "USD";
}

function flexGetRow(row, candidates) {
  const keys = Array.isArray(candidates) ? candidates : [candidates];
  for (const key of keys) {
    if (!key) continue;
    if (Object.hasOwn(row, key)) return row[key];
    const lower = String(key).toLowerCase();
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === lower) return row[k];
    }
  }
  return undefined;
}

/**
 * Map parsed CSV rows to normalized Holding objects using a preset or custom mapping.
 * mapping: { symbol, exchange, quantity, avgPrice, currency }
 *
 * Rows are skipped when the symbol is not a plausible ticker or the quantity
 * is not a finite number > 0 (negative, NaN, Infinity). Repeated symbols are
 * merged (quantities summed, average cost weighted). Currency is taken from
 * the CSV only when it is INR or USD; otherwise it follows the price source
 * (.NS/.BO → INR via Yahoo, everything else → USD via Finnhub).
 */
export function mapRowsToHoldings(rows, mapping, brokerId, defaults = {}) {
  const bySymbol = new Map();

  for (const row of rows) {
    const symbolRaw = String(flexGetRow(row, mapping.symbol) ?? "").trim();
    if (!symbolRaw || !SYMBOL_PATTERN.test(symbolRaw)) continue;

    const quantity = parseBrokerNumber(flexGetRow(row, mapping.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const avgPriceParsed = parseBrokerNumber(flexGetRow(row, mapping.avgPrice));
    const avgPrice = Number.isFinite(avgPriceParsed) && avgPriceParsed > 0 ? avgPriceParsed : 0;

    // Determine exchange: from CSV column, then preset default.
    let exchange = String(flexGetRow(row, mapping.exchange) ?? "").trim().toUpperCase();
    if (!exchange && defaults.exchange) exchange = String(defaults.exchange).toUpperCase();

    // Append exchange suffix to symbol if missing (e.g. IRFC -> IRFC.NS)
    let fullSymbol = symbolRaw.toUpperCase();
    if (exchange === "NSE" && !fullSymbol.includes(".")) {
      fullSymbol += ".NS";
    } else if (exchange === "BSE" && !fullSymbol.includes(".")) {
      fullSymbol += ".BO";
    }

    const currencyRaw = String(flexGetRow(row, mapping.currency) ?? defaults.currency ?? "").trim().toUpperCase();
    const inferred = inferCurrencyFromSymbol(fullSymbol);
    // A CSV currency that contradicts the quote source would mislabel prices.
    const currency = currencyRaw === inferred ? currencyRaw : inferred;

    const existing = bySymbol.get(fullSymbol);
    if (existing) {
      const totalQty = existing.quantity + quantity;
      existing.avgPrice = totalQty > 0 ? (existing.avgPrice * existing.quantity + avgPrice * quantity) / totalQty : 0;
      existing.quantity = totalQty;
      continue;
    }
    if (bySymbol.size >= CSV_LIMITS.maxHoldings) {
      throw new CsvLimitError(`CSV has more than ${CSV_LIMITS.maxHoldings.toLocaleString("en-US")} holdings.`);
    }
    bySymbol.set(fullSymbol, {
      brokerId,
      symbol: fullSymbol,
      exchange,
      quantity,
      avgPrice,
      currency,
      displayName: symbolRaw.toUpperCase()
    });
  }

  return [...bySymbol.values()];
}

/**
 * Validate CSV headers against a broker preset. Returns null if OK, else user message.
 */
export function diagnoseCsvImport(rows, preset) {
  if (!rows.length) {
    return "CSV is empty. Export holdings from your broker and try again.";
  }

  const headers = Object.keys(rows[0]);
  const defaults = preset.defaults || {};
  // Columns covered by a preset default are optional (e.g. Zerodha always means NSE/INR).
  // Must match detectPresetFromRows / mapRowsToHoldings behavior.
  const expected = Object.entries(preset.columns)
    .filter(([key]) => !(key in defaults))
    .map(([key, col]) => ({
      key,
      col
    }));
  const missing = expected.filter(({ col }) => {
    const lower = col.toLowerCase();
    return !headers.some((h) => h.toLowerCase() === lower);
  });

  if (missing.length) {
    const names = missing.map((m) => m.col).join(", ");
    const found = headers.slice(0, 8).join(", ");
    return `Missing columns for ${preset.name}: ${names}. Found: ${found}${headers.length > 8 ? "…" : ""}. See test_fixtures/sample_holdings_zerodha.csv for Zerodha format.`;
  }

  const mapped = mapRowsToHoldings(rows, preset.columns, "check", defaults);
  if (!mapped.length) {
    return `No rows with quantity > 0. Check the "${preset.columns.quantity}" column in your CSV.`;
  }

  const normalized = mapped.filter((h) => h.symbol.includes(".NS") || h.symbol.includes(".BO")).length;
  if (defaults.exchange === "NSE" && normalized < mapped.length * 0.5) {
    return `${mapped.length} rows parsed, but few NSE symbols (.NS). Confirm broker preset is Zerodha and CSV is a holdings export.`;
  }

  return null;
}

/**
 * Crypto exchange *export* formats (CSV only). Live quotes still use CoinGecko + Binance
 * from priceProviders — Coinbase / CoinDCX / WazirX are not quote providers.
 */
export const CRYPTO_EXPORT_PRESETS = {
  generic_crypto: {
    name: "Generic crypto CSV",
    columns: {
      symbol: ["symbol", "asset", "coin", "ticker", "currency"],
      quantity: ["quantity", "qty", "amount", "balance", "total", "free"]
    }
  },
  binance: {
    name: "Binance (holdings / wallet export)",
    columns: {
      symbol: ["Asset", "Coin", "Symbol"],
      quantity: ["Total", "Free", "Amount", "Available", "Balance"]
    }
  },
  coinbase: {
    name: "Coinbase (export)",
    columns: {
      symbol: ["currency", "asset", "symbol", "Currency"],
      quantity: ["balance", "quantity", "amount", "total balance", "Quantity Balance"]
    }
  },
  coindcx: {
    name: "CoinDCX (export)",
    columns: {
      symbol: ["currency_short_name", "Currency", "symbol", "coin", "asset"],
      quantity: ["balance", "quantity", "amount", "available_balance", "Quantity"]
    }
  },
  wazirx: {
    name: "WazirX (export)",
    columns: {
      symbol: ["asset", "Asset", "symbol", "coin", "Currency"],
      // Prefer total balance when both free and total exist (locked funds included).
      quantity: ["total", "Total", "balance", "available", "free", "quantity"]
    }
  }
};

function headerScoreForCryptoPreset(headers, preset) {
  const lowerHeaders = headers.map((h) => h.toLowerCase());
  let score = 0;
  for (const candidates of Object.values(preset.columns)) {
    const list = Array.isArray(candidates) ? candidates : [candidates];
    if (list.some((c) => lowerHeaders.includes(String(c).toLowerCase()))) score += 1;
  }
  return score;
}

/** Detect which crypto export preset best matches CSV headers. */
export function detectCryptoExportPreset(rows) {
  if (!rows?.length) return null;
  const headers = Object.keys(rows[0]);
  let best = null;
  let bestScore = 0;
  for (const [id, preset] of Object.entries(CRYPTO_EXPORT_PRESETS)) {
    if (id === "generic_crypto") continue;
    const score = headerScoreForCryptoPreset(headers, preset);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  // Need both symbol-like and quantity-like columns.
  if (bestScore >= 2) return best;
  if (headerScoreForCryptoPreset(headers, CRYPTO_EXPORT_PRESETS.generic_crypto) >= 2) {
    return "generic_crypto";
  }
  return null;
}

/**
 * Map CSV rows to raw crypto holding drafts: { symbol, quantity, source }.
 * Does not filter to the catalog — callers resolve/normalize via shared.js.
 */
export function mapRowsToCryptoHoldings(rows, presetId = "generic_crypto") {
  const preset = CRYPTO_EXPORT_PRESETS[presetId] || CRYPTO_EXPORT_PRESETS.generic_crypto;
  const out = [];
  for (const row of rows) {
    const symbolRaw = flexGetRow(row, preset.columns.symbol);
    const qtyRaw = flexGetRow(row, preset.columns.quantity);
    if (symbolRaw == null || String(symbolRaw).trim() === "") continue;
    const quantity = parseBrokerNumber(qtyRaw);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    // Skip pure fiat rows when obvious
    const sym = String(symbolRaw).trim();
    if (/^(INR|USD|USDT|USDC|BUSD|EUR|GBP|DAI)$/i.test(sym)) continue;
    out.push({
      symbol: sym,
      quantity,
      source: presetId
    });
  }
  return out;
}

/** Validate crypto CSV; return null if OK, else user-facing message. */
export function diagnoseCryptoCsvImport(rows, presetId) {
  if (!rows?.length) {
    return "CSV is empty. Export a wallet/holdings CSV from Binance, Coinbase, CoinDCX, or WazirX.";
  }
  const id = presetId || detectCryptoExportPreset(rows) || "generic_crypto";
  const preset = CRYPTO_EXPORT_PRESETS[id] || CRYPTO_EXPORT_PRESETS.generic_crypto;
  const headers = Object.keys(rows[0]);
  const score = headerScoreForCryptoPreset(headers, preset);
  if (score < 2) {
    return `Could not find symbol and quantity columns for ${preset.name}. Found: ${headers.slice(0, 8).join(", ")}${headers.length > 8 ? "…" : ""}.`;
  }
  const mapped = mapRowsToCryptoHoldings(rows, id);
  if (!mapped.length) {
    return `No rows with quantity > 0 for ${preset.name}. Check the balance/quantity column.`;
  }
  return null;
}

