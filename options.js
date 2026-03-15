import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./shared.js";
import { BROKER_PRESETS, parseCsv, mapRowsToHoldings } from "./csvParser.js";

const brokerPresetEl = document.getElementById("brokerPreset");
const csvFileEl = document.getElementById("csvFile");
const importCsvButton = document.getElementById("importCsvButton");
const csvStatusEl = document.getElementById("csvStatus");

const finnhubApiKeyEl = document.getElementById("finnhubApiKey");
const refreshMinutesEl = document.getElementById("refreshMinutes");
const providerStatusEl = document.getElementById("providerStatus");

const tickerSpeedEl = document.getElementById("tickerSpeed");
const appearanceStatusEl = document.getElementById("appearanceStatus");

const includeCryptoEl = document.getElementById("includeCrypto");
const cryptoModeEl = document.getElementById("cryptoMode");
const cryptoHoldingsTextEl = document.getElementById("cryptoHoldingsText");
const cryptoStatusEl = document.getElementById("cryptoStatus");

const showStocksEl = document.getElementById("showStocks");
const showCryptoEl = document.getElementById("showCrypto");
const refreshPreviewButton = document.getElementById("refreshPreviewButton");
const holdingsPreviewEl = document.getElementById("holdingsPreview");
const previewStatusEl = document.getElementById("previewStatus");

init();

function init() {
  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    finnhubApiKeyEl.value = settings.priceProviderConfig?.apiKey || "";
    refreshMinutesEl.value = String(
      settings.priceProviderConfig?.refreshMinutes || DEFAULT_SETTINGS.priceProviderConfig.refreshMinutes
    );
    tickerSpeedEl.value = String(
      settings.tickerStyleConfig?.tickerSpeed ||
        DEFAULT_SETTINGS.tickerStyleConfig.tickerSpeed
    );

    const cryptoConfig = settings.cryptoConfig || DEFAULT_SETTINGS.cryptoConfig;
    includeCryptoEl.checked = !!cryptoConfig.includeCrypto;
    cryptoModeEl.value = cryptoConfig.mode || "top5";
    cryptoHoldingsTextEl.value = (cryptoConfig.manualHoldings || [])
      .map((c) => `${c.symbol}, ${c.quantity}`)
      .join("\n");

    const filters = settings.portfolioFilters || DEFAULT_SETTINGS.portfolioFilters;
    showStocksEl.checked = filters.showStocks !== false;
    showCryptoEl.checked = filters.showCrypto !== false;
  });

  importCsvButton.addEventListener("click", handleImportCsv);
  document
    .getElementById("saveProviderButton")
    .addEventListener("click", handleSaveProvider);
  document
    .getElementById("saveAppearanceButton")
    .addEventListener("click", handleSaveAppearance);
  document
    .getElementById("saveCryptoButton")
    .addEventListener("click", handleSaveCrypto);
  refreshPreviewButton.addEventListener("click", handleRefreshPreview);

  // Populate preview on load.
  handleRefreshPreview();
}

function handleImportCsv() {
  const file = csvFileEl.files?.[0];
  if (!file) {
    csvStatusEl.textContent = "Please choose a CSV file.";
    return;
  }

  const presetKey = brokerPresetEl.value || "generic";
  const preset = BROKER_PRESETS[presetKey] || BROKER_PRESETS.generic;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || "");
      const rows = parseCsv(text);
      const holdings = mapRowsToHoldings(rows, preset.columns, presetKey);
      if (!holdings.length) {
        csvStatusEl.textContent = "No holdings could be parsed from this CSV.";
        return;
      }

      chrome.storage.local.set({ [STORAGE_KEYS.holdings]: holdings }, () => {
        csvStatusEl.textContent = `Imported ${holdings.length} holdings (${preset.name}).`;
      });
    } catch (err) {
      console.error("Failed to parse CSV", err);
      csvStatusEl.textContent = "Failed to parse CSV file.";
    }
  };
  reader.onerror = () => {
    csvStatusEl.textContent = "Error reading file.";
  };
  reader.readAsText(file);
}

function handleSaveProvider() {
  const apiKey = finnhubApiKeyEl.value.trim();
  const refreshMinutes = Math.max(1, Number(refreshMinutesEl.value) || DEFAULT_SETTINGS.priceProviderConfig.refreshMinutes);

  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || { ...DEFAULT_SETTINGS };
    settings.priceProvider = "finnhub";
    settings.priceProviderConfig = {
      ...(settings.priceProviderConfig || {}),
      refreshMinutes
    };

    chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings }, () => {
      chrome.storage.local.set({ pts_price_api_key: apiKey }, () => {
        // Update alarm cadence to match user preference.
        chrome.alarms.clear("price-poll", () => {
          chrome.alarms.create("price-poll", { periodInMinutes: refreshMinutes });
        });
        providerStatusEl.textContent = "Saved.";
      });
    });
  });
}

function handleSaveAppearance() {
  const tickerSpeed = Math.max(
    5,
    Number(tickerSpeedEl.value) || DEFAULT_SETTINGS.tickerStyleConfig.tickerSpeed
  );

  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || { ...DEFAULT_SETTINGS };
    settings.tickerStyleConfig = {
      ...(settings.tickerStyleConfig || {}),
      tickerSpeed
    };

    settings.portfolioFilters = {
      ...(settings.portfolioFilters || DEFAULT_SETTINGS.portfolioFilters),
      showStocks: showStocksEl.checked,
      showCrypto: showCryptoEl.checked
    };

    chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings }, () => {
      appearanceStatusEl.textContent = "Saved.";
    });
  });
}

function handleSaveCrypto() {
  const includeCrypto = includeCryptoEl.checked;
  const mode = cryptoModeEl.value || "top5";
  const text = cryptoHoldingsTextEl.value || "";
  const manualHoldings = parseCryptoHoldings(text);

  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || { ...DEFAULT_SETTINGS };
    settings.cryptoConfig = {
      includeCrypto,
      mode,
      manualHoldings
    };

    chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings }, () => {
      cryptoStatusEl.textContent = "Saved.";
    });
  });
}

function parseCryptoHoldings(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const result = [];
  for (const line of lines) {
    const [symbolRaw, qtyRaw] = line.split(",");
    if (!symbolRaw) continue;
    const qty = Number((qtyRaw || "0").trim());
    if (!qty || Number.isNaN(qty)) continue;
    result.push({
      symbol: symbolRaw.trim(),
      quantity: qty
    });
  }
  return result;
}

function handleRefreshPreview() {
  previewStatusEl.textContent = "Loading…";
  holdingsPreviewEl.textContent = "";

  chrome.storage.local.get([STORAGE_KEYS.holdings], (localData) => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (syncData) => {
      const holdings = localData[STORAGE_KEYS.holdings] || [];
      const settings = syncData[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
      const cryptoConfig = settings.cryptoConfig || DEFAULT_SETTINGS.cryptoConfig;

      const lines = [];
      lines.push(`# Stocks (${holdings.length})`);
      for (const h of holdings) {
        lines.push(
          `- ${h.displayName || h.symbol} (symbol=${h.symbol}, qty=${h.quantity}, broker=${h.brokerId})`
        );
      }

      if (cryptoConfig.includeCrypto) {
        const mode = cryptoConfig.mode || "top5";
        lines.push("");
        lines.push(`# Crypto (mode=${mode})`);
        if (mode === "manual") {
          const manual = Array.isArray(cryptoConfig.manualHoldings)
            ? cryptoConfig.manualHoldings
            : [];
          for (const c of manual) {
            lines.push(`- ${c.symbol}, qty=${c.quantity}`);
          }
        } else {
          lines.push("- Top 5 watchlist (see docs for exact symbols)");
        }
      }

      holdingsPreviewEl.textContent = lines.join("\n");
      previewStatusEl.textContent = "Updated.";
    });
  });
}

// Keep the content script animation duration in sync via CSS variable.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[STORAGE_KEYS.settings]) {
    const newSettings = changes[STORAGE_KEYS.settings].newValue;
    const speed = newSettings?.tickerStyleConfig?.tickerSpeed;
    if (speed) {
      document.documentElement.style.setProperty(
        "--pts-ticker-duration",
        `${Number(speed)}s`
      );
    }
  }
});

