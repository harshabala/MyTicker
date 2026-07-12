// Local-first metrics. Counts and dates only — never uploaded, no telemetry.

import { STORAGE_KEYS, recordActiveDay } from "./shared.js";

const DEFAULT_METRICS = {
  activatedAt: null,
  firstRefreshAt: null,
  activeDays: [],
  imports: {}
};

export async function getMetrics() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.metrics]);
  const raw = data[STORAGE_KEYS.metrics] || {};
  return {
    activatedAt: raw.activatedAt ?? null,
    firstRefreshAt: raw.firstRefreshAt ?? null,
    activeDays: Array.isArray(raw.activeDays) ? raw.activeDays : [],
    imports: raw.imports && typeof raw.imports === "object" ? { ...raw.imports } : {}
  };
}

export async function updateMetrics(patch) {
  const current = await getMetrics();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.metrics]: next });
  return next;
}

/** First successful quote fetch + active-day stamp (while ticker enabled). */
export async function recordSuccessfulRefresh(now = Date.now()) {
  const current = await getMetrics();
  const next = {
    ...current,
    firstRefreshAt: current.firstRefreshAt ?? now,
    activeDays: recordActiveDay(current.activeDays, now)
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.metrics]: next });
  return next;
}

/** Record activation once (idempotent). */
export async function markActivated(now = Date.now()) {
  const current = await getMetrics();
  if (current.activatedAt != null) return current;
  const next = { ...current, activatedAt: now };
  await chrome.storage.local.set({ [STORAGE_KEYS.metrics]: next });
  return next;
}

/** Local import success/fail counters by broker preset. */
export async function recordImportResult(presetKey, ok) {
  const key = String(presetKey || "generic");
  const current = await getMetrics();
  const imports = { ...current.imports };
  const bucket = { success: 0, fail: 0, ...(imports[key] || {}) };
  if (ok) bucket.success += 1;
  else bucket.fail += 1;
  imports[key] = bucket;
  const next = { ...current, imports };
  await chrome.storage.local.set({ [STORAGE_KEYS.metrics]: next });
  return next;
}

export { DEFAULT_METRICS };
