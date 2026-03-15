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
      symbol: "Trading Symbol",
      exchange: "Exchange",
      quantity: "Quantity",
      avgPrice: "Average price",
      currency: "Currency"
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

  const headers = splitCsvLine(lines[0]);
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
export function mapRowsToHoldings(rows, mapping, brokerId) {
  const holdings = [];

  for (const row of rows) {
    const symbol = row[mapping.symbol] || "";
    if (!symbol) continue;

    const quantityRaw = row[mapping.quantity] ?? "0";
    const avgPriceRaw = row[mapping.avgPrice] ?? "0";

    const quantity = Number(String(quantityRaw).replace(/,/g, "")) || 0;
    const avgPrice = Number(String(avgPriceRaw).replace(/,/g, "")) || 0;

    if (!quantity) continue;

    holdings.push({
      brokerId,
      symbol: String(symbol).trim(),
      exchange: (row[mapping.exchange] || "").trim(),
      quantity,
      avgPrice,
      currency: (row[mapping.currency] || "INR").trim(),
      displayName: String(symbol).trim()
    });
  }

  return holdings;
}

