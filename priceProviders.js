// Pluggable price providers. India: Yahoo (no key). US/crypto: Finnhub (optional key).

const MAX_CONCURRENT = 6;
const CACHE_TTL_MS = 30_000;
const FINNHUB_FALLBACK = "https://finnhub.io/api/v1";
const COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const BINANCE_TICKER_URL = "https://data-api.binance.vision/api/v3/ticker/24hr";
const BINANCE_USDT_PAIRS = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  binancecoin: "BNBUSDT",
  ripple: "XRPUSDT",
  solana: "SOLUSDT"
};

export class CoinGeckoPriceProvider {
  async getQuotes(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length) return [];

    const params = new URLSearchParams({
      ids: uniqueIds.join(","),
      vs_currencies: "usd",
      include_24hr_change: "true",
      include_last_updated_at: "true"
    });

    try {
      const response = await fetch(`${COINGECKO_SIMPLE_PRICE_URL}?${params}`);
      if (!response.ok) return [];
      const data = await response.json();
      return uniqueIds.flatMap((symbol) => {
        const quote = data?.[symbol];
        if (!Number.isFinite(quote?.usd)) return [];
        return [{
          symbol,
          lastPrice: quote.usd,
          prevClose: null,
          changePct: Number.isFinite(quote.usd_24h_change) ? quote.usd_24h_change : null,
          currency: "USD",
          source: "coingecko"
        }];
      });
    } catch {
      return [];
    }
  }
}

export class BinancePriceProvider {
  async getQuotes(ids) {
    const uniqueIds = [...new Set((ids || []).filter((id) => BINANCE_USDT_PAIRS[id]))];
    const results = await Promise.all(uniqueIds.map((id) => this._getQuote(id)));
    return results.filter(Boolean);
  }

  async _getQuote(symbol) {
    const pair = BINANCE_USDT_PAIRS[symbol];
    try {
      const response = await fetch(`${BINANCE_TICKER_URL}?symbol=${pair}`);
      if (!response.ok) return null;
      const data = await response.json();
      const lastPrice = Number(data?.lastPrice);
      if (!Number.isFinite(lastPrice)) return null;
      const changePct = Number(data?.priceChangePercent);
      return {
        symbol,
        lastPrice,
        prevClose: null,
        changePct: Number.isFinite(changePct) ? changePct : null,
        currency: "USD",
        source: "binance"
      };
    } catch {
      return null;
    }
  }
}

export async function getCryptoQuotes(ids, providers = {}) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  const coinGecko = providers.coinGecko || new CoinGeckoPriceProvider();
  const binance = providers.binance || new BinancePriceProvider();
  let coinGeckoQuotes = [];

  try {
    coinGeckoQuotes = await coinGecko.getQuotes(uniqueIds);
  } catch {
    coinGeckoQuotes = [];
  }

  const resolved = new Set(coinGeckoQuotes.map((quote) => quote.symbol));
  const unresolved = uniqueIds.filter((id) => !resolved.has(id) && BINANCE_USDT_PAIRS[id]);
  if (!unresolved.length) return coinGeckoQuotes;

  try {
    return [...coinGeckoQuotes, ...(await binance.getQuotes(unresolved))];
  } catch {
    return coinGeckoQuotes;
  }
}

export function isIndiaSymbol(symbol) {
  const s = String(symbol || "");
  return s.endsWith(".NS") || s.endsWith(".BO");
}

/** Only Finnhub HTTPS API bases are allowed. */
export function sanitizeFinnhubBaseUrl(baseUrl) {
  const fallback = FINNHUB_FALLBACK;
  if (!baseUrl || typeof baseUrl !== "string") return fallback;
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return fallback;
    if (u.hostname !== "finnhub.io" && u.hostname !== "www.finnhub.io") return fallback;
    if (!u.pathname.startsWith("/api")) return fallback;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "") || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Partition symbols: India (.NS/.BO) can quote without Finnhub;
 * everything else needs a Finnhub key.
 */
export function partitionSymbols(symbols) {
  const india = [];
  const finnhub = [];
  for (const s of symbols) {
    if (isIndiaSymbol(s)) india.push(s);
    else finnhub.push(s);
  }
  return { india, finnhub };
}

export class FinnhubPriceProvider {
  constructor() {
    this._cache = {};
  }

  async getQuotes(symbols, config) {
    const apiKey = config.apiKey;
    if (!apiKey || !symbols.length) return [];

    const baseUrl = sanitizeFinnhubBaseUrl(config.baseUrl);
    const now = Date.now();
    const results = [];
    const toFetch = [];

    for (const symbol of symbols) {
      const cached = this._cache[symbol];
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        results.push(cached.data);
      } else {
        toFetch.push(symbol);
      }
    }

    if (!toFetch.length) return results;

    for (let i = 0; i < toFetch.length; i += MAX_CONCURRENT) {
      const batch = toFetch.slice(i, i + MAX_CONCURRENT);
      const settled = await Promise.allSettled(
        batch.map((symbol) => this._fetchSingle(symbol, baseUrl, apiKey))
      );

      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) {
          results.push(result.value);
          this._cache[result.value.symbol] = {
            data: result.value,
            timestamp: now
          };
        }
      }
    }

    return results;
  }

  async _fetchSingle(symbol, baseUrl, apiKey) {
    const url = `${baseUrl}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let resp;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } catch (err) {
      console.warn(`[MyTicker] Finnhub fetch failed for ${symbol}`, err?.name || err);
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      console.warn(`[MyTicker] Finnhub returned ${resp.status} for ${symbol}`);
      return null;
    }
    const data = await resp.json();
    if (typeof data.c !== "number" || data.c === 0) return null;

    return {
      symbol,
      lastPrice: data.c,
      prevClose: typeof data.pc === "number" ? data.pc : null
    };
  }
}

/**
 * Yahoo Finance chart API for NSE/BSE — no API key required.
 * Used so Indian holdings work out of the box after CSV import.
 */
export class YahooIndiaPriceProvider {
  constructor() {
    this._cache = {};
  }

  async getQuotes(symbols) {
    const now = Date.now();
    const results = [];
    const toFetch = [];

    for (const symbol of symbols) {
      if (!isIndiaSymbol(symbol)) continue;
      const cached = this._cache[symbol];
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        results.push(cached.data);
      } else {
        toFetch.push(symbol);
      }
    }

    if (!toFetch.length) return results;

    for (let i = 0; i < toFetch.length; i += MAX_CONCURRENT) {
      const batch = toFetch.slice(i, i + MAX_CONCURRENT);
      const settled = await Promise.allSettled(batch.map((s) => this._fetchSingle(s)));
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value) {
          results.push(result.value);
          this._cache[result.value.symbol] = {
            data: result.value,
            timestamp: now
          };
        }
      }
    }

    return results;
  }

  async _fetchSingle(symbol) {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=1d&range=5d&includePrePost=false`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let resp;
    try {
      resp = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
    } catch (err) {
      console.warn(`[MyTicker] Yahoo fetch failed for ${symbol}`, err?.name || err);
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      console.warn(`[MyTicker] Yahoo returned ${resp.status} for ${symbol}`);
      return null;
    }
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta || {};
    const lastPrice =
      typeof meta.regularMarketPrice === "number"
        ? meta.regularMarketPrice
        : typeof meta.previousClose === "number"
          ? meta.previousClose
          : null;
    if (lastPrice == null || lastPrice === 0) return null;

    const prevClose =
      typeof meta.chartPreviousClose === "number"
        ? meta.chartPreviousClose
        : typeof meta.previousClose === "number"
          ? meta.previousClose
          : null;

    return {
      symbol,
      lastPrice,
      prevClose
    };
  }
}

/**
 * Fetch all quotes: India via Yahoo (no key), rest via Finnhub when key present.
 */
export async function getAllQuotes(symbols, config = {}) {
  const unique = [...new Set(symbols.filter(Boolean))];
  const { india, finnhub } = partitionSymbols(unique);
  const yahoo = new YahooIndiaPriceProvider();
  const fh = new FinnhubPriceProvider();

  const [indiaQuotes, fhQuotes] = await Promise.all([
    india.length ? yahoo.getQuotes(india) : Promise.resolve([]),
    finnhub.length && config.apiKey ? fh.getQuotes(finnhub, config) : Promise.resolve([])
  ]);

  return [...indiaQuotes, ...fhQuotes];
}
