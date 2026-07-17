// Background service worker (Manifest V3)
// - Manages holdings, price polling, and P&L calculations.

import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  computePositionsState,
  mergePriceSnapshots,
  inferDisplayCurrency,
  isActivated,
  withTickerItems,
  hydrateTickerQuoteItems,
  appendDiagnosticLogEntry
  , normalizeCryptoConfig,
  migrateSettings
} from "./shared.js";

import { getAllQuotes, getCryptoQuotes } from "./priceProviders.js";
import { recordSuccessfulRefresh, markActivated } from "./metrics.js";
import { createVaultRecord, deriveVaultKeyMaterial, decryptVaultRecordWithMaterial } from "./vault.js";

const FINNHUB_VAULT_KEY = "pts_finnhub_vault";
const FINNHUB_SESSION_KEY = "pts_finnhub_vault_aes_material";
const LEGACY_FINNHUB_KEY = "pts_price_api_key";

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
let settingsMigrationInFlight = null;

async function recordDiagnostic(entry) {
  const data = await chrome.storage.local.get([STORAGE_KEYS.diagnosticsLog]);
  await chrome.storage.local.set({
    [STORAGE_KEYS.diagnosticsLog]: appendDiagnosticLogEntry(data[STORAGE_KEYS.diagnosticsLog], entry)
  });
}

const CONTENT_LIFECYCLE_STAGES = new Set([
  "loaded", "storage-settings-read", "mount-success", "render-success", "fatal-error"
]);

function safeOrigin(value) {
  try {
    const origin = new URL(String(value || "")).origin;
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
}

function sanitizeContentError(error) {
  if (!error || typeof error !== "object") return undefined;
  const name = String(error.name || "Error").replace(/[^a-zA-Z0-9_. -]/g, "").slice(0, 80) || "Error";
  const message = String(error.message || "").replace(/https?:\/\/\S+/g, "[url]").replace(/[\r\n]/g, " ").slice(0, 160);
  return message ? { name, message } : { name };
}

async function recordContentLifecycle(message, sender) {
  if (!CONTENT_LIFECYCLE_STAGES.has(message?.payload?.stage) || !isTrustedContentSender(sender, message.payload)) return;
  const timestamp = Date.now();
  const status = {
    origin: safeOrigin(sender.url),
    stage: message.payload.stage,
    timestamp
  };
  const error = sanitizeContentError(message.payload.error);
  if (error) status.error = error;
  await chrome.storage.local.set({ [STORAGE_KEYS.contentScriptStatus]: status });
  await recordDiagnostic({ timestamp, event: "content-script-lifecycle", stage: message.payload.stage });
}

function isTrustedExtensionSender(sender) {
  const id = String(chrome.runtime.id || "");
  return !!id && sender?.id === id && String(sender?.url || "").startsWith(`chrome-extension://${id}/`);
}

function isTrustedContentSender(sender, payload) {
  const senderOrigin = safeOrigin(sender?.url);
  return sender?.id === chrome.runtime.id && !!sender?.tab && sender?.frameId === 0 && /^https?:\/\//.test(senderOrigin) && senderOrigin === safeOrigin(payload?.origin);
}

async function getVaultStatus() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get([FINNHUB_VAULT_KEY, LEGACY_FINNHUB_KEY]),
    chrome.storage.session.get([FINNHUB_SESSION_KEY])
  ]);
  return { configured: !!(local[FINNHUB_VAULT_KEY] || local[LEGACY_FINNHUB_KEY]), unlocked: !!session[FINNHUB_SESSION_KEY] };
}

async function createOrReplaceVault(payload) {
  const code = String(payload?.unlockCode || "");
  const apiKey = String(payload?.apiKey || "").trim();
  if (code.length < 6 || !apiKey) throw new Error("Invalid vault input");
  const record = await createVaultRecord(apiKey, code);
  await chrome.storage.local.set({ [FINNHUB_VAULT_KEY]: record });
  const material = await deriveVaultKeyMaterial(record, code);
  await chrome.storage.session.set({ [FINNHUB_SESSION_KEY]: material });
  await chrome.storage.local.remove(LEGACY_FINNHUB_KEY);
  return getVaultStatus();
}

async function unlockVault(payload) {
  const code = String(payload?.unlockCode || "");
  if (code.length < 6) throw new Error("Invalid unlock code");
  const local = await chrome.storage.local.get([FINNHUB_VAULT_KEY, LEGACY_FINNHUB_KEY]);
  let record = local[FINNHUB_VAULT_KEY];
  if (local[FINNHUB_VAULT_KEY]) {
    // Validate the code before storing derived material; plaintext stays local.
    const material = await deriveVaultKeyMaterial(record, code);
    await decryptVaultRecordWithMaterial(record, material);
    await chrome.storage.session.set({ [FINNHUB_SESSION_KEY]: material });
    return getVaultStatus();
  } else if (local[LEGACY_FINNHUB_KEY]) {
    const apiKey = String(local[LEGACY_FINNHUB_KEY]).trim();
    record = await createVaultRecord(apiKey, code);
    await chrome.storage.local.set({ [FINNHUB_VAULT_KEY]: record });
    await chrome.storage.local.remove(LEGACY_FINNHUB_KEY);
  } else {
    throw new Error("Vault not configured");
  }
  await chrome.storage.session.set({ [FINNHUB_SESSION_KEY]: await deriveVaultKeyMaterial(record, code) });
  return getVaultStatus();
}

async function lockVault() {
  await chrome.storage.session.remove(FINNHUB_SESSION_KEY);
  return getVaultStatus();
}

async function getUnlockedFinnhubKey() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get([FINNHUB_VAULT_KEY]),
    chrome.storage.session.get([FINNHUB_SESSION_KEY])
  ]);
  if (!local[FINNHUB_VAULT_KEY] || !session[FINNHUB_SESSION_KEY]) return "";
  return decryptVaultRecordWithMaterial(local[FINNHUB_VAULT_KEY], session[FINNHUB_SESSION_KEY]);
}

async function testVaultConnection() {
  const apiKey = await getUnlockedFinnhubKey();
  if (!apiKey) throw new Error("Vault locked");
  const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(apiKey)}`);
  if (!response.ok) throw new Error("Finnhub request failed");
  const quote = await response.json();
  if (!Number.isFinite(quote?.c)) throw new Error("Finnhub quote unavailable");
  return { symbol: "AAPL", price: quote.c };
}

async function migrateStoredSettings() {
  if (settingsMigrationInFlight) return settingsMigrationInFlight;
  const migration = (async () => {
    const data = await chrome.storage.sync.get([STORAGE_KEYS.settings, STORAGE_KEYS.settingsSchema]);
    const previous = data[STORAGE_KEYS.settings];
    const migrated = migrateSettings(previous);
    // Chrome Sync has no compare-and-swap for an object value. Never replace
    // pts_settings during worker startup: that could overwrite a newer Options
    // or command write. Persist the migration version independently instead.
    if (data[STORAGE_KEYS.settingsSchema] !== migrated.schemaVersion) {
      await chrome.storage.sync.set({ [STORAGE_KEYS.settingsSchema]: migrated.schemaVersion });
    }
    return migrated;
  })();
  settingsMigrationInFlight = migration;
  try {
    return await migration;
  } finally {
    if (settingsMigrationInFlight === migration) settingsMigrationInFlight = null;
  }
}

function providerQuoteCounts(quotes) {
  const counts = { coinGeckoQuotes: 0, binanceQuotes: 0, yahooQuotes: 0, finnhubQuotes: 0 };
  for (const quote of quotes) {
    if (quote?.source === "coingecko") counts.coinGeckoQuotes++;
    if (quote?.source === "binance") counts.binanceQuotes++;
    if (quote?.source === "yahoo") counts.yahooQuotes++;
    if (quote?.source === "finnhub") counts.finnhubQuotes++;
  }
  return counts;
}

async function ensurePollHealthLoaded() {
  if (!pollHealthLoaded) {
    await loadPollHealth();
    pollHealthLoaded = true;
  }
}

ensurePollHealthLoaded();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || typeof message.type !== "string" || !message.payload || typeof message.payload !== "object") return;
  if (message.type === "content-script-lifecycle") {
    recordContentLifecycle(message, sender).catch((err) => {
      console.warn("[MyTicker] could not record content lifecycle", err);
    });
    return;
  }
  if (message.type === "poll-now" && isTrustedExtensionSender(sender)) {
    handlePricePoll().then(() => sendResponse({ ok: true })).catch((err) => {
      console.error("[MyTicker] poll-now failed", err);
      sendResponse({ ok: false, error: "Unable to refresh prices" });
    });
    return true;
  }
  if (!isTrustedExtensionSender(sender)) return;
  if (message.type === "vault-status") {
    getVaultStatus().then((status) => sendResponse({ ok: true, status }));
    return true;
  }
  if (["vault-create", "vault-replace", "vault-unlock", "vault-lock"].includes(message.type)) {
    const action = message.type === "vault-unlock" ? unlockVault
      : message.type === "vault-lock" ? lockVault : createOrReplaceVault;
    action(message.payload).then((status) => sendResponse({ ok: true, status })).catch(() => sendResponse({ ok: false, error: "Vault operation failed" }));
    return true;
  }
  if (message.type === "vault-test-connection") {
    testVaultConnection().then((result) => sendResponse({ ok: true, result })).catch(() => sendResponse({ ok: false, error: "Unable to test Finnhub connection" }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  migrateStoredSettings().then((settings) => {
    const interval = settings.priceProviderConfig?.refreshMinutes || DEFAULT_SETTINGS.priceProviderConfig.refreshMinutes;
    chrome.alarms.create("price-poll", {
      delayInMinutes: 0.1,
      periodInMinutes: interval
    });
  }).catch((error) => console.warn("[MyTicker] settings migration failed", error));

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
migrateStoredSettings().then((settings) => {
  const interval = settings.priceProviderConfig?.refreshMinutes || DEFAULT_SETTINGS.priceProviderConfig.refreshMinutes;
  chrome.alarms.get("price-poll", (existing) => {
    if (!existing) {
      chrome.alarms.create("price-poll", {
        delayInMinutes: 0.1,
        periodInMinutes: interval
      });
    }
  });
}).catch((error) => console.warn("[MyTicker] settings migration failed", error));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "price-poll") {
    handlePricePoll();
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-myticker") {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
      const settings = migrateSettings(data[STORAGE_KEYS.settings]);
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
        STORAGE_KEYS.priceHistory
      ])
    ]);

    const settings = syncData[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    if (!settings.enabled) return;

    const baseHoldings = localData[STORAGE_KEYS.holdings] || [];
    const watchlist = normalizeWatchlist(localData[STORAGE_KEYS.watchlist]);
    const crypto = buildCryptoTickerItems(settings);
    const diagnosticCounts = {
      timestamp: Date.now(),
      holdingsCount: baseHoldings.length,
      watchlistCount: watchlist.length,
      cryptoCount: crypto.length
    };
    await recordDiagnostic({ ...diagnosticCounts, event: "refresh-start" });

    // Holdings alone contribute to positions and portfolio P&L.
    const holdings = buildCombinedHoldings(baseHoldings, settings);
    if (!holdings.length && !watchlist.length && !crypto.length) {
      // No market items to track; clear state so UI doesn't show stale data.
      chrome.storage.local.set({
        [STORAGE_KEYS.positionsState]: null
      });
      await recordDiagnostic({ ...diagnosticCounts, event: "state-write" });
      return;
    }

    const priceHistory = localData[STORAGE_KEYS.priceHistory] || {};

    // India (.NS/.BO) quotes via Yahoo without a key; Finnhub is optional for US symbols. Crypto uses CoinGecko with mapped Binance fallback.
    const apiKeyOverride = await getUnlockedFinnhubKey();
    const apiConfig = {
      apiKey: apiKeyOverride,
      baseUrl: "https://finnhub.io/api/v1"
    };

    const equityWatchlist = watchlist.filter((item) => item.assetClass !== "crypto");
    const cryptoWatchlist = watchlist.filter((item) => item.assetClass === "crypto");
    const equitySymbols = [...new Set([...holdings, ...equityWatchlist].map((h) => h.symbol))];
    const cryptoSymbols = [...new Set([...crypto, ...cryptoWatchlist].map((item) => item.symbol))];
    await recordDiagnostic({
      ...diagnosticCounts,
      timestamp: Date.now(),
      event: "eligible-symbols",
      equitySymbols: equitySymbols.length,
      totalSymbols: equitySymbols.length + cryptoSymbols.length
    });

    const [equityQuotes, cryptoQuotes] = await Promise.all([
      getAllQuotes(equitySymbols, apiConfig),
      getCryptoQuotes(cryptoSymbols)
    ]);
    const quotes = [...equityQuotes, ...cryptoQuotes];
    const now = Date.now();
    await recordDiagnostic({
      ...diagnosticCounts,
      timestamp: now,
      event: "provider-results",
      equityQuotes: equityQuotes.length,
      cryptoQuotes: cryptoQuotes.length,
      quoteCount: quotes.length,
      ...providerQuoteCounts(quotes)
    });

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
      watchlist: hydrateTickerQuoteItems(watchlist, quotes, newHistory),
      crypto: hydrateTickerQuoteItems(crypto, quotes, newHistory)
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
      await recordDiagnostic({ ...diagnosticCounts, timestamp: now, event: "state-write", quoteCount: quotes.length });
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
      await recordDiagnostic({ ...diagnosticCounts, timestamp: now, event: "state-write", quoteCount: quotes.length });
    }
  } catch (err) {
    console.error("Error in handlePricePoll", err);
    consecutiveFailures++;
    await savePollHealth();
    await recordDiagnostic({ timestamp: Date.now(), event: "refresh-failed", error: true });
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
      assetClass: item.assetClass === "crypto" ? "crypto" : "watchlist",
      currency: item.currency || (symbol.endsWith(".NS") || symbol.endsWith(".BO") ? "INR" : "USD"),
      canonicalKey: item.canonicalKey || `equity:${symbol}`
    }];
  });
}

function buildCryptoTickerItems(settings) {
  const filters = settings.portfolioFilters || DEFAULT_SETTINGS.portfolioFilters;
  const cryptoConfig = normalizeCryptoConfig(settings.cryptoConfig || DEFAULT_SETTINGS.cryptoConfig);
  if (!filters.showCrypto || cryptoConfig.mode === "off") return [];

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

// Strip exchange prefix (e.g. "BINANCE:BTCUSDT" → "BTCUSDT")
function cleanCryptoDisplayName(symbol) {
  const parts = symbol.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : symbol;
}
