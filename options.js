import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./shared.js";
import { BROKER_PRESETS, parseCsv, mapRowsToHoldings, diagnoseCsvImport } from "./csvParser.js";
import {
  getSetupStatus,
  markWizardStep,
  completeSetup,
  formatLastSync
} from "./onboarding.js";
import { getMetrics, recordImportResult } from "./metrics.js";

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

const EYE_OPEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const WIZARD_HINTS = {
  1: "Next: Connect price data. Free price data key at finnhub.io, then paste and Save.",
  2: "Next: Import your holdings. Drop a Zerodha CSV (or open More formats for Groww/Upstox).",
  3: "Next: Open any tab to go live. The ticker strip and today's P&L appear automatically."
};

const WIZARD_NEXT_LABELS = {
  1: "Next: Connect price data",
  2: "Next: Import your holdings",
  3: "Next: Open any tab to go live"
};

init();

function init() {
  setPlatformShortcut(document.getElementById("tipsShortcut"));
  wireWizardSteps();
  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;

    // Load API key from local storage (canonical source).
    chrome.storage.local.get(["pts_price_api_key"], (localData) => {
      const savedKey = localData["pts_price_api_key"] || "";
      finnhubApiKeyEl.value = savedKey;
      if (savedKey) {
        testConnectionButton.disabled = false;
        testConnectionButton.title = "";
      }
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
  document.getElementById("testIndiaButton").addEventListener("click", handleTestIndia);
  document.getElementById("saveAppearanceButton").addEventListener("click", handleSaveAppearance);
  document.getElementById("saveCryptoButton").addEventListener("click", handleSaveCrypto);
  refreshPreviewButton.addEventListener("click", handleRefreshPreview);
  testConnectionButton.addEventListener("click", handleTestConnection);

  // Eye-toggle for API key visibility
  document.getElementById("toggleApiKeyVisibility").addEventListener("click", () => {
    const isPassword = finnhubApiKeyEl.type === "password";
    finnhubApiKeyEl.type = isPassword ? "text" : "password";
    const btn = document.getElementById("toggleApiKeyVisibility");
    btn.setAttribute("aria-label", isPassword ? "Hide API key" : "Show API key");
    btn.innerHTML = isPassword ? EYE_CLOSED_SVG : EYE_OPEN_SVG;
  });

  // Disable test connection whenever the key field is edited (force re-save)
  const apiKeyLenHint = document.getElementById("apiKeyLenHint");
  finnhubApiKeyEl.addEventListener("input", () => {
    testConnectionButton.disabled = true;
    testConnectionButton.title = "Save your API key first";
    const len = finnhubApiKeyEl.value.trim().length;
    if (apiKeyLenHint) {
      if (len === 0) {
        apiKeyLenHint.textContent = "";
      } else if (len <= 24) {
        apiKeyLenHint.textContent = `${len} chars ✓`;
        apiKeyLenHint.style.color = "var(--green)";
      } else {
        apiKeyLenHint.textContent = `${len} chars — looks doubled, re-copy from dashboard`;
        apiKeyLenHint.style.color = "var(--red)";
      }
    }
  });

  // Crypto mode toggle
  cryptoModeEl.addEventListener("change", updateCryptoManualVisibility);

  // Drag-and-drop
  dropZone.addEventListener("click", () => csvFileEl.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      csvFileEl.click();
    }
  });
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
  renderImportStats();
}

function setPlatformShortcut(el) {
  if (!el) return;
  const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  el.textContent = platform.includes("mac") ? "⌘+Shift+Y" : "Ctrl+Shift+Y";
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
    btn.setAttribute("aria-current", n === step ? "step" : "false");
  });
  if (wizardHintEl) {
    wizardHintEl.textContent = WIZARD_HINTS[step] || WIZARD_HINTS[1];
  }
  const target = step === 1 ? sectionMarket : step === 2 ? sectionImport : null;
  if (target) {
    target.classList.add("section-highlight");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => target.classList.remove("section-highlight"), 2000);
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

  // Shimmer when fully activated (api + holdings + live + ticker enabled)
  if ((status.activated || status.complete) && setupStatusEl) {
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
    const done =
      (n === 1 && status.hasApiKey) ||
      (n === 2 && status.hasHoldings) ||
      (n === 3 && status.hasLiveData);
    btn.classList.toggle("active", n === step && !status.complete);
    btn.classList.toggle("done", done);
    btn.classList.toggle("is-next", n === step && !done);
    btn.setAttribute("aria-current", n === step && !status.complete ? "step" : "false");
  });
  if (wizardHintEl) {
    if (status.activated || status.complete) {
      wizardHintEl.textContent =
        "Setup complete. Strip and today's P&L are live. Holdings and keys stay in this browser.";
    } else {
      wizardHintEl.textContent = WIZARD_HINTS[step] || WIZARD_NEXT_LABELS[step] || "";
    }
  }

  if (status.complete) {
    const data = await chrome.storage.local.get([STORAGE_KEYS.onboarding]);
    const onboarding = data[STORAGE_KEYS.onboarding] || {};
    if (!onboarding.setupComplete) {
      await completeSetup();
    }
  }
}

async function renderImportStats() {
  const el = document.getElementById("importStats");
  if (!el) return;
  try {
    const metrics = await getMetrics();
    const imports = metrics.imports || {};
    const entries = Object.entries(imports);
    let success = 0;
    let fail = 0;
    const parts = [];
    for (const [key, bucket] of entries) {
      const s = Number(bucket?.success) || 0;
      const f = Number(bucket?.fail) || 0;
      success += s;
      fail += f;
      if (s + f > 0) {
        const name = BROKER_PRESETS[key]?.name || key;
        parts.push(`${name} ${s}/${s + f}`);
      }
    }
    if (success + fail === 0) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    const byPreset = parts.length ? ` (${parts.join(", ")}).` : ".";
    el.innerHTML = "";
    const line = document.createElement("div");
    line.className = "import-stats-line";
    line.textContent = `Imports on this device: ${success} succeeded · ${fail} failed${byPreset}`;
    const note = document.createElement("div");
    note.className = "import-stats-note";
    note.textContent =
      "Counted locally whenever a CSV parses to at least one holding. Stored only in this browser. Never uploaded.";
    el.appendChild(line);
    el.appendChild(note);
  } catch (_) {
    el.hidden = true;
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

function detectPresetFromRows(rows) {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase());
  for (const [key, preset] of Object.entries(BROKER_PRESETS)) {
    if (key === "generic") continue;
    const required = Object.entries(preset.columns).filter(([k]) => !(preset.defaults && k in preset.defaults));
    if (required.every(([, col]) => headers.includes(col.toLowerCase()))) return key;
  }
  return null;
}

function handleImportCsv() {
  const file = csvFileEl.files?.[0];
  if (!file) {
    showToast("Please choose a CSV file.", "error");
    return;
  }
  if (file.size > 500_000) {
    showToast("CSV is too large (max 500 KB). Export only your holdings, not full transaction history.", "error");
    return;
  }

  importCsvButton.disabled = true;
  importCsvButton.textContent = "Importing…";

  const reader = new FileReader();
  reader.onload = () => {
    let presetKey = brokerPresetEl.value || "zerodha";
    try {
      const text = String(reader.result || "");
      if (!text.trim()) {
        showToast("That file looks empty.", "error");
        recordImportResult(presetKey, false).then(renderImportStats);
        return;
      }
      const rows = parseCsv(text);

      // Auto-detect preset from headers; fall back to whatever is selected
      const detected = detectPresetFromRows(rows);
      if (detected && detected !== presetKey) {
        presetKey = detected;
        brokerPresetEl.value = detected;
        showToast(`Auto-detected broker: ${BROKER_PRESETS[detected].name}`, "success");
      }
      const preset = BROKER_PRESETS[presetKey] || BROKER_PRESETS.generic;

      const diag = diagnoseCsvImport(rows, preset);
      if (diag) {
        showToast(diag, "error");
        recordImportResult(presetKey, false).then(renderImportStats);
        return;
      }

      const holdings = mapRowsToHoldings(rows, preset.columns, presetKey, preset.defaults || {});
      if (!holdings.length) {
        showToast("No holdings found in that CSV.", "error");
        recordImportResult(presetKey, false).then(renderImportStats);
        return;
      }
      const nsCount = holdings.filter((h) => h.symbol.endsWith(".NS")).length;

      chrome.storage.local.set({ [STORAGE_KEYS.holdings]: holdings }, async () => {
        const msg =
          nsCount > 0
            ? `Imported ${holdings.length} holdings (${nsCount} with .NS for NSE)`
            : `Imported ${holdings.length} holdings (${preset.name})`;
        showToast(msg, "success");
        csvStatusEl.textContent = `${holdings.length} holdings`;
        await recordImportResult(presetKey, true);
        await renderImportStats();
        await markWizardStep(3);
        handleRefreshPreview();
        requestImmediatePoll();
        refreshSetupUI();
      });
    } catch (err) {
      console.error("Failed to parse CSV", err);
      showToast("Failed to parse CSV file.", "error");
      recordImportResult(presetKey, false).then(renderImportStats);
    } finally {
      importCsvButton.disabled = false;
      importCsvButton.textContent = "Import holdings";
    }
  };
  reader.onerror = () => {
    showToast("Error reading file.", "error");
    const presetKey = brokerPresetEl.value || "zerodha";
    recordImportResult(presetKey, false).then(renderImportStats);
    importCsvButton.disabled = false;
    importCsvButton.textContent = "Import holdings";
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
  const refreshMinutes = Math.min(60, Math.max(1, Number(refreshMinutesEl.value) || DEFAULT_SETTINGS.priceProviderConfig.refreshMinutes));

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
        testConnectionButton.disabled = false;
        testConnectionButton.title = "";
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
  if (providerStatusEl) {
    providerStatusEl.className = "status-badge";
    providerStatusEl.innerHTML = `<span class="skeleton-inline-loader"></span>`;
  }

  try {
    // Step 1: verify key is valid with a US stock (always on free tier)
    const usResp = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=AAPL&token=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (usResp.status === 401 || usResp.status === 403) {
      const body = await usResp.json().catch(() => ({}));
      const hint = body.error || `HTTP ${usResp.status}`;
      showToast(`Key rejected by Finnhub: ${hint}. Regenerate at finnhub.io/dashboard.`, "error");
      return;
    }
    if (!usResp.ok) throw new Error(`HTTP ${usResp.status}`);
    const usData = await usResp.json();
    if (typeof usData.c !== "number") {
      showToast("Key accepted but returned unexpected data. Try again.", "error");
      return;
    }

    // Step 2: try an Indian stock — may require a paid Finnhub plan
    const inResp = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=TCS.NS&token=${encodeURIComponent(apiKey)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (inResp.status === 403) {
      showToast(
        `✓ Key valid (AAPL: $${usData.c.toFixed(2)}) but Indian stocks (NSE/BSE) need a Finnhub paid plan. Free tier is US-only.`,
        "error"
      );
      return;
    }
    if (inResp.ok) {
      const inData = await inResp.json();
      if (typeof inData.c === "number" && inData.c > 0) {
        showToast(`✓ Connected: TCS.NS: ₹${inData.c.toFixed(2)} · AAPL: $${usData.c.toFixed(2)}`, "success");
        await markWizardStep(2);
        refreshSetupUI();
        return;
      }
    }

    // Key works, Indian stock returned empty — still usable
    showToast(`✓ Key valid (AAPL: $${usData.c.toFixed(2)}). NSE quotes will be fetched on next refresh.`, "success");
    await markWizardStep(2);
    refreshSetupUI();
  } catch (err) {
    showToast(`Connection failed: ${err.message}`, "error");
  } finally {
    testConnectionButton.textContent = "Test connection";
    testConnectionButton.disabled = false;
    if (providerStatusEl && providerStatusEl.querySelector(".skeleton-inline-loader")) {
      providerStatusEl.innerHTML = "";
    }
  }
}

async function handleTestIndia() {
  const btn = document.getElementById("testIndiaButton");
  const statusEl = document.getElementById("indiaStatus");
  btn.textContent = "Testing…";
  btn.disabled = true;
  if (statusEl) {
    statusEl.className = "status-badge";
    statusEl.innerHTML = `<span class="skeleton-inline-loader"></span>`;
  }

  try {
    const resp = await fetch(
      "https://query1.finance.yahoo.com/v8/finance/chart/TCS.NS?interval=1d&range=1d&includePrePost=false",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (typeof price === "number" && price > 0) {
      showToast(`✓ India connected: TCS.NS: ₹${price.toFixed(2)}`, "success");
      if (statusEl) {
        statusEl.textContent = "✓ Connected";
        statusEl.className = "status-badge success";
      }
    } else {
      showToast("Yahoo Finance returned no data. Try again shortly.", "error");
    }
  } catch (err) {
    showToast(`India connection failed: ${err.message}`, "error");
  } finally {
    btn.textContent = "Test connection";
    btn.disabled = false;
    if (statusEl && statusEl.querySelector(".skeleton-inline-loader")) {
      statusEl.innerHTML = "";
    }
  }
}

function handleSaveAppearance() {
  const tickerSpeed = Math.min(300, Math.max(
    5,
    Number(tickerSpeedEl.value) || DEFAULT_SETTINGS.tickerStyleConfig.tickerSpeed
  ));

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
    const sym = normalizeCryptoSymbol(symbolRaw.trim());
    if (!sym) continue;
    result.push({
      symbol: sym,
      quantity: qty
    });
  }
  return result;
}

/** Finnhub crypto quotes use BINANCE:PAIR format (e.g. BINANCE:BTCUSDT). */
function normalizeCryptoSymbol(raw) {
  const s = String(raw).trim().toUpperCase();
  if (!s || s.length > 40) return "";
  const normalized = s.includes(":") ? s : `BINANCE:${s}`;
  // Allow only alphanumeric and colon — reject anything unexpected.
  return /^[A-Z0-9:]{1,40}$/.test(normalized) ? normalized : "";
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
        holdingsPreviewEl.replaceChildren();
        const empty = document.createElement("div");
        empty.className = "preview-empty";
        empty.textContent = "No holdings loaded — import a CSV above";
        holdingsPreviewEl.appendChild(empty);
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
      holdingsPreviewEl.replaceChildren(table);

      requestAnimationFrame(() => {
        holdingsPreviewEl.classList.remove("preview-updating");
      });
    });
  });
}

// Error log
const errorLogEntries = [];
const errorLogSection = document.getElementById("section-error-log");
const errorLogList = document.getElementById("errorLogList");
const errorLogCountEl = document.getElementById("errorLogCount");

function addToErrorLog(message) {
  const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  errorLogEntries.push({ time: timeStr, message });

  if (errorLogSection) errorLogSection.style.display = "";
  if (errorLogCountEl) {
    errorLogCountEl.textContent = `${errorLogEntries.length} error${errorLogEntries.length !== 1 ? "s" : ""}`;
  }
  if (errorLogList) {
    const entry = document.createElement("div");
    entry.className = "error-log-entry";

    const timeSpan = document.createElement("span");
    timeSpan.className = "error-log-time";
    timeSpan.textContent = timeStr;

    const msgSpan = document.createElement("span");
    msgSpan.className = "error-log-msg";
    msgSpan.textContent = message;

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn-copy-entry";
    copyBtn.textContent = "Copy";
    const fullText = `[${timeStr}] ${message}`;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(fullText).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    });

    entry.append(timeSpan, msgSpan, copyBtn);
    errorLogList.appendChild(entry);
    errorLogList.scrollTop = errorLogList.scrollHeight;
  }
}

document.getElementById("copyAllErrorsButton")?.addEventListener("click", () => {
  const text = errorLogEntries.map((e) => `[${e.time}] ${e.message}`).join("\n");
  navigator.clipboard.writeText(text).then(() => showToast("Error log copied", "success"));
});

document.getElementById("clearErrorLogButton")?.addEventListener("click", () => {
  errorLogEntries.length = 0;
  if (errorLogList) errorLogList.replaceChildren();
  if (errorLogSection) errorLogSection.style.display = "none";
});

// Toast notification system
let toastTimeout = null;
function showToast(message, type = "success") {
  if (type === "error") addToErrorLog(message);
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
