// Migration must not overwrite a newer settings edit that arrives mid-read.
import assert from "node:assert/strict";

let getCalls = 0;
let written;
let installed;
const legacy = { enabled: true, tickerStyleConfig: { tickerSpeed: 40 } };
const newer = { enabled: false, tickerStyleConfig: { tickerSpeed: 88 } };
let liveSettings = legacy;
globalThis.chrome = {
  storage: {
    sync: {
      async get() {
        getCalls++;
        // A newer Options write lands after migration's final read but before
        // its persistence call can run.
        liveSettings = newer;
        return { pts_settings: legacy, pts_settings_schema_version: undefined };
      },
      async set(values) { written = values; }
    },
    local: { async get(keys) { return Object.fromEntries(keys.map((key) => [key, undefined])); }, async set() {} }
  },
  runtime: { id: "migration-race", onMessage: { addListener() {} }, onInstalled: { addListener(listener) { installed = listener; } }, openOptionsPage() {} },
  alarms: { create() {}, get(_name, callback) { callback(null); }, onAlarm: { addListener() {} } },
  commands: { onCommand: { addListener() {} } }
};

await import(`../background.js?migration-stale-write-test=${Date.now()}`);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(getCalls, 1, "startup migration reads settings once without a stale retry write");
assert.equal(written.pts_settings, undefined, "migration never writes a stale settings snapshot");
assert.equal(liveSettings.enabled, false, "a newer enabled preference survives migration persistence");
assert.equal(liveSettings.tickerStyleConfig.tickerSpeed, 88, "a newer nested preference survives migration persistence");
assert.equal(written.pts_settings_schema_version, 1, "migration persists its version in a separate schema marker");
assert.ok(installed, "background still registers installation handling");
console.log("migration stale-write protection: passed");
