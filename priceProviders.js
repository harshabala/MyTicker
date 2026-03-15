// Pluggable price provider(s). MVP: Finnhub-based provider using user-supplied API key.

export class FinnhubPriceProvider {
  /**
   * Fetch quotes for an array of symbols.
   * Expects `config` to contain:
   * - apiKey: string
   * - baseUrl?: string
   *
   * Note: For NSE/BSE and other exchanges, the user should provide the
   * correct Finnhub-compatible symbol strings in their CSV (e.g. TCS.NS).
   */
  async getQuotes(symbols, config) {
    const apiKey = config.apiKey;
    const baseUrl = config.baseUrl || "https://finnhub.io/api/v1";

    const results = [];

    // Finnhub free tier prefers one-symbol-per-request; we keep it simple.
    for (const symbol of symbols) {
      try {
        const url = `${baseUrl}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const data = await resp.json();

        // Data fields per Finnhub docs:
        // c: current price
        // pc: previous close price
        if (typeof data.c !== "number") continue;

        results.push({
          symbol,
          lastPrice: data.c,
          prevClose: typeof data.pc === "number" ? data.pc : null
        });
      } catch (err) {
        console.error("FinnhubPriceProvider.getQuotes error for", symbol, err);
      }
    }

    return results;
  }
}

