// Security regression coverage for service-worker message routing.
// Run with: node test_fixtures/test_background_message_boundaries.mjs

import assert from "node:assert/strict";

const local = new Map();
const sync = new Map([["pts_settings", { enabled: false }]]);
let messageListener;
let syncGets = 0;

function read(map, keys) {
  return Object.fromEntries(keys.map((key) => [key, map.get(key)]));
}

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => read(local, keys),
      set: async (values) => Object.entries(values).forEach(([key, value]) => local.set(key, value))
    },
    sync: {
      get: (keys, callback) => {
        syncGets++;
        const result = read(sync, keys);
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set: async (values) => Object.entries(values).forEach(([key, value]) => sync.set(key, value))
    }
  },
  runtime: {
    id: "test-extension-id",
    onMessage: { addListener: (listener) => { messageListener = listener; } },
    onInstalled: { addListener() {} },
    openOptionsPage() {}
  },
  alarms: { create() {}, get: (_name, callback) => callback(null), onAlarm: { addListener() {} } },
  commands: { onCommand: { addListener() {} } }
};

await import(`../background.js?message-boundaries-test=${Date.now()}`);
assert.ok(messageListener, "background registers its runtime message listener");

syncGets = 0;
messageListener(
  { type: "poll-now", payload: {} },
  { id: "foreign-extension", url: "https://evil.example/" },
  () => assert.fail("untrusted poll message must not receive a response")
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(syncGets, 0, "an untrusted message cannot start a poll");

let response;
const keptChannelOpen = messageListener(
  { type: "poll-now", payload: {} },
  { id: "test-extension-id", url: "chrome-extension://test-extension-id/popup.html" },
  (value) => { response = value; }
);
assert.equal(keptChannelOpen, true, "valid typed poll keeps the response channel open");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(syncGets, 1, "a trusted extension message can start a poll");
assert.deepEqual(response, { ok: true }, "trusted poll receives a typed-route response");

messageListener(
  { type: "content-script-lifecycle", payload: { stage: "loaded", origin: "https://evil.example" } },
  { id: "foreign-extension", frameId: 0, url: "https://evil.example/" }
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(local.has("pts_content_script_status"), false, "untrusted lifecycle message is ignored");

messageListener(
  { type: "content-script-lifecycle", payload: { stage: "loaded", origin: "chrome-extension://test-extension-id" } },
  { id: "test-extension-id", frameId: 0, url: "chrome-extension://test-extension-id/options.html" }
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(local.has("pts_content_script_status"), false, "extension pages cannot claim content lifecycle telemetry");

console.log("background message boundaries: passed");
