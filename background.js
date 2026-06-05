// Background service worker (Manifest V3)
// - Manages holdings, price polling, and P&L calculations.

import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  computePositionsState,
  mergePriceSnapshots
} from "./shared.js";

import { FinnhubPriceProvider } from "./priceProviders.js";

const priceProvider = new FinnhubPriceProvider();

const DEFAULT_TOP5_CRYPTO = [
  "BINANCE:BTCUSDT",
  "BINANCE:ETHUSDT",
  "BINANCE:BNBUSDT",
  "BINANCE:XRPUSDT",
  "BINANCE:SOLUSDT"
];

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

chrome.runtime.onInstalled.addListener(() => {
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
        STORAGE_KEYS.priceHistory,
        "pts_price_api_key"
      ])
    ]);

    const settings = syncData[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    if (!settings.enabled) return;

    const baseHoldings = localData[STORAGE_KEYS.holdings] || [];

    // Enrich holdings with crypto and apply asset filters depending on settings.
    const holdings = buildCombinedHoldings(baseHoldings, settings);
    if (!holdings.length) {
      // No holdings to track; clear state so UI doesn't show stale data.
      chrome.storage.local.set({
        [STORAGE_KEYS.positionsState]: null
      });
      return;
    }

    const priceHistory = localData[STORAGE_KEYS.priceHistory] || {};

    const apiKeyOverride = localData["pts_price_api_key"];
    const apiConfig = {
      ...(settings.priceProviderConfig || {}),
      apiKey: apiKeyOverride || settings.priceProviderConfig?.apiKey
    };
    if (!apiConfig.apiKey) {
      // No API key configured; clear state so UI doesn't show stale data.
      chrome.storage.local.set({
        [STORAGE_KEYS.positionsState]: null
      });
      return;
    }

    const symbols = [...new Set(holdings.map((h) => h.symbol))];
    if (!symbols.length) {
      chrome.storage.local.set({
        [STORAGE_KEYS.positionsState]: null
      });
      return;
    }

    const quotes = await priceProvider.getQuotes(symbols, apiConfig);
    const now = Date.now();

    if (quotes.length > 0) {
      consecutiveFailures = 0;
      lastSuccessfulFetch = now;
    } else {
      consecutiveFailures++;
    }
    await savePollHealth();

    const newHistory = mergePriceSnapshots(priceHistory, quotes, now);
    const positionsState = computePositionsState(holdings, newHistory, now);

    positionsState.updatedAt = now;

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
  const cryptoConfig = settings.cryptoConfig || DEFAULT_SETTINGS.cryptoConfig;

  const enriched = [];

  if (filters.showStocks) {
    for (const h of baseHoldings) {
      enriched.push({
        ...h,
        assetClass: h.assetClass || "stock"
      });
    }
  }

  if (!filters.showCrypto || !cryptoConfig || !cryptoConfig.includeCrypto) {
    return enriched;
  }

  if (cryptoConfig.mode === "manual") {
    const manual = Array.isArray(cryptoConfig.manualHoldings)
      ? cryptoConfig.manualHoldings
      : [];
    for (const c of manual) {
      if (!c.symbol) continue;
      const qty = Number(c.quantity) || 0;
      if (!qty) continue;
      const rawSymbol = String(c.symbol).trim();
      enriched.push({
        brokerId: "crypto-manual",
        assetClass: "crypto",
        symbol: rawSymbol,
        exchange: "CRYPTO",
        quantity: qty,
        avgPrice: 0,
        currency: "USD",
        displayName: cleanCryptoDisplayName(rawSymbol)
      });
    }
  } else if (cryptoConfig.mode === "top5") {
    for (const sym of DEFAULT_TOP5_CRYPTO) {
      enriched.push({
        brokerId: "crypto-top5",
        assetClass: "crypto",
        symbol: sym,
        exchange: "CRYPTO",
        quantity: 1,
        avgPrice: 0,
        currency: "USD",
        displayName: cleanCryptoDisplayName(sym)
      });
    }
  }

  return enriched;
}

// Strip exchange prefix (e.g. "BINANCE:BTCUSDT" → "BTCUSDT")
function cleanCryptoDisplayName(symbol) {
  const parts = symbol.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : symbol;
}
