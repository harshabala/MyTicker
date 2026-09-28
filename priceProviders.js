// Pluggable price providers. India: Yahoo (no key). US: Finnhub (optional key). Crypto: CoinGecko with Binance fallback.
//
// Every request has a timeout, every response is validated, and a provider
// that answers 429 or 5xx is paused with exponential backoff (see
// ProviderBackoff). Providers never throw: a failure yields fewer quotes, and
// the caller marks the missing symbols stale. Logs never include symbols,
// URLs, or keys.

const MAX_CONCURRENT = 6;
const CACHE_TTL_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 12_000;
const FINNHUB_FALLBACK = "https://finnhub.io/api/v1";
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";
const BINANCE_TICKER_URL = "https://data-api.binance.vision/api/v3/ticker/24hr";
const BINANCE_USDT_PAIRS = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  binancecoin: "BNBUSDT",
  ripple: "XRPUSDT",
  solana: "SOLUSDT"
};

export const PROVIDERS = Object.freeze(["yahoo", "finnhub", "coingecko", "binance"]);
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Per-provider cooldown after rate limiting (429) or server errors (5xx).
 * The first failure pauses the provider for 1 minute (or Retry-After, if
 * longer), doubling on each consecutive failure up to 30 minutes. A success
 * resets it. State is plain JSON so the service worker can persist it across
 * restarts (MV3 workers are killed between alarms).
 */
export class ProviderBackoff {
  constructor(state = {}, now = () => Date.now()) {
    this.now = now;
    this.state = {};
    for (const provider of PROVIDERS) {
      const entry = state?.[provider];
      const failures = Number(entry?.failures);
      const until = Number(entry?.until);
      if (Number.isFinite(failures) && failures > 0 && Number.isFinite(until)) {
        this.state[provider] = { failures: Math.min(Math.floor(failures), 16), until };
      }
    }
    this.changed = false;
  }

  isBlocked(provider) {
    const entry = this.state[provider];
    return !!entry && this.now() < entry.until;
  }

  reportFailure(provider, retryAfterMs = 0) {
    const retryAfter = Number.isFinite(retryAfterMs) ? Math.min(BACKOFF_MAX_MS, Math.max(0, retryAfterMs)) : 0;
    // Parallel requests in one batch fail together; count that as one failure.
    if (this.isBlocked(provider)) {
      const entry = this.state[provider];
      entry.until = Math.max(entry.until, this.now() + retryAfter);
      this.changed = true;
      return;
    }
    const failures = Math.min((this.state[provider]?.failures || 0) + 1, 16);
    const exponential = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
    this.state[provider] = { failures, until: this.now() + Math.max(exponential, retryAfter) };
    this.changed = true;
  }

  // A success resets the failure count once the cooldown has passed. A success
  // racing a 429 in the same parallel batch must not cancel the pause.
  reportSuccess(provider) {
    if (this.state[provider] && !this.isBlocked(provider)) {
      delete this.state[provider];
      this.changed = true;
    }
  }

  toJSON() {
    return { ...this.state };
  }
}

/** Retry-After as milliseconds (delta-seconds or HTTP date). */
export function parseRetryAfter(header, now = Date.now()) {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

/**
 * GET JSON with a timeout. Returns parsed JSON or null (network error,
 * timeout, non-2xx, or malformed body). 429/5xx feed the backoff.
 */
async function fetchJson(url, provider, backoff, init = {}) {
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    console.warn(`[MyTicker] ${provider} request failed: ${err?.name || "Error"}`);
    return null;
  }
  if (response.status === 429 || response.status >= 500) {
    backoff?.reportFailure(provider, parseRetryAfter(response.headers?.get?.("retry-after")));
    console.warn(`[MyTicker] ${provider} returned HTTP ${response.status}; backing off`);
    return null;
  }
  if (!response.ok) {
    console.warn(`[MyTicker] ${provider} returned HTTP ${response.status}`);
    return null;
  }
  try {
    const data = await response.json();
    backoff?.reportSuccess(provider);
    return data;
  } catch {
    console.warn(`[MyTicker] ${provider} returned malformed JSON`);
    return null;
  }
}

/** Run fetchOne over items in batches, stopping early if the provider is paused. */
async function fetchInBatches(items, provider, backoff, fetchOne) {
  const results = [];
  for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
    if (backoff?.isBlocked(provider)) break;
    const settled = await Promise.allSettled(items.slice(i, i + MAX_CONCURRENT).map(fetchOne));
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) results.push(result.value);
    }
  }
  return results;
}

/** Map a CoinGecko /simple/price response to quotes. */
export function parseCoinGeckoPrices(ids, data) {
  return ids.flatMap((symbol) => {
    const quote = data?.[symbol];
    const lastPrice = positiveNumber(quote?.usd);
    if (!lastPrice) return [];
    return [{
      symbol,
      lastPrice,
      prevClose: null,
      changePct: Number.isFinite(quote.usd_24h_change) ? quote.usd_24h_change : null,
      updatedAt: Number.isFinite(quote.last_updated_at) ? quote.last_updated_at * 1000 : null,
      currency: "USD",
      marketState: "open",
      source: "coingecko"
    }];
  });
}

export class CoinGeckoPriceProvider {
  constructor({ backoff } = {}) {
    this.backoff = backoff;
  }

  async getQuotes(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length || this.backoff?.isBlocked("coingecko")) return [];

    const params = new URLSearchParams({
      ids: uniqueIds.join(","),
      vs_currencies: "usd",
      include_24hr_change: "true",
      include_last_updated_at: "true"
    });
    const data = await fetchJson(`${COINGECKO_SIMPLE_PRICE_URL}?${params}`, "coingecko", this.backoff);
    return data ? parseCoinGeckoPrices(uniqueIds, data) : [];
  }
}

/** Map a Binance 24hr ticker response to a quote. */
export function parseBinanceTicker(symbol, data) {
  const rawLastPrice = data?.lastPrice;
  if (typeof rawLastPrice === "string" && !rawLastPrice.trim()) return null;
  const lastPrice = Number(rawLastPrice);
  if (rawLastPrice == null || !Number.isFinite(lastPrice) || lastPrice <= 0) return null;
  const changePct = Number(data?.priceChangePercent);
  const closeTime = Number(data?.closeTime);
  return {
    symbol,
    lastPrice,
    prevClose: null,
    changePct: data?.priceChangePercent != null && Number.isFinite(changePct) ? changePct : null,
    updatedAt: Number.isFinite(closeTime) && closeTime > 0 ? closeTime : null,
    currency: "USD",
    marketState: "open",
    source: "binance"
  };
}

export class BinancePriceProvider {
  constructor({ backoff } = {}) {
    this.backoff = backoff;
  }

  async getQuotes(ids) {
    const uniqueIds = [...new Set((ids || []).filter((id) => BINANCE_USDT_PAIRS[id]))];
    return fetchInBatches(uniqueIds, "binance", this.backoff, (id) => this._getQuote(id));
  }

  async _getQuote(symbol) {
    const data = await fetchJson(`${BINANCE_TICKER_URL}?symbol=${BINANCE_USDT_PAIRS[symbol]}`, "binance", this.backoff);
    return data ? parseBinanceTicker(symbol, data) : null;
  }
}

export async function getCryptoQuotes(ids, providers = {}, { backoff } = {}) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  const coinGecko = providers.coinGecko || new CoinGeckoPriceProvider({ backoff });
  const binance = providers.binance || new BinancePriceProvider({ backoff });
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

/**
 * Map a Finnhub /quote response. Finnhub answers unknown symbols with
 * c = 0, and pc = 0 means "no previous close" (not a zero baseline).
 */
export function parseFinnhubQuote(symbol, data) {
  const lastPrice = positiveNumber(data?.c);
  if (!lastPrice) return null;
  const t = Number(data?.t);
  return {
    symbol,
    lastPrice,
    prevClose: positiveNumber(data?.pc),
    updatedAt: Number.isFinite(t) && t > 0 ? t * 1000 : null,
    currency: "USD",
    marketState: null,
    source: "finnhub"
  };
}

export class FinnhubPriceProvider {
  constructor({ backoff } = {}) {
    this._cache = {};
    this.backoff = backoff;
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

    const fetched = await fetchInBatches(toFetch, "finnhub", this.backoff, (symbol) => this._fetchSingle(symbol, baseUrl, apiKey));
    for (const quote of fetched) this._cache[quote.symbol] = { data: quote, timestamp: now };
    return [...results, ...fetched];
  }

  async _fetchSingle(symbol, baseUrl, apiKey) {
    // Finnhub only accepts the key as a query parameter (provider design).
    const url = `${baseUrl}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
    const data = await fetchJson(url, "finnhub", this.backoff);
    return data ? parseFinnhubQuote(symbol, data) : null;
  }
}

/**
 * Map a Yahoo v8 chart response (interval=1d, range=5d) to a quote.
 *
 * Previous close: `meta.chartPreviousClose` is the close before the FIRST bar
 * of the requested range, i.e. about five sessions ago for range=5d, so using
 * it made "day" P&L a five-day change. The previous close is instead the last
 * daily close before the session of `regularMarketTime`. Daily closes are
 * split-adjusted, so a split does not show up as a huge daily move.
 *
 * marketState is "open" only inside the current regular trading period, so
 * pre-market, post-market, weekends, and holidays read as "closed".
 */
export function parseYahooChart(symbol, data, now = Date.now()) {
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta || {};
  const lastPrice = positiveNumber(meta.regularMarketPrice);
  if (!lastPrice) return null;

  const offset = Number.isFinite(meta.gmtoffset) ? meta.gmtoffset : 0;
  const sessionDay = (seconds) => Math.floor((seconds + offset) / 86_400);
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = result.indicators?.quote?.[0]?.close;
  const marketTime = positiveNumber(meta.regularMarketTime);

  let prevClose = null;
  if (marketTime && Array.isArray(closes)) {
    const currentDay = sessionDay(marketTime);
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (Number.isFinite(timestamps[i]) && sessionDay(timestamps[i]) < currentDay && positiveNumber(closes[i])) {
        prevClose = closes[i];
        break;
      }
    }
  }
  if (prevClose == null) prevClose = positiveNumber(meta.previousClose) ?? positiveNumber(meta.regularMarketPreviousClose);
  // chartPreviousClose is a true previous close only when the range holds a single session.
  if (prevClose == null && marketTime && timestamps.length && timestamps.every((t) => sessionDay(t) === sessionDay(marketTime))) {
    prevClose = positiveNumber(meta.chartPreviousClose);
  }

  let marketState = null;
  const regular = meta.currentTradingPeriod?.regular;
  if (Number.isFinite(regular?.start) && Number.isFinite(regular?.end)) {
    const nowSeconds = now / 1000;
    marketState = nowSeconds >= regular.start && nowSeconds < regular.end ? "open" : "closed";
  }

  return {
    symbol,
    lastPrice,
    prevClose,
    updatedAt: marketTime ? marketTime * 1000 : null,
    currency: meta.currency === "INR" || meta.currency === "USD" ? meta.currency : null,
    marketState,
    source: "yahoo"
  };
}

/**
 * Yahoo Finance chart API for NSE/BSE — no API key required.
 * Used so Indian holdings work out of the box after CSV import.
 */
export class YahooIndiaPriceProvider {
  constructor({ backoff } = {}) {
    this._cache = {};
    this.backoff = backoff;
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

    const fetched = await fetchInBatches(toFetch, "yahoo", this.backoff, (symbol) => this._fetchSingle(symbol));
    for (const quote of fetched) this._cache[quote.symbol] = { data: quote, timestamp: now };
    return [...results, ...fetched];
  }

  async _fetchSingle(symbol) {
    const url = `${YAHOO_CHART_URL}${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false`;
    const data = await fetchJson(url, "yahoo", this.backoff, { headers: { Accept: "application/json" } });
    return data ? parseYahooChart(symbol, data) : null;
  }
}

/**
 * Fetch all quotes: India via Yahoo (no key), rest via Finnhub when key present.
 * Pass config.backoff (a ProviderBackoff) to pause rate-limited providers.
 */
export async function getAllQuotes(symbols, config = {}) {
  const unique = [...new Set(symbols.filter(Boolean))];
  const { india, finnhub } = partitionSymbols(unique);
  const yahoo = new YahooIndiaPriceProvider({ backoff: config.backoff });
  const fh = new FinnhubPriceProvider({ backoff: config.backoff });

  const [indiaQuotes, fhQuotes] = await Promise.all([
    india.length ? yahoo.getQuotes(india) : Promise.resolve([]),
    finnhub.length && config.apiKey ? fh.getQuotes(finnhub, config) : Promise.resolve([])
  ]);

  return [...indiaQuotes, ...fhQuotes];
}
