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

