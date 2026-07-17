// Ensures startup and install share one settings migration write.
import assert from "node:assert/strict";

let installedListener;
let resolveGet;
let getCalls = 0;
let setCalls = 0;
const pendingGet = new Promise((resolve) => { resolveGet = resolve; });

globalThis.chrome = {
  storage: {
    sync: {
      get() { getCalls++; return pendingGet; },
      async set() { setCalls++; }
    },
    local: { async get(keys) { return Object.fromEntries(keys.map((key) => [key, undefined])); }, async set() {} }
  },
  runtime: { id: "migration-test", onMessage: { addListener() {} }, onInstalled: { addListener(listener) { installedListener = listener; } }, openOptionsPage() {} },
  alarms: { create() {}, get(_name, callback) { callback(null); }, onAlarm: { addListener() {} } },
  commands: { onCommand: { addListener() {} } }
};

await import(`../background.js?migration-serialization-test=${Date.now()}`);
assert.ok(installedListener, "background registers install migration");
installedListener({ reason: "update" });
assert.equal(getCalls, 1, "startup and install share one in-flight migration read");
resolveGet({ pts_settings: { enabled: true } });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(setCalls, 1, "startup and install share one migration write");

console.log("migration serialization: passed");
