import { STORAGE_KEYS, DEFAULT_SETTINGS, CRYPTO_CATALOG, normalizeCryptoConfig, normalizeManualCryptoHoldings, normalizeWatchlistSymbol, resolveCryptoCatalogEntry } from "./shared.js";
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
const tapeScaleEls = document.querySelectorAll('input[name="tapeScale"]');
const themeEls = document.querySelectorAll('input[name="theme"]');
const appearanceStatusEl = document.getElementById("appearanceStatus");

const cryptoModeEl = document.getElementById("cryptoMode");
const cryptoStatusEl = document.getElementById("cryptoStatus");
const cryptoManualField = document.getElementById("cryptoManualField");
const cryptoSearchEl = document.getElementById("cryptoSearch");
const cryptoSearchResultsEl = document.getElementById("cryptoSearchResults");
const cryptoSelectedChipsEl = document.getElementById("cryptoSelectedChips");
let selectedCrypto = [];
const watchlistTypeEl = document.getElementById("watchlistType");
const watchlistExchangeEl = document.getElementById("watchlistExchange");
const watchlistInputEl = document.getElementById("watchlistInput");
const watchlistErrorEl = document.getElementById("watchlistError");
const watchlistStatusEl = document.getElementById("watchlistStatus");
const watchlistConfiguredEl = document.getElementById("watchlistConfigured");

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
const diagnosticsOutputEl = document.getElementById("diagnosticsOutput");
const copyDiagnosticsButton = document.getElementById("copyDiagnosticsButton");
const refreshDiagnosticsButton = document.getElementById("refreshDiagnosticsButton");

const EYE_OPEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const WIZARD_HINTS = {
  1: "Optional: add a Finnhub key if you hold US equities. Crypto quotes do not need it.",
  2: "Import your holdings (Zerodha CSV). Indian stocks price automatically — no API key.",
  3: "Open any tab — the strip and today's P&L appear when prices load."
};

const WIZARD_NEXT_LABELS = {
  1: "Optional: US price key",
  2: "Import holdings",
  3: "Go live"
};

init();

function init() {
  setPlatformShortcut(document.getElementById("tipsShortcut"));
  wireSettingsTabs();
  wireWizardSteps();
  // Legacy setup/market/diagnostics URLs resolve to the consolidated data task.
  const requestedHash = (location.hash || "").replace(/^#/, "").toLowerCase();
  const hashTab = ["setup", "market", "diagnostics", "tips"].includes(requestedHash) ? "data" : requestedHash;
  if (hashTab && document.querySelector(`.settings-tab[data-tab="${hashTab}"]`)) {
    switchSettingsTab(hashTab);
  }
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
    const tapeScale = normalizeTapeScale(settings.tickerStyleConfig?.tapeScale);
    tapeScaleEls.forEach((input) => {
      input.checked = input.value === tapeScale;
    });
    const theme = normalizeTheme(settings.tickerStyleConfig?.theme);
    themeEls.forEach((input) => { input.checked = input.value === theme; });
    applyDocumentTheme(theme);

    const cryptoConfig = normalizeCryptoConfig(settings.cryptoConfig || DEFAULT_SETTINGS.cryptoConfig);
    cryptoModeEl.value = cryptoConfig.mode;
    selectedCrypto = cryptoConfig.manualHoldings || [];
    renderCryptoSelector();

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
  importCsvButton.addEventListener("click", () => handleImportCsv());
  clearHoldingsButton.addEventListener("click", handleClearHoldings);
  document.getElementById("saveProviderButton").addEventListener("click", handleSaveProvider);
  document.getElementById("testIndiaButton").addEventListener("click", handleTestIndia);
  document.getElementById("saveAppearanceButton").addEventListener("click", handleSaveAppearance);
  document.getElementById("saveCryptoButton").addEventListener("click", handleSaveCrypto);
  document.getElementById("addWatchlistButton")?.addEventListener("click", handleAddWatchlist);
  refreshPreviewButton.addEventListener("click", handleRefreshPreview);
  testConnectionButton.addEventListener("click", handleTestConnection);
  copyDiagnosticsButton?.addEventListener("click", copyDiagnostics);
  refreshDiagnosticsButton?.addEventListener("click", renderDiagnostics);

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
  cryptoSearchEl?.addEventListener("input", renderCryptoSelector);
  watchlistTypeEl?.addEventListener("change", updateWatchlistHint);
  watchlistInputEl?.addEventListener("input", () => { if (watchlistErrorEl) watchlistErrorEl.textContent = ""; });

  // Drag-and-drop / file pick — pass File objects directly (avoid double-read races)
  dropZone.addEventListener("click", (e) => {
    // Don't steal clicks from nested controls
    if (e.target === csvFileEl) return;
    csvFileEl.click();
  });
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      csvFileEl.click();
    }
  });
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("dragover");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      handleImportCsv(file);
    } else {
      showToast("No file found in that drop. Try Browse or Import sample.", "error");
    }
  });
  csvFileEl.addEventListener("change", () => {
    const file = csvFileEl.files?.[0];
    if (file) handleImportCsv(file);
  });

  const importSampleBtn = document.getElementById("importSampleButton");
  if (importSampleBtn) {
    importSampleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleImportPackagedCsv("test_fixtures/sample_holdings_zerodha.csv", "zerodha");
    });
  }
  const importUserBtn = document.getElementById("importUserHoldingsButton");
  if (importUserBtn) {
    importUserBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleImportPackagedCsv("test_fixtures/user_holdings.csv", "zerodha");
    });
  }

  // Populate preview on load.
  handleRefreshPreview();
  refreshSetupUI();
  renderImportStats();
  renderDiagnostics();
  updateWatchlistHint();
  renderConfiguredWatchlist();
}

function updateWatchlistHint() {
  if (!watchlistTypeEl) return;
  const crypto = watchlistTypeEl.value === "crypto";
  document.getElementById("watchlistExchangeField")?.toggleAttribute("hidden", watchlistTypeEl.value !== "india");
  watchlistInputEl.placeholder = crypto ? "BTC or Bitcoin" : watchlistTypeEl.value === "india" ? "RELIANCE" : "AAPL or SPY";
  document.getElementById("watchlistHint").textContent = crypto
    ? "Supported: BTC/Bitcoin, ETH/Ethereum, BNB, XRP, SOL/Solana."
    : watchlistTypeEl.value === "india" ? "India symbols are normalized to the selected NSE/BSE suffix."
    : "Use the canonical symbol. Live US prices require Finnhub.";
}

async function handleAddWatchlist() {
  const type = watchlistTypeEl.value;
  const raw = watchlistInputEl.value;
  const crypto = type === "crypto" ? resolveCryptoCatalogEntry(raw) : null;
  const item = crypto
    ? { symbol: crypto.id, canonicalKey: `crypto:${crypto.id}`, displayName: `${crypto.symbol} / ${crypto.name}`, currency: "USD", assetClass: "crypto" }
    : normalizeWatchlistSymbol(raw, type, watchlistExchangeEl.value);
  if (!item) {
    watchlistErrorEl.textContent = type === "crypto"
      ? "Unsupported crypto. Search BTC/Bitcoin, ETH/Ethereum, BNB, XRP, or SOL/Solana."
      : type === "india" ? "Enter an Indian symbol such as RELIANCE, then select NSE or BSE." : "Enter a canonical US, index, or ETF symbol (for example AAPL or SPY).";
    return;
  }
  item.canonicalKey ||= `equity:${item.symbol}`;
  const data = await chrome.storage.local.get([STORAGE_KEYS.watchlist]);
  const current = Array.isArray(data[STORAGE_KEYS.watchlist]) ? data[STORAGE_KEYS.watchlist] : [];
  if (!current.some((entry) => (entry.canonicalKey || `equity:${entry.symbol}`) === item.canonicalKey)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.watchlist]: [...current, item] });
    requestImmediatePoll();
  }
  watchlistInputEl.value = "";
  watchlistErrorEl.textContent = "";
  watchlistStatusEl.textContent = `${item.displayName} added`;
  renderConfiguredWatchlist();
}

async function renderConfiguredWatchlist() {
  if (!watchlistConfiguredEl) return;
  const data = await chrome.storage.local.get([STORAGE_KEYS.watchlist]);
  const items = data[STORAGE_KEYS.watchlist] || [];
  watchlistConfiguredEl.textContent = items.length ? `Watching: ${items.map((item) => item.displayName || item.symbol).join(" · ")}` : "No watchlist symbols configured yet.";
}

function setPlatformShortcut(el) {
  if (!el) return;
  const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  el.textContent = platform.includes("mac") ? "⌘+Shift+Y" : "Ctrl+Shift+Y";
}

/** Map wizard steps → settings tabs (sections live on different panels). */
const WIZARD_STEP_TO_TAB = {
  1: "data", // optional US Finnhub key
  2: "portfolio", // import holdings
  3: "data" // go live / status
};

const DATA_PANEL_IDS = new Set(["setup", "market", "diagnostics", "tips"]);

function wireSettingsTabs() {
  const tabs = document.querySelectorAll(".settings-tab[data-tab]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      switchSettingsTab(tab.dataset.tab);
    });
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
        return;
      }
      e.preventDefault();
      const list = Array.from(tabs);
      const i = list.indexOf(tab);
      let next = i;
      if (e.key === "ArrowRight") next = (i + 1) % list.length;
      if (e.key === "ArrowLeft") next = (i - 1 + list.length) % list.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = list.length - 1;
      list[next].focus();
      switchSettingsTab(list[next].dataset.tab);
    });
  });
}

function switchSettingsTab(tabId) {
  if (!tabId) return;
  const tabs = document.querySelectorAll(".settings-tab[data-tab]");
  const panels = document.querySelectorAll(".tab-panel[id^='tab-']");
  let matched = false;
  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === tabId;
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.tabIndex = selected ? 0 : -1;
    if (selected) matched = true;
  });
  if (!matched) return;
  panels.forEach((panel) => {
    const panelId = panel.id.replace(/^tab-/, "");
    const active = tabId === "data" ? DATA_PANEL_IDS.has(panelId) : panelId === tabId;
    panel.classList.toggle("is-active", active);
    if (active) {
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "");
    }
  });
  try {
    history.replaceState(null, "", `#${tabId}`);
  } catch {
    /* ignore */
  }
  // Refresh tab-specific live data when opened
  if (tabId === "portfolio") {
    handleRefreshPreview();
    renderImportStats();
  }
  if (tabId === "data") {
    refreshSetupUI();
    renderDiagnostics();
  }
}

function formatDiagnosticTime(timestamp) {
  const time = Number(timestamp);
  return time ? new Date(time).toLocaleString() : "Never";
}

function providerResultLine(lastProviderResults, key, label) {
  const count = Number(lastProviderResults?.[key]) || 0;
  return `${label}: ${count} quote${count === 1 ? "" : "s"} in last provider result`;
}

async function renderDiagnostics() {
  if (!diagnosticsOutputEl) return;
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get([STORAGE_KEYS.settings]),
    chrome.storage.local.get([
      STORAGE_KEYS.holdings,
      STORAGE_KEYS.watchlist,
      STORAGE_KEYS.positionsState,
      STORAGE_KEYS.pollHealth,
      STORAGE_KEYS.diagnosticsLog,
      STORAGE_KEYS.contentScriptStatus,
      "pts_price_api_key"
    ])
  ]);
  const settings = syncData[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
  const holdings = Array.isArray(localData[STORAGE_KEYS.holdings]) ? localData[STORAGE_KEYS.holdings] : [];
  const watchlist = Array.isArray(localData[STORAGE_KEYS.watchlist]) ? localData[STORAGE_KEYS.watchlist] : [];
  const state = localData[STORAGE_KEYS.positionsState] || {};
  const health = localData[STORAGE_KEYS.pollHealth] || {};
  const log = Array.isArray(localData[STORAGE_KEYS.diagnosticsLog]) ? localData[STORAGE_KEYS.diagnosticsLog] : [];
  const providerResults = [...log].reverse().find((entry) => entry.event === "provider-results");
  const contentStatus = localData[STORAGE_KEYS.contentScriptStatus] || {};
  const cryptoEnabled = !!settings.cryptoConfig?.includeCrypto && settings.portfolioFilters?.showCrypto !== false;
  const finnhubConfigured = !!String(localData["pts_price_api_key"] || "").trim();
  const buildVersion = chrome.runtime.getManifest?.().version || "0.5.0";
  const lines = [
    `MyTicker diagnostics · build v${buildVersion}`,
    `Ticker enabled: ${settings.enabled ? "yes" : "no"}`,
    `Holdings: ${holdings.length} · Watchlist: ${watchlist.length} · Ticker items: ${(state.tickerItems || state.positions || []).length}`,
    `Last state update: ${formatDiagnosticTime(state.updatedAt)}`,
    `Poll health: ${Number(health.consecutiveFailures) || 0} consecutive failure(s) · last successful fetch ${formatDiagnosticTime(health.lastSuccessfulFetch)}`,
    `Content script: ${contentStatus.stage || "never reported"} · ${contentStatus.origin || "no page origin"} · ${formatDiagnosticTime(contentStatus.timestamp)}${contentStatus.error ? ` · ${contentStatus.error.name}: ${contentStatus.error.message || ""}` : ""}`,
    "",
    "Provider availability and latest result:",
    `CoinGecko: primary crypto source · ${cryptoEnabled ? "eligible when supported crypto is enabled" : "crypto disabled"} · ${providerResultLine(providerResults, "coinGeckoQuotes", "result")}`,
    `Binance: fallback for mapped liquid crypto only · ${cryptoEnabled ? "available" : "crypto disabled"} · ${providerResultLine(providerResults, "binanceQuotes", "result")}`,
    `Yahoo Finance: automatic for .NS/.BO · available · ${providerResultLine(providerResults, "yahooQuotes", "result")}`,
    `Finnhub: US equities · ${finnhubConfigured ? "API key configured" : "no API key configured"} · ${providerResultLine(providerResults, "finnhubQuotes", "result")}`,
    "",
    "Recent refresh lifecycle (safe operational counts only):"
  ];
  if (!log.length) {
    lines.push("No refresh diagnostics recorded yet.");
  } else {
    for (const entry of log.slice(-12)) {
      const details = ["holdingsCount", "watchlistCount", "cryptoCount", "equitySymbols", "totalSymbols", "equityQuotes", "cryptoQuotes", "quoteCount"]
        .filter((key) => Number.isFinite(entry[key]))
        .map((key) => `${key.replace("Count", "")}=${entry[key]}`);
      lines.push(`${formatDiagnosticTime(entry.timestamp)} · ${entry.event}${details.length ? ` · ${details.join(", ")}` : ""}${entry.error ? " · Refresh failed" : ""}`);
    }
  }
  diagnosticsOutputEl.textContent = lines.join("\n");
}

async function copyDiagnostics() {
  const text = diagnosticsOutputEl?.textContent || "";
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Diagnostics copied", "success");
  } catch {
    showToast("Could not copy diagnostics. Select the text and copy it manually.", "error");
  }
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
  const tabId = WIZARD_STEP_TO_TAB[step];
  if (tabId) {
    switchSettingsTab(tabId);
  }
  const target = step === 1 ? sectionMarket : step === 2 ? sectionImport : null;
  if (target) {
    // Wait a frame so the target tab is visible before highlighting.
    requestAnimationFrame(() => {
      target.classList.add("section-highlight");
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => target.classList.remove("section-highlight"), 2000);
    });
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

  setPill(statusHoldingsEl, status.hasHoldings, `Holdings (${status.holdingsCount})`);
  setPill(statusLiveEl, status.hasLiveData, "Live prices");
  setPill(statusSyncEl, status.lastFetch > 0, `Sync ${formatLastSync(status.lastFetch)}`);
  // API key is optional — only highlight when US symbols need it
  if (statusApiEl) {
    if (status.needsUsKey && !status.hasApiKey) {
      setPill(statusApiEl, false, "US key (optional)");
    } else if (status.hasApiKey) {
      setPill(statusApiEl, true, "US key");
    } else {
      setPill(statusApiEl, true, "India prices (auto)");
    }
  }

  if (rateLimitWarnEl) {
    rateLimitWarnEl.classList.toggle("visible", status.rateLimitRisk);
  }

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

  // Wizard: holdings first (step 2), then live (3). Step 1 = optional US only.
  const step = !status.hasHoldings ? 2 : status.hasLiveData ? 3 : 2;
  document.querySelectorAll(".wizard-step").forEach((btn) => {
    const n = Number(btn.dataset.step);
    const done =
      (n === 1 && (!status.needsUsKey || status.hasApiKey)) ||
      (n === 2 && status.hasHoldings) ||
      (n === 3 && status.hasLiveData);
    btn.classList.toggle("active", n === step && !status.complete);
    btn.classList.toggle("done", done);
    btn.classList.toggle("is-next", n === step && !done);
    btn.setAttribute("aria-current", n === step && !status.complete ? "step" : "false");
  });
  if (wizardHintEl) {
    if (status.complete) {
      wizardHintEl.textContent =
        "You're live. Indian prices load automatically. US equities need a Finnhub key under Market Data; crypto quotes do not.";
    } else if (!status.hasHoldings) {
      wizardHintEl.textContent = WIZARD_HINTS[2];
    } else {
      wizardHintEl.textContent =
        "Holdings saved. Fetching prices… keep the strip on and open any tab.";
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
    cryptoManualField.hidden = !open;
    cryptoManualField.inert = !open;
    cryptoManualField.classList.toggle("is-open", open);
    cryptoManualField.setAttribute("aria-hidden", open ? "false" : "true");
  }
}

function renderCryptoSelector() {
  if (!cryptoSearchResultsEl || !cryptoSelectedChipsEl) return;
  const query = (cryptoSearchEl?.value || "").trim().toLowerCase();
  const matches = CRYPTO_CATALOG.filter((coin) => !query || [coin.id, coin.symbol, coin.name].some((value) => value.toLowerCase().includes(query)));
  cryptoSearchResultsEl.replaceChildren(...matches.map((coin) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "btn btn-secondary"; button.textContent = `Add ${coin.symbol} / ${coin.name}`;
    button.addEventListener("click", () => { if (!selectedCrypto.some((item) => item.symbol === coin.id)) selectedCrypto.push({ symbol: coin.id, quantity: 1 }); cryptoSearchEl.value = ""; renderCryptoSelector(); });
    return button;
  }));
  cryptoSelectedChipsEl.replaceChildren(...selectedCrypto.map((item) => {
    const coin = resolveCryptoCatalogEntry(item.symbol); const chip = document.createElement("button"); chip.type = "button"; chip.className = "btn btn-secondary"; chip.textContent = `${coin?.symbol || item.symbol} ×`;
    chip.addEventListener("click", () => { selectedCrypto = selectedCrypto.filter((entry) => entry.symbol !== item.symbol); renderCryptoSelector(); }); return chip;
  }));
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

let importInFlight = false;

/** Read a File/Blob as text without relying on FileReader (more reliable in MV3 options). */
async function readFileAsText(file) {
  if (!file) throw new Error("No file selected");
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => {
      const err = reader.error;
      reject(new Error(err?.message || err?.name || "FileReader failed"));
    };
    try {
      reader.readAsText(file);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * @param {File|null} [fileOverride] - When set (drop/sample), use this File instead of the input.
 */
async function handleImportCsv(fileOverride = null) {
  if (importInFlight) return;

  // Event objects can arrive from addEventListener("click", handleImportCsv)
  const file =
    fileOverride instanceof File || fileOverride instanceof Blob
      ? fileOverride
      : csvFileEl.files?.[0];

  if (!file) {
    showToast("Please choose a CSV file, or click Import sample CSV.", "error");
    return;
  }
  if (file.size > 500_000) {
    showToast("CSV is too large (max 500 KB). Export only your holdings, not full transaction history.", "error");
    return;
  }
  if (file.size === 0) {
    showToast("That file is empty (0 bytes). Re-download the sample or re-export from your broker.", "error");
    return;
  }

  importInFlight = true;
  importCsvButton.disabled = true;
  importCsvButton.textContent = "Importing…";

  let presetKey = brokerPresetEl.value || "zerodha";
  try {
    const text = await readFileAsText(file);
    await processCsvText(text, presetKey);
  } catch (err) {
    console.error("Failed to read/import CSV", err);
    const detail = err?.message || String(err);
    showToast(`Could not read file (${detail}). Try Import sample CSV instead.`, "error");
    await recordImportResult(presetKey, false);
    await renderImportStats();
  } finally {
    importInFlight = false;
    importCsvButton.disabled = false;
    importCsvButton.textContent = "Import holdings";
  }
}

/**
 * Load a CSV packaged inside the extension (no FileReader / OS permission issues).
 * @param {string} relativePath e.g. test_fixtures/user_holdings.csv
 * @param {string} presetHint
 */
async function handleImportPackagedCsv(relativePath, presetHint = "zerodha") {
  if (importInFlight) return;
  importInFlight = true;
  importCsvButton.disabled = true;
  importCsvButton.textContent = "Importing…";
  try {
    const url = chrome.runtime.getURL(relativePath);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Could not load ${relativePath} (${resp.status})`);
    }
    const text = await resp.text();
    if (brokerPresetEl) brokerPresetEl.value = presetHint;
    await processCsvText(text, presetHint);
  } catch (err) {
    console.error("Packaged CSV import failed", err);
    showToast(err?.message || "Could not load packaged CSV.", "error");
    await recordImportResult(presetHint, false);
    await renderImportStats();
  } finally {
    importInFlight = false;
    importCsvButton.disabled = false;
    importCsvButton.textContent = "Import holdings";
  }
}

async function processCsvText(text, presetKeyHint = "zerodha") {
  let presetKey = presetKeyHint || brokerPresetEl.value || "zerodha";
  const raw = String(text || "");
  if (!raw.trim()) {
    showToast("That file looks empty.", "error");
    await recordImportResult(presetKey, false);
    await renderImportStats();
    return;
  }

  const rows = parseCsv(raw);

  // Auto-detect preset from headers; fall back to whatever is selected
  const detected = detectPresetFromRows(rows);
  if (detected && detected !== presetKey) {
    presetKey = detected;
    if (brokerPresetEl) brokerPresetEl.value = detected;
    showToast(`Auto-detected broker: ${BROKER_PRESETS[detected].name}`, "success");
  }
  const preset = BROKER_PRESETS[presetKey] || BROKER_PRESETS.generic;

  const diag = diagnoseCsvImport(rows, preset);
  if (diag) {
    showToast(diag, "error");
    await recordImportResult(presetKey, false);
    await renderImportStats();
    return;
  }

  const holdings = mapRowsToHoldings(rows, preset.columns, presetKey, preset.defaults || {});
  if (!holdings.length) {
    showToast("No holdings found in that CSV.", "error");
    await recordImportResult(presetKey, false);
    await renderImportStats();
    return;
  }
  const nsCount = holdings.filter((h) => h.symbol.endsWith(".NS")).length;

  await chrome.storage.local.set({ [STORAGE_KEYS.holdings]: holdings });
  const msg =
    nsCount > 0
      ? `Imported ${holdings.length} holdings (${nsCount} with .NS for NSE)`
      : `Imported ${holdings.length} holdings (${preset.name})`;
  showToast(msg, "success");
  if (csvStatusEl) csvStatusEl.textContent = `${holdings.length} holdings`;
  await recordImportResult(presetKey, true);
  await renderImportStats();
  await markWizardStep(3);
  handleRefreshPreview();
  requestImmediatePoll();
  refreshSetupUI();
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
  const selectedTapeScale = document.querySelector('input[name="tapeScale"]:checked')?.value;
  const tapeScale = normalizeTapeScale(selectedTapeScale);
  const theme = normalizeTheme(document.querySelector('input[name="theme"]:checked')?.value);

  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || { ...DEFAULT_SETTINGS };
    settings.tickerStyleConfig = {
      ...(settings.tickerStyleConfig || {}),
      tickerSpeed,
      tapeScale,
      theme
    };

    settings.portfolioFilters = {
      ...(settings.portfolioFilters || DEFAULT_SETTINGS.portfolioFilters),
      showStocks: showStocksEl.checked,
      showCrypto: showCryptoEl.checked
    };

    chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings }, () => {
      applyDocumentTheme(theme);
      showToast("Appearance saved", "success");
    });
  });
}

function handleSaveCrypto() {
  const mode = cryptoModeEl.value || "off";
  const manualHoldings = normalizeManualCryptoHoldings(selectedCrypto);

  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || { ...DEFAULT_SETTINGS };
    settings.cryptoConfig = {
      includeCrypto: mode !== "off",
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

function normalizeTapeScale(value) {
  return ["compact", "comfortable", "large"].includes(value)
    ? value
    : DEFAULT_SETTINGS.tickerStyleConfig.tapeScale;
}

function normalizeTheme(value) {
  return ["system", "light", "dark"].includes(value) ? value : "system";
}

function applyDocumentTheme(theme) {
  if (!document.documentElement) return;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

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
    const coin = resolveCryptoCatalogEntry(symbolRaw.trim());
    if (!coin) continue;
    result.push({
      symbol: coin.id,
      quantity: qty
    });
  }
  return result;
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

      // Fixed header outside scroll body so column labels never scroll away
      const headWrap = document.createElement("div");
      headWrap.className = "preview-head";
      const headTable = document.createElement("table");
      headTable.className = "preview-table";
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      for (const label of ["Symbol", "Qty", "Broker", "Exchange"]) {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      headTable.appendChild(thead);
      headWrap.appendChild(headTable);

      const bodyWrap = document.createElement("div");
      bodyWrap.className = "preview-body";
      const bodyTable = document.createElement("table");
      bodyTable.className = "preview-table";
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
        tr.append(tdSym, tdQty, tdBroker, tdExchange);
        tbody.appendChild(tr);
      }

      if (cryptoConfig.includeCrypto) {
        const mode = cryptoConfig.mode || "top5";
        if (mode === "manual") {
          const manual = Array.isArray(cryptoConfig.manualHoldings) ? cryptoConfig.manualHoldings : [];
          for (const c of manual) {
            const tr = document.createElement("tr");
            const tdSym = document.createElement("td");
            tdSym.style.cssText = "color: var(--text-secondary); font-weight: 500;";
            tdSym.textContent = c.symbol;
            const tdQty = document.createElement("td");
            tdQty.textContent = c.quantity;
            const tdBroker = document.createElement("td");
            tdBroker.textContent = "manual";
            const tdExchange = document.createElement("td");
            tdExchange.textContent = "CRYPTO";
            tr.append(tdSym, tdQty, tdBroker, tdExchange);
            tbody.appendChild(tr);
          }
        } else {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 4;
          td.style.cssText = "text-align: center; color: var(--text-tertiary);";
          td.textContent = "Top 5 crypto watchlist enabled";
          tr.appendChild(td);
          tbody.appendChild(tr);
        }
      }

      bodyTable.appendChild(tbody);
      bodyWrap.appendChild(bodyTable);
      holdingsPreviewEl.replaceChildren(headWrap, bodyWrap);

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
