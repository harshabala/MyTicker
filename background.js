// Background service worker (Manifest V3)
// - Manages holdings, price polling, and P&L calculations.

import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  computePositionsState,
  mergePriceSnapshots,
  inferDisplayCurrency,
  isActivated,
  withTickerItems
} from "./shared.js";

import { getAllQuotes, getCryptoQuotes } from "./priceProviders.js";
import { recordSuccessfulRefresh, markActivated } from "./metrics.js";

const DEFAULT_TOP5_CRYPTO = ["bitcoin", "ethereum", "binancecoin", "ripple", "solana"];
const CRYPTO_ID_BY_SYMBOL = {
  bitcoin: "bitcoin",
  btc: "bitcoin",
  btcusdt: "bitcoin",
  ethereum: "ethereum",
  eth: "ethereum",
  ethusdt: "ethereum",
  binancecoin: "binancecoin",
  bnb: "binancecoin",
  bnbusdt: "binancecoin",
  ripple: "ripple",
  xrp: "ripple",
  xrpusdt: "ripple",
  solana: "solana",
  sol: "solana",
  solusdt: "solana"
};

// Issue #8: In-flight lock to prevent concurrent poll execution.
let pollInFlight = false;

// Issue #10: Track consecutive API failures for stale-data warning (persisted).
let consecutiveFailures = 0;
let lastSuccessfulFetch = 0;

const STALE_FAILURE_THRESHOLD = 3;
const STALE_TIME_THRESHOLD_MS = 5 * 60 * 1000;

async function loadPollHealth() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.pollHealth]);
  const health = data[STORAGE_KEYS.pollHealth] || {};
  consecutiveFailures = Number(health.consecutiveFailures) || 0;
  lastSuccessfulFetch = Number(health.lastSuccessfulFetch) || 0;
}

async function savePollHealth() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.pollHealth]: {
      consecutiveFailures,
      lastSuccessfulFetch
    }
  });
}

let pollHealthLoaded = false;

async function ensurePollHealthLoaded() {
  if (!pollHealthLoaded) {
    await loadPollHealth();
    pollHealthLoaded = true;
  }
}

ensurePollHealthLoaded();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "poll-now") {
    handlePricePoll().then(() => sendResponse({ ok: true })).catch((err) => {
      console.error("[MyTicker] poll-now failed", err);
      sendResponse({ ok: false, error: String(err) });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    if (!data[STORAGE_KEYS.settings]) {
      chrome.storage.sync.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
    }
    const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    const interval = settings.priceProviderConfig?.refreshMinutes || DEFAULT_SETTINGS.priceProviderConfig.refreshMinutes;
    chrome.alarms.create("price-poll", {
      delayInMinutes: 0.1,
      periodInMinutes: interval
    });
  });

  if (details.reason === "install") {
    chrome.storage.local.set({
      [STORAGE_KEYS.onboarding]: {
        firstInstall: true,
        wizardStep: 1,
        setupComplete: false
      }
    });
    chrome.runtime.openOptionsPage();
  }
});

// Re-create alarm on service worker startup (MV3 workers restart frequently).
chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
  const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
  const interval = settings.priceProviderConfig?.refreshMinutes || DEFAULT_SETTINGS.priceProviderConfig.refreshMinutes;
  chrome.alarms.get("price-poll", (existing) => {
    if (!existing) {
      chrome.alarms.create("price-poll", {
        delayInMinutes: 0.1,
        periodInMinutes: interval
      });
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "price-poll") {
    handlePricePoll();
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-myticker") {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
      const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
      const next = { ...settings, enabled: !settings.enabled };
      chrome.storage.sync.set({ [STORAGE_KEYS.settings]: next });
    });
  }
});

async function handlePricePoll() {
  // Issue #8: Prevent concurrent polls.
  if (pollInFlight) return;
  pollInFlight = true;

  try {
    await ensurePollHealthLoaded();
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get([STORAGE_KEYS.settings]),
      chrome.storage.local.get([
        STORAGE_KEYS.holdings,
        STORAGE_KEYS.watchlist,
        STORAGE_KEYS.priceHistory,
        "pts_price_api_key"
      ])
    ]);

    const settings = syncData[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    if (!settings.enabled) return;

    const baseHoldings = localData[STORAGE_KEYS.holdings] || [];
    const watchlist = normalizeWatchlist(localData[STORAGE_KEYS.watchlist]);
    const crypto = buildCryptoTickerItems(settings);

    // Holdings alone contribute to positions and portfolio P&L.
    const holdings = buildCombinedHoldings(baseHoldings, settings);
    if (!holdings.length && !watchlist.length && !crypto.length) {
      // No market items to track; clear state so UI doesn't show stale data.
      chrome.storage.local.set({
        [STORAGE_KEYS.positionsState]: null
      });
      return;
    }

    const priceHistory = localData[STORAGE_KEYS.priceHistory] || {};

    // India (.NS/.BO) quotes via Yahoo without a key. Finnhub only for US/crypto when key present.
    const apiKeyOverride = (localData["pts_price_api_key"] || "").trim();
    const apiConfig = {
      apiKey: apiKeyOverride,
      baseUrl: "https://finnhub.io/api/v1"
    };

    const equitySymbols = [...new Set([...holdings, ...watchlist].map((h) => h.symbol))];

    const [equityQuotes, cryptoQuotes] = await Promise.all([
      getAllQuotes(equitySymbols, apiConfig),
      getCryptoQuotes(crypto.map((item) => item.symbol))
    ]);
    const quotes = [...equityQuotes, ...cryptoQuotes];
    const now = Date.now();

    if (quotes.length > 0) {
      consecutiveFailures = 0;
      lastSuccessfulFetch = now;
      await recordSuccessfulRefresh(now);
      if (
        isActivated({
          holdingsCount: baseHoldings.length,
          tickerEnabled: !!settings.enabled,
          hasSuccessfulRefresh: true
        })
      ) {
        await markActivated(now);
      }
    } else {
      consecutiveFailures++;
    }
    await savePollHealth();

    const newHistory = mergePriceSnapshots(priceHistory, quotes, now);
    const holdingsState = computePositionsState(holdings, newHistory, now);
    const positionsState = withTickerItems({
      positionsState: holdingsState,
      watchlist: addQuoteData(watchlist, quotes),
      crypto: addQuoteData(crypto, quotes)
    });

    positionsState.updatedAt = now;
    positionsState.displayCurrency = inferDisplayCurrency(baseHoldings);

    // Issue #10: Stale if no successful fetch in 5+ minutes or repeated empty polls.
    const timeStale =
      lastSuccessfulFetch > 0 && now - lastSuccessfulFetch > STALE_TIME_THRESHOLD_MS;
    const failureStale = consecutiveFailures >= STALE_FAILURE_THRESHOLD;
    if (timeStale || failureStale) {
      positionsState.staleWarning = true;
    }

    // Issue #9: Wrap storage.set in try/catch to handle quota errors.
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.priceHistory]: newHistory,
        [STORAGE_KEYS.positionsState]: positionsState
      });
    } catch (storageErr) {
      console.warn("[MyTicker] Storage quota exceeded, pruning history", storageErr);
      // Aggressive prune: keep only last 5 minutes of history.
      const aggressiveCutoff = now - 5 * 60 * 1000;
      for (const [sym, list] of Object.entries(newHistory)) {
        const pruned = list.filter((s) => s.t >= aggressiveCutoff);
        if (!pruned.length) {
          delete newHistory[sym];
        } else {
          newHistory[sym] = pruned;
        }
      }
      await chrome.storage.local.set({
        [STORAGE_KEYS.priceHistory]: newHistory,
        [STORAGE_KEYS.positionsState]: positionsState
      });
    }
  } catch (err) {
    console.error("Error in handlePricePoll", err);
    consecutiveFailures++;
    await savePollHealth();
  } finally {
    pollInFlight = false;
  }
}

function buildCombinedHoldings(baseHoldings, settings) {
  const filters = settings.portfolioFilters || DEFAULT_SETTINGS.portfolioFilters;

  const enriched = [];

  if (filters.showStocks) {
    for (const h of baseHoldings) {
      enriched.push({
        ...h,
        assetClass: h.assetClass || "stock"
      });
    }
  }

  return enriched;
}

function normalizeWatchlist(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const symbol = String(item?.symbol || "").trim();
    if (!symbol) return [];
    return [{
      symbol,
      displayName: item.displayName || symbol,
      quantity: 0,
      assetClass: "watchlist",
      currency: item.currency || "USD"
    }];
  });
}

function buildCryptoTickerItems(settings) {
  const filters = settings.portfolioFilters || DEFAULT_SETTINGS.portfolioFilters;
  const cryptoConfig = settings.cryptoConfig || DEFAULT_SETTINGS.cryptoConfig;
  if (!filters.showCrypto || !cryptoConfig?.includeCrypto) return [];

  const symbols = cryptoConfig.mode === "manual"
    ? (Array.isArray(cryptoConfig.manualHoldings) ? cryptoConfig.manualHoldings : [])
      .map((item) => item?.symbol)
    : DEFAULT_TOP5_CRYPTO;

  return [...new Set(symbols.map(normalizeCryptoId).filter(Boolean))].map((symbol) => ({
    symbol,
    displayName: cleanCryptoDisplayName(symbol),
    quantity: 0,
    assetClass: "crypto",
    currency: "USD"
  }));
}

function normalizeCryptoId(symbol) {
  const raw = String(symbol || "").trim();
  const pair = raw.split(":").pop().toLowerCase();
  return CRYPTO_ID_BY_SYMBOL[pair] || (DEFAULT_TOP5_CRYPTO.includes(pair) ? pair : null);
}

function addQuoteData(items, quotes) {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  return items.map((item) => {
    const quote = quoteBySymbol.get(item.symbol);
    const changePct = Number.isFinite(quote?.changePct)
      ? quote.changePct
      : Number.isFinite(quote?.lastPrice) && Number.isFinite(quote?.prevClose) && quote.prevClose
        ? ((quote.lastPrice - quote.prevClose) / quote.prevClose) * 100
        : null;
    return {
      ...item,
      lastPrice: quote?.lastPrice ?? null,
      changePct,
      currency: quote?.currency || item.currency,
      source: quote?.source,
      updatedAt: quote?.updatedAt
    };
  });
}

// Strip exchange prefix (e.g. "BINANCE:BTCUSDT" → "BTCUSDT")
function cleanCryptoDisplayName(symbol) {
  const parts = symbol.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : symbol;
}
