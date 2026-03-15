import { STORAGE_KEYS, DEFAULT_SETTINGS } from "./shared.js";

document.addEventListener("DOMContentLoaded", () => {
  const enabledToggle = document.getElementById("enabledToggle");
  const summaryEl = document.getElementById("summary");
  const openOptions = document.getElementById("openOptions");

  chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
    const settings = data[STORAGE_KEYS.settings] || DEFAULT_SETTINGS;
    enabledToggle.checked = !!settings.enabled;
  });

  chrome.storage.local.get([STORAGE_KEYS.positionsState], (data) => {
    const state = data[STORAGE_KEYS.positionsState];
    if (!state || !state.positions || !state.positions.length) {
      summaryEl.textContent = "No holdings yet. Upload via settings.";
      return;
    }
    const agg = state.aggregate || { dayPnl: 0, dayPnlPct: 0 };
    summaryEl.textContent = `Day: ${formatSigned(agg.dayPnl)} (${agg.dayPnlPct.toFixed(
      2
    )}%) across ${state.positions.length} holdings.`;
  });

  enabledToggle.addEventListener("change", () => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (data) => {
      const settings = data[STORAGE_KEYS.settings] || {};
      settings.enabled = enabledToggle.checked;
      chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings });
    });
  });

  openOptions.addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"));
    }
  });
});

function formatSigned(value) {
  const num = Number(value) || 0;
  if (num > 0) return `+${num.toFixed(2)}`;
  return num.toFixed(2);
}

