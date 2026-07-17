// Security regression coverage for service-worker message routing.
// Run with: node test_fixtures/test_background_message_boundaries.mjs

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const local = new Map();
const session = new Map();
const sync = new Map([["pts_settings", { enabled: false }]]);
let messageListener;
let syncGets = 0;
globalThis.fetch = async () => new Response(JSON.stringify({ c: 123.45 }), { status: 200 });

function read(map, keys) {
  return Object.fromEntries(keys.map((key) => [key, map.get(key)]));
}

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => read(local, keys),
      set: async (values) => Object.entries(values).forEach(([key, value]) => local.set(key, value)),
      remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => local.delete(key))
    },
    session: {
      get: async (keys) => read(session, keys),
      set: async (values) => Object.entries(values).forEach(([key, value]) => session.set(key, value)),
      remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => session.delete(key))
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

let vaultResponse;
messageListener(
  { type: "vault-status", payload: {} },
  { id: "test-extension-id", url: "chrome-extension://test-extension-id/options.html" },
  (value) => { vaultResponse = value; }
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(vaultResponse, { ok: true, status: { configured: false, unlocked: false } }, "vault status exposes no secret");

local.set("pts_price_api_key", "legacy-finnhub-secret");
messageListener(
  { type: "vault-unlock", payload: { unlockCode: "123456" } },
  { id: "test-extension-id", url: "chrome-extension://test-extension-id/options.html" },
  (value) => { vaultResponse = value; }
);
await new Promise((resolve) => setTimeout(resolve, 1000));
assert(vaultResponse?.ok && local.has("pts_finnhub_vault") && !local.has("pts_price_api_key"), "legacy key migrates only after encrypted vault write");
assert(typeof session.get("pts_finnhub_vault_aes_material") === "string" && ![...session.values()].includes("legacy-finnhub-secret"), "session stores only derived AES vault material, never the API key");

await new Promise((resolve) => messageListener(
  { type: "vault-test-connection", payload: {} },
  { id: "test-extension-id", url: "chrome-extension://test-extension-id/options.html" },
  (value) => { vaultResponse = value; resolve(); }
));
assert.deepEqual(vaultResponse, { ok: true, result: { symbol: "AAPL", price: 123.45 } }, "worker tests an unlocked key without returning it");

const backgroundSource = await readFile(new URL("../background.js", import.meta.url), "utf8");
assert(backgroundSource.includes('getUnlockedFinnhubKey()') && !backgroundSource.includes('localData["pts_price_api_key"]'), "locked polling omits Finnhub while India and crypto providers remain eligible");
assert(backgroundSource.includes('message.type === "vault-test-connection"') && backgroundSource.includes('testVaultConnection()'), "trusted UI can test an unlocked key without receiving it");

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
