import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./shared.js";
import { BROKER_PRESETS, parseCsv, mapRowsToHoldings } from "./csvParser.js";

const brokerPresetEl = document.getElementById("brokerPreset");
const csvFileEl = document.getElementById("csvFile");
const importCsvButton = document.getElementById("importCsvButton");
const csvStatusEl = document.getElementById("csvStatus");
const dropZone = document.getElementById("dropZone");

const finnhubApiKeyEl = document.getElementById("finnhubApiKey");
const refreshMinutesEl = document.getElementById("refreshMinutes");
const providerStatusEl = document.getElementById("providerStatus");
const testConnectionButton = document.getElementById("testConnectionButton");

const tickerSpeedEl = document.getElementById("tickerSpeed");
const appearanceStatusEl = document.getElementById("appearanceStatus");

const includeCryptoEl = document.getElementById("includeCrypto");
const cryptoModeEl = document.getElementById("cryptoMode");
const cryptoHoldingsTextEl = document.getElementById("cryptoHoldingsText");
const cryptoStatusEl = document.getElementById("cryptoStatus");
const cryptoManualField = document.getElementById("cryptoManualField");

const showStocksEl = document.getElementById("showStocks");
const showCryptoEl = document.getElementById("showCrypto");
const refreshPreviewButton = document.getElementById("refreshPreviewButton");
const holdingsPreviewEl = document.getElementById("holdingsPreview");

const toastEl = document.getElementById("toast");

init();

function init() {
  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;

    // Load API key from local storage (canonical source).
    chrome.storage.local.get(["pts_price_api_key"], (localData) => {
      finnhubApiKeyEl.value = localData["pts_price_api_key"] || "";
    });

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

    updateCryptoManualVisibility();
  });

  // Event listeners
  importCsvButton.addEventListener("click", handleImportCsv);
  document.getElementById("saveProviderButton").addEventListener("click", handleSaveProvider);
  document.getElementById("saveAppearanceButton").addEventListener("click", handleSaveAppearance);
  document.getElementById("saveCryptoButton").addEventListener("click", handleSaveCrypto);
  refreshPreviewButton.addEventListener("click", handleRefreshPreview);
  testConnectionButton.addEventListener("click", handleTestConnection);

  // Crypto mode toggle
  cryptoModeEl.addEventListener("change", updateCryptoManualVisibility);

  // Drag-and-drop
  dropZone.addEventListener("click", () => csvFileEl.click());
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      // Create a DataTransfer to set the file input
      const dt = new DataTransfer();
      dt.items.add(file);
      csvFileEl.files = dt.files;
      handleImportCsv();
    }
  });
  csvFileEl.addEventListener("change", () => {
    if (csvFileEl.files?.length) {
      handleImportCsv();
    }
  });

  // Populate preview on load.
  handleRefreshPreview();
}

function updateCryptoManualVisibility() {
  if (cryptoManualField) {
    cryptoManualField.style.display = cryptoModeEl.value === "manual" ? "block" : "none";
  }
}

function handleImportCsv() {
  const file = csvFileEl.files?.[0];
  if (!file) {
    showToast("Please choose a CSV file.", "error");
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
        showToast("No holdings found in CSV.", "error");
        return;
      }

      chrome.storage.local.set({ [STORAGE_KEYS.holdings]: holdings }, () => {
        showToast(`Imported ${holdings.length} holdings (${preset.name})`, "success");
        csvStatusEl.textContent = `${holdings.length} holdings`;
        handleRefreshPreview();
      });
    } catch (err) {
      console.error("Failed to parse CSV", err);
      showToast("Failed to parse CSV file.", "error");
    }
  };
  reader.onerror = () => {
    showToast("Error reading file.", "error");
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
        chrome.alarms.clear("price-poll", () => {
          chrome.alarms.create("price-poll", {
            delayInMinutes: 0.1,
            periodInMinutes: refreshMinutes
          });
        });
        showToast("Provider settings saved", "success");
      });
    });
  });
}

async function handleTestConnection() {
  const apiKey = finnhubApiKeyEl.value.trim();
  if (!apiKey) {
    showToast("Enter an API key first", "error");
    return;
  }

  testConnectionButton.textContent = "Testing…";
  testConnectionButton.disabled = true;

  try {
    const resp = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(apiKey)}`
    );
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (typeof data.c === "number" && data.c > 0) {
      showToast(`✓ Connected — AAPL: $${data.c}`, "success");
    } else {
      showToast("API key invalid or no data returned", "error");
    }
  } catch (err) {
    showToast(`Connection failed: ${err.message}`, "error");
  } finally {
    testConnectionButton.textContent = "Test connection";
    testConnectionButton.disabled = false;
  }
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
      showToast("Appearance saved", "success");
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
      showToast("Crypto settings saved", "success");
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
  chrome.storage.local.get([STORAGE_KEYS.holdings], (localData) => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (syncData) => {
      const holdings = localData[STORAGE_KEYS.holdings] || [];
      const settings = syncData[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
      const cryptoConfig = settings.cryptoConfig || DEFAULT_SETTINGS.cryptoConfig;

      if (!holdings.length && !cryptoConfig.includeCrypto) {
        holdingsPreviewEl.innerHTML = `<div class="preview-empty">No holdings loaded — import a CSV above</div>`;
        return;
      }

      let html = `<table class="preview-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Qty</th>
            <th>Broker</th>
            <th>Exchange</th>
          </tr>
        </thead>
        <tbody>`;

      for (const h of holdings) {
        html += `<tr>
          <td style="color: var(--text-primary); font-weight: 500;">${h.displayName || h.symbol}</td>
          <td>${h.quantity}</td>
          <td>${h.brokerId || "—"}</td>
          <td>${h.exchange || "—"}</td>
        </tr>`;
      }

      if (cryptoConfig.includeCrypto) {
        const mode = cryptoConfig.mode || "top5";
        if (mode === "manual") {
          const manual = Array.isArray(cryptoConfig.manualHoldings) ? cryptoConfig.manualHoldings : [];
          for (const c of manual) {
            html += `<tr>
              <td style="color: #fbbf24; font-weight: 500;">${c.symbol}</td>
              <td>${c.quantity}</td>
              <td>manual</td>
              <td>CRYPTO</td>
            </tr>`;
          }
        } else {
          html += `<tr>
            <td colspan="4" style="text-align: center; color: var(--text-tertiary);">Top 5 watchlist enabled</td>
          </tr>`;
        }
      }

      html += `</tbody></table>`;
      holdingsPreviewEl.innerHTML = html;
    });
  });
}

// Toast notification system
let toastTimeout = null;
function showToast(message, type = "success") {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  // Force reflow for re-animation
  void toastEl.offsetWidth;
  toastEl.classList.add("show");

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3000);
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
