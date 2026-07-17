// Exercises the real content-lifecycle message bridge in the background worker.
// Run with: node test_fixtures/test_content_telemetry_bridge.mjs

import assert from "node:assert/strict";

const local = new Map();
let messageListener;
globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => Object.fromEntries(keys.map((key) => [key, local.get(key)])),
      set: async (values) => Object.entries(values).forEach(([key, value]) => local.set(key, value))
    },
    sync: {
      get: (_keys, callback) => {
        if (callback) callback({});
        return Promise.resolve({});
      },
      set: async () => {}
    }
  },
  runtime: {
    id: "telemetry-test-extension",
    onMessage: { addListener: (listener) => { messageListener = listener; } },
    onInstalled: { addListener() {} },
    openOptionsPage() {}
  },
  alarms: {
    create() {}, get: (_name, callback) => callback(null), onAlarm: { addListener() {} }
  },
  commands: { onCommand: { addListener() {} } }
};

await import(`../background.js?content-telemetry-test=${Date.now()}`);
assert.ok(messageListener, "background registers a runtime message listener");
messageListener({
  type: "content-script-lifecycle",
  payload: {
    stage: "fatal-error",
    origin: "https://www.linkedin.com",
    error: { name: "TypeError", message: "Failed at https://untrusted.example/path?secret=1" }
  }
}, { id: "telemetry-test-extension", tab: {}, frameId: 0, url: "https://www.linkedin.com/feed/update/urn:li:activity:1" });
await new Promise((resolve) => setTimeout(resolve, 0));

const status = local.get("pts_content_script_status");
assert.equal(status.origin, "https://www.linkedin.com", "persists sender origin without its path");
assert.equal(status.stage, "fatal-error", "persists the last lifecycle stage");
assert.deepEqual(status.error, { name: "TypeError", message: "Failed at [url]" }, "sanitizes the fatal error message");
const log = local.get("pts_diagnostics_log");
assert.equal(log.at(-1).event, "content-script-lifecycle", "records an aggregate lifecycle log entry");
assert.equal(log.at(-1).stage, "fatal-error", "records the lifecycle stage without page details");
assert.equal("origin" in log.at(-1), false, "does not persist page origin in the aggregate log");

messageListener({ type: "content-script-lifecycle", payload: { stage: "loaded", origin: "https://www.linkedin.com" } }, { id: "telemetry-test-extension", frameId: 0, url: "https://www.linkedin.com/feed" });
messageListener({ type: "content-script-lifecycle", payload: { stage: "loaded", origin: "https://www.linkedin.com" } }, { id: "foreign-extension", tab: {}, frameId: 0, url: "https://www.linkedin.com/feed" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(local.get("pts_content_script_status").stage, "fatal-error", "missing tab and mismatched extension id lifecycle senders are rejected");

console.log("content telemetry bridge: passed");
