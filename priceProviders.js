// Pluggable price provider(s). MVP: Finnhub-based provider using user-supplied API key.
// Issue #4: Replaced sequential fetch loop with batched Promise.allSettled + concurrency limit.

const MAX_CONCURRENT = 6;
const CACHE_TTL_MS = 30_000; // 30-second cache per symbol

export class FinnhubPriceProvider {
  constructor() {
    // Simple in-memory cache: { [symbol]: { data, timestamp } }
    this._cache = {};
  }

  /**
   * Fetch quotes for an array of symbols.
   * Uses batched parallel requests with a concurrency limit of MAX_CONCURRENT.
   * Results are cached for CACHE_TTL_MS to avoid redundant API calls.
   */
  async getQuotes(symbols, config) {
    const apiKey = config.apiKey;
    const baseUrl = config.baseUrl || "https://finnhub.io/api/v1";
    const now = Date.now();

    const results = [];
    const toFetch = [];

    // Check cache first.
    for (const symbol of symbols) {
      const cached = this._cache[symbol];
      if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
        results.push(cached.data);
      } else {
        toFetch.push(symbol);
      }
    }

    if (!toFetch.length) return results;

    // Batch fetch with concurrency limit.
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
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[MyTicker] Finnhub returned ${resp.status} for ${symbol}`);
      return null;
    }
    const data = await resp.json();

    // Data fields per Finnhub docs:
    // c: current price
    // pc: previous close price
    if (typeof data.c !== "number" || data.c === 0) return null;

    return {
      symbol,
      lastPrice: data.c,
      prevClose: typeof data.pc === "number" ? data.pc : null
    };
  }
}
