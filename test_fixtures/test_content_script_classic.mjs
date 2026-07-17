// Smoke test that keeps manifest content scripts compatible with Chromium's
// classic-script injection model. Run with: node test_fixtures/test_content_script_classic.mjs

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const contentScripts = manifest.content_scripts || [];

assert.ok(contentScripts.length, "manifest declares content scripts");

for (const entry of contentScripts) {
  assert.equal(entry.type, undefined, "content scripts do not request unsupported module mode");
  for (const script of entry.js || []) {
    const source = await readFile(path.join(root, script), "utf8");
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: script }),
      `${script} parses as a classic script without top-level import/export`
    );
  }
}

const bridgeSource = await readFile(path.join(root, "contentShared.js"), "utf8");
const context = vm.createContext({ Intl });
new vm.Script(bridgeSource, { filename: "contentShared.js" }).runInContext(context);

const bridge = context.__MYTICKER_CONTENT_SHARED__;
assert.deepEqual(
  Object.keys(bridge).sort(),
  ["STORAGE_KEYS", "formatQuotePrice", "formatSigned", "formatSignedCurrency", "isHostTapeExcluded", "normalizeExcludedSites"],
  "content bridge exposes only the content script API"
);
assert.equal(bridge.STORAGE_KEYS.settings, "pts_settings");
assert.equal(bridge.formatSigned(1.5), "+1.50");
assert.equal(bridge.formatSignedCurrency(-1234.5, "USD"), "-$1,234.50");
assert.equal(bridge.formatQuotePrice(12.3, "USD"), "$12.3000");

// Chrome removes runtime APIs during an extension update/reload. Once that is
// detected, the content script must stop rather than attempting storage or DOM work.
let storageCallsAfterInvalidation = 0;
const invalidatedContext = vm.createContext({
  console,
  Intl,
  location: { origin: "https://example.test", hostname: "example.test" },
  __MYTICKER_CONTENT_SHARED__: bridge,
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
  document: { documentElement: {}, body: null, addEventListener() {} },
  chrome: {
    runtime: {
      sendMessage() { throw new Error("Extension context invalidated."); },
      getURL() { throw new Error("runtime access after invalidation"); }
    },
    storage: {
      sync: { get() { storageCallsAfterInvalidation++; } },
      local: { get() { storageCallsAfterInvalidation++; } },
      onChanged: { addListener() {} }
    }
  }
});
const contentSource = await readFile(path.join(root, "contentScript.js"), "utf8");
assert.doesNotThrow(() => new vm.Script(contentSource, { filename: "contentScript.js" }).runInContext(invalidatedContext));
assert.equal(storageCallsAfterInvalidation, 0, "invalidated extension context tears down before further Chrome API calls");

console.log("content script classic compatibility: passed");
