// Setup progress helpers for first-time user onboarding.

import { STORAGE_KEYS } from "./shared.js";

const RATE_LIMIT_HOLDINGS_THRESHOLD = 40;

export async function getSetupStatus() {
  const [local, sync] = await Promise.all([
    chrome.storage.local.get([
      STORAGE_KEYS.holdings,
      STORAGE_KEYS.positionsState,
      STORAGE_KEYS.pollHealth,
      STORAGE_KEYS.onboarding,
      "pts_price_api_key"
    ]),
    chrome.storage.sync.get([STORAGE_KEYS.settings])
  ]);

  const apiKey = (local["pts_price_api_key"] || "").trim();
  const holdings = local[STORAGE_KEYS.holdings] || [];
  const positionsState = local[STORAGE_KEYS.positionsState];
  const pollHealth = local[STORAGE_KEYS.pollHealth] || {};
  const onboarding = local[STORAGE_KEYS.onboarding] || {};

  const hasApiKey = apiKey.length > 0;
  const hasHoldings = holdings.length > 0;
  const lastFetch = Number(pollHealth.lastSuccessfulFetch) || Number(positionsState?.updatedAt) || 0;
  const hasLiveData = !!(positionsState?.positions?.length);
  const complete = hasApiKey && hasHoldings && hasLiveData;

  return {
    hasApiKey,
    hasHoldings,
    hasLiveData,
    lastFetch,
    complete,
    holdingsCount: holdings.length,
    rateLimitRisk: holdings.length > RATE_LIMIT_HOLDINGS_THRESHOLD,
    wizardStep: Number(onboarding.wizardStep) || 1,
    setupDismissed: !!onboarding.setupDismissed,
    firstInstall: !!onboarding.firstInstall
  };
}

export async function setOnboarding(patch) {
  const data = await chrome.storage.local.get([STORAGE_KEYS.onboarding]);
  const current = data[STORAGE_KEYS.onboarding] || {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.onboarding]: { ...current, ...patch }
  });
}

export async function markWizardStep(step) {
  await setOnboarding({ wizardStep: step, firstInstall: false });
}

export async function completeSetup() {
  await setOnboarding({
    wizardStep: 3,
    setupComplete: true,
    firstInstall: false,
    setupDismissed: true
  });
}

export function formatLastSync(ts) {
  if (!ts) return "Never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export { RATE_LIMIT_HOLDINGS_THRESHOLD };