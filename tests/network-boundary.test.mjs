import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const SHIPPED = ["background.js", "priceProviders.js", "options.js", "popup.js", "onboarding.js", "shared.js", "metrics.js", "vault.js", "csvParser.js", "contentScript.js", "contentShared.js"];

test("every remote host in shipped code is declared, and every declared host is used", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  const declared = new Set(manifest.host_permissions.map((p) => new URL(p.replace("/*", "/")).host));
  const used = new Set();
  for (const file of SHIPPED) {
    const source = await read(file);
    for (const match of source.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      const host = match[1].toLowerCase();
      if (host === "www.finnhub.io" || host === "github.com" || host === "www.w3.org" || host === "www.youtube.com") continue;
      used.add(host);
    }
  }
  assert.deepEqual([...used].sort(), [...declared].sort());
});

test("no http:// fetches, no externally_connectable, no broad permissions", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.equal(manifest.externally_connectable, undefined);
  assert.deepEqual(manifest.permissions.sort(), ["alarms", "storage"]);
  for (const file of SHIPPED) {
    assert.doesNotMatch(await read(file), /fetch\(\s*["'`]http:/, file);
  }
});

test("console output never interpolates symbols, keys, or URLs", async () => {
  for (const file of ["background.js", "priceProviders.js"]) {
    const source = await read(file);
    for (const line of source.split("\n").filter((l) => /console\.(log|warn|error|info)/.test(l))) {
      assert.doesNotMatch(line, /\$\{(symbol|url|apiKey|pair|s)\}|, url\b|apiKey/, `${file}: ${line.trim()}`);
    }
  }
});
