// Migration must not overwrite a newer settings edit that arrives mid-read.
import assert from "node:assert/strict";

let getCalls = 0;
let written;
let installed;
const legacy = { enabled: true, tickerStyleConfig: { tickerSpeed: 40 } };
const newer = { enabled: false, tickerStyleConfig: { tickerSpeed: 88 } };
globalThis.chrome = {
  storage: {
    sync: {
      async get() {
        getCalls++;
        return { pts_settings: getCalls === 1 ? legacy : newer };
      },
      async set(values) { written = values.pts_settings; }
    },
    local: { async get(keys) { return Object.fromEntries(keys.map((key) => [key, undefined])); }, async set() {} }
  },
  runtime: { id: "migration-race", onMessage: { addListener() {} }, onInstalled: { addListener(listener) { installed = listener; } }, openOptionsPage() {} },
  alarms: { create() {}, get(_name, callback) { callback(null); }, onAlarm: { addListener() {} } },
  commands: { onCommand: { addListener() {} } }
};

await import(`../background.js?migration-stale-write-test=${Date.now()}`);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(getCalls >= 2, true, "migration re-reads settings before writing");
assert.equal(written.enabled, false, "migration preserves a newer enabled preference");
assert.equal(written.tickerStyleConfig.tickerSpeed, 88, "migration preserves a newer nested preference");
assert.ok(installed, "background still registers installation handling");
console.log("migration stale-write protection: passed");
