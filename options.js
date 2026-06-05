import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./shared.js";
import { BROKER_PRESETS, parseCsv, mapRowsToHoldings, diagnoseCsvImport } from "./csvParser.js";
import {
  getSetupStatus,
  markWizardStep,
  completeSetup,
  formatLastSync
} from "./onboarding.js";

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

const clearHoldingsButton = document.getElementById("clearHoldingsButton");
const toastEl = document.getElementById("toast");

const setupWelcomeEl = document.getElementById("setupWelcome");
const setupStatusEl = document.getElementById("setupStatus");
const statusApiEl = document.getElementById("statusApi");
const statusHoldingsEl = document.getElementById("statusHoldings");
const statusSyncEl = document.getElementById("statusSync");
const statusLiveEl = document.getElementById("statusLive");
const rateLimitWarnEl = document.getElementById("rateLimitWarn");
const wizardHintEl = document.getElementById("wizardHint");
const sectionMarket = document.getElementById("section-market");
const sectionImport = document.getElementById("section-import");

const WIZARD_HINTS = {
  1: "Step 1: Get a free key at finnhub.io, paste below, then Save and Test connection (uses TCS.NS for India).",
  2: "Step 2: Export holdings CSV from Zerodha/Groww/Upstox, drop it below. NSE symbols get .NS automatically.",
  3: "Step 3: Visit any webpage — your ticker shows today's P&L at the top. Use the popup for a summary."
};

init();

function init() {
  setPlatformShortcut(document.getElementById("tipsShortcut"));
  wireWizardSteps();
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

  // Show existing holdings count on load
  chrome.storage.local.get([STORAGE_KEYS.holdings], (localData) => {
    const count = (localData[STORAGE_KEYS.holdings] || []).length;
    if (count > 0) {
      csvStatusEl.textContent = `${count} holdings`;
    }
  });

  // Event listeners
  importCsvButton.addEventListener("click", handleImportCsv);
  clearHoldingsButton.addEventListener("click", handleClearHoldings);
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
  refreshSetupUI();
}

function setPlatformShortcut(el) {
  if (!el) return;
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  el.textContent = isMac ? "⌘+Shift+Y" : "Ctrl+Shift+Y";
}

function wireWizardSteps() {
  document.querySelectorAll(".wizard-step").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = Number(btn.dataset.step) || 1;
      goToWizardStep(step);
    });
  });
}

function goToWizardStep(step) {
  markWizardStep(step);
  document.querySelectorAll(".wizard-step").forEach((btn) => {
    const n = Number(btn.dataset.step);
    btn.classList.toggle("active", n === step);
    btn.classList.toggle("done", n < step);
  });
  if (wizardHintEl) {
    wizardHintEl.textContent = WIZARD_HINTS[step] || WIZARD_HINTS[1];
  }
  const target =
    step === 1 ? sectionMarket : step === 2 ? sectionImport : sectionMarket;
  if (target) {
    target.classList.add("section-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => target.classList.remove("section-highlight"), 2000);
  }
  if (step === 3) {
    completeSetup();
  }
  refreshSetupUI();
}

async function refreshSetupUI() {
  const status = await getSetupStatus();

  if (setupWelcomeEl) {
    const showWelcome = status.firstInstall || !status.complete;
    setupWelcomeEl.hidden = false;
    setupWelcomeEl.classList.toggle("is-visible", showWelcome);
  }

  setPill(statusApiEl, status.hasApiKey, "API key");
  setPill(statusHoldingsEl, status.hasHoldings, `Holdings (${status.holdingsCount})`);
  setPill(statusSyncEl, status.lastFetch > 0, `Sync ${formatLastSync(status.lastFetch)}`);
  setPill(statusLiveEl, status.hasLiveData, "Live data");

  if (rateLimitWarnEl) {
    rateLimitWarnEl.classList.toggle("visible", status.rateLimitRisk);
  }

  if (status.complete && setupStatusEl) {
    chrome.storage.local.get(["pts_setup_shimmered"], (data) => {
      if (!data.pts_setup_shimmered) {
        setupStatusEl.classList.add("setup-complete-shimmer");
        chrome.storage.local.set({ pts_setup_shimmered: true });
        setTimeout(() => {
          setupStatusEl.classList.remove("setup-complete-shimmer");
        }, 1000);
      }
    });
  }

  const step = status.hasApiKey ? (status.hasHoldings ? 3 : 2) : 1;
  document.querySelectorAll(".wizard-step").forEach((btn) => {
    const n = Number(btn.dataset.step);
    btn.classList.toggle("active", n === step);
    btn.classList.toggle("done", (n === 1 && status.hasApiKey) || (n === 2 && status.hasHoldings) || (n === 3 && status.hasLiveData));
  });
  if (wizardHintEl && !status.complete) {
    wizardHintEl.textContent = WIZARD_HINTS[step];
  }

  if (status.complete) {
    await completeSetup();
  }
}

function setPill(el, ok, label) {
  if (!el) return;
  el.className = `status-pill ${ok ? "ok" : "pending"}`;
  el.textContent = `${ok ? "✓" : "○"} ${label}`;
}

function updateCryptoManualVisibility() {
  if (cryptoManualField) {
    const open = cryptoModeEl.value === "manual";
    cryptoManualField.classList.toggle("is-open", open);
    cryptoManualField.setAttribute("aria-hidden", open ? "false" : "true");
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
      const diag = diagnoseCsvImport(rows, preset);
      if (diag) {
        showToast(diag, "error");
        return;
      }

      const holdings = mapRowsToHoldings(rows, preset.columns, presetKey, preset.defaults || {});
      const nsCount = holdings.filter((h) => h.symbol.endsWith(".NS")).length;

      chrome.storage.local.set({ [STORAGE_KEYS.holdings]: holdings }, async () => {
        const msg =
          nsCount > 0
            ? `Imported ${holdings.length} holdings (${nsCount} with .NS for NSE)`
            : `Imported ${holdings.length} holdings (${preset.name})`;
        showToast(msg, "success");
        csvStatusEl.textContent = `${holdings.length} holdings`;
        await markWizardStep(3);
        handleRefreshPreview();
        requestImmediatePoll();
        refreshSetupUI();
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

function handleClearHoldings() {
  chrome.storage.local.remove([STORAGE_KEYS.holdings, STORAGE_KEYS.positionsState, STORAGE_KEYS.priceHistory], () => {
    csvStatusEl.textContent = "";
    showToast("All holdings cleared", "success");
    handleRefreshPreview();
  });
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
        markWizardStep(2);
        requestImmediatePoll();
        refreshSetupUI();
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
      `https://finnhub.io/api/v1/quote?symbol=TCS.NS&token=${encodeURIComponent(apiKey)}`
    );
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (typeof data.c === "number" && data.c > 0) {
      showToast(`✓ Connected — TCS.NS: ₹${data.c.toFixed(2)}`, "success");
      await markWizardStep(2);
      refreshSetupUI();
    } else {
      showToast("API key invalid or no data for TCS.NS", "error");
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
      requestImmediatePoll();
      refreshSetupUI();
    });
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes[STORAGE_KEYS.holdings] ||
      changes[STORAGE_KEYS.positionsState] ||
      changes["pts_price_api_key"])
  ) {
    refreshSetupUI();
  }
});

function requestImmediatePoll() {
  chrome.runtime.sendMessage({ action: "poll-now" }, () => {
    void chrome.runtime.lastError;
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
      symbol: normalizeCryptoSymbol(symbolRaw.trim()),
      quantity: qty
    });
  }
  return result;
}

/** Finnhub crypto quotes use BINANCE:PAIR format (e.g. BINANCE:BTCUSDT). */
function normalizeCryptoSymbol(raw) {
  const s = String(raw).trim();
  if (!s) return s;
  if (s.includes(":")) return s.toUpperCase();
  return `BINANCE:${s.toUpperCase()}`;
}

function handleRefreshPreview() {
  if (holdingsPreviewEl) {
    holdingsPreviewEl.classList.add("preview-updating");
  }

  chrome.storage.local.get([STORAGE_KEYS.holdings], (localData) => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (syncData) => {
      const holdings = localData[STORAGE_KEYS.holdings] || [];
      const settings = syncData[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
      const cryptoConfig = settings.cryptoConfig || DEFAULT_SETTINGS.cryptoConfig;

      if (!holdings.length && !cryptoConfig.includeCrypto) {
        holdingsPreviewEl.innerHTML = `<div class="preview-empty">No holdings loaded — import a CSV above</div>`;
        requestAnimationFrame(() => {
          holdingsPreviewEl.classList.remove("preview-updating");
        });
        return;
      }

      const table = document.createElement("table");
      table.className = "preview-table";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const label of ["Symbol", "Qty", "Broker", "Exchange"]) {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      for (const h of holdings) {
        const tr = document.createElement("tr");
        const tdSym = document.createElement("td");
        tdSym.style.cssText = "color: var(--text-primary); font-weight: 500;";
        tdSym.textContent = h.displayName || h.symbol;
        const tdQty = document.createElement("td");
        tdQty.textContent = h.quantity;
        const tdBroker = document.createElement("td");
        tdBroker.textContent = h.brokerId || "\u2014";
        const tdExchange = document.createElement("td");
        tdExchange.textContent = h.exchange || "\u2014";
        tr.appendChild(tdSym);
        tr.appendChild(tdQty);
        tr.appendChild(tdBroker);
        tr.appendChild(tdExchange);
        tbody.appendChild(tr);
      }

      if (cryptoConfig.includeCrypto) {
        const mode = cryptoConfig.mode || "top5";
        if (mode === "manual") {
          const manual = Array.isArray(cryptoConfig.manualHoldings) ? cryptoConfig.manualHoldings : [];
          for (const c of manual) {
            const tr = document.createElement("tr");
            const tdSym = document.createElement("td");
            tdSym.style.cssText = "color: #fbbf24; font-weight: 500;";
            tdSym.textContent = c.symbol;
            const tdQty = document.createElement("td");
            tdQty.textContent = c.quantity;
            const tdBroker = document.createElement("td");
            tdBroker.textContent = "manual";
            const tdExchange = document.createElement("td");
            tdExchange.textContent = "CRYPTO";
            tr.appendChild(tdSym);
            tr.appendChild(tdQty);
            tr.appendChild(tdBroker);
            tr.appendChild(tdExchange);
            tbody.appendChild(tr);
          }
        } else {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 4;
          td.style.cssText = "text-align: center; color: var(--text-tertiary);";
          td.textContent = "Top 5 watchlist enabled";
          tr.appendChild(td);
          tbody.appendChild(tr);
        }
      }

      table.appendChild(tbody);
      holdingsPreviewEl.innerHTML = "";
      holdingsPreviewEl.appendChild(table);

      requestAnimationFrame(() => {
        holdingsPreviewEl.classList.remove("preview-updating");
      });
    });
  });
}

// Toast notification system
let toastTimeout = null;
function showToast(message, type = "success") {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  void toastEl.offsetWidth;
  toastEl.classList.add("toast-enter", "show");

  requestAnimationFrame(() => {
    toastEl.classList.remove("toast-enter");
  });

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
