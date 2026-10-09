// Local-first metrics. Counts and dates only — never uploaded, no telemetry.

import { STORAGE_KEYS, recordActiveDay } from "./shared.js";

async function writeMetrics(next) {
  await chrome.storage.local.set({ [STORAGE_KEYS.metrics]: next });
  return next;
}

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

/** First successful quote fetch + active-day stamp (while ticker enabled). */
export async function recordSuccessfulRefresh(now = Date.now()) {
  const current = await getMetrics();
  return writeMetrics({
    ...current,
    firstRefreshAt: current.firstRefreshAt ?? now,
    activeDays: recordActiveDay(current.activeDays, now)
  });
}

/** Record activation once (idempotent). */
export async function markActivated(now = Date.now()) {
  const current = await getMetrics();
  if (current.activatedAt != null) return current;
  return writeMetrics({ ...current, activatedAt: now });
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
  return writeMetrics({ ...current, imports });
}
