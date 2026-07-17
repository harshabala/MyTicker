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

/**
 * Parse CSV text into an array of objects, using the first line as header.
 */
export function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (!lines.length) return [];

  // Strip BOM if present
  let headerLine = lines[0];
  if (headerLine.charCodeAt(0) === 0xfeff) {
    headerLine = headerLine.slice(1);
  }

  const headers = splitCsvLine(headerLine);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Split a single CSV line, handling simple quoted fields.
 */
function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map((s) => s.trim());
}

/**
 * Map parsed CSV rows to normalized Holding objects using a preset or custom mapping.
 * mapping: { symbol, exchange, quantity, avgPrice, currency }
 */
export function mapRowsToHoldings(rows, mapping, brokerId, defaults = {}) {
  const holdings = [];

  // Build a flexible lookup: for each mapping key find the best matching
  // header in the row by checking exact match first, then case-insensitive.
  function flexGet(row, key) {
    if (key in row) return row[key];
    // Try case-insensitive match
    const lowerKey = key.toLowerCase();
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === lowerKey) return row[k];
    }
    return undefined;
  }

  for (const row of rows) {
    const symbol = flexGet(row, mapping.symbol) || "";
    if (!symbol) continue;

    const quantityRaw = flexGet(row, mapping.quantity) ?? "0";
    const avgPriceRaw = flexGet(row, mapping.avgPrice) ?? "0";

    const quantity = Number(String(quantityRaw).replace(/,/g, "")) || 0;
    const avgPrice = Number(String(avgPriceRaw).replace(/,/g, "")) || 0;

    if (!quantity) continue;

    // Determine exchange: from CSV column, from defaults, or auto-detect
    let exchange = (flexGet(row, mapping.exchange) || "").trim();
    if (!exchange && defaults.exchange) {
      exchange = defaults.exchange;
    }

    // Append exchange suffix to symbol if missing (e.g. IRFC -> IRFC.NS)
    let fullSymbol = String(symbol).trim();
    if (exchange === "NSE" && !fullSymbol.includes(".")) {
      fullSymbol = fullSymbol + ".NS";
    } else if (exchange === "BSE" && !fullSymbol.includes(".")) {
      fullSymbol = fullSymbol + ".BO";
    }

    const currency = (flexGet(row, mapping.currency) || defaults.currency || "INR").trim();

    holdings.push({
      brokerId,
      symbol: fullSymbol,
      exchange,
      quantity,
      avgPrice,
      currency,
      displayName: String(symbol).trim()
    });
  }

  return holdings;
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
      quantity: ["free", "total", "balance", "available", "quantity"]
    }
  }
};

function flexGetRow(row, candidates) {
  const keys = Array.isArray(candidates) ? candidates : [candidates];
  for (const key of keys) {
    if (key in row) return row[key];
    const lower = String(key).toLowerCase();
    for (const k of Object.keys(row)) {
      if (k.toLowerCase() === lower) return row[k];
    }
  }
  return undefined;
}

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
    const quantity = Number(String(qtyRaw ?? "0").replace(/,/g, ""));
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

