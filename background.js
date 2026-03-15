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

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    if (!data[STORAGE_KEYS.settings]) {
      chrome.storage.sync.set({ [STORAGE_KEYS.settings]: DEFAULT_SETTINGS });
    }
  });

  // Set up a default alarm for polling
  chrome.alarms.create("price-poll", { periodInMinutes: 1 });
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
  try {
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

    const newHistory = mergePriceSnapshots(priceHistory, quotes, now);
    const positionsState = computePositionsState(holdings, newHistory, now);

    chrome.storage.local.set({
      [STORAGE_KEYS.priceHistory]: newHistory,
      [STORAGE_KEYS.positionsState]: positionsState
    });
  } catch (err) {
    console.error("Error in handlePricePoll", err);
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
      enriched.push({
        brokerId: "crypto-manual",
        assetClass: "crypto",
        symbol: String(c.symbol).trim(),
        exchange: "CRYPTO",
        quantity: qty,
        avgPrice: 0,
        currency: "USD",
        displayName: String(c.symbol).trim()
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
        displayName: sym
      });
    }
  }

  return enriched;
}


