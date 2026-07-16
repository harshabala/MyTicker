// Focused contracts for reviewed extension-hardening boundaries.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [optionsSource, backgroundSource] = await Promise.all([
  readFile(new URL("../options.js", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8")
]);

assert.match(
  optionsSource,
  /chrome\.runtime\.sendMessage\(\{\s*type:\s*["']poll-now["'],\s*payload:\s*\{\}\s*\}/,
  "immediate option refresh uses the typed poll message envelope"
);
assert.match(
  backgroundSource,
  /sender\?\.tab\s*&&\s*sender\?\.frameId\s*===\s*0/,
  "content lifecycle accepts only a top-level tab content-script sender"
);
assert.doesNotMatch(
  backgroundSource,
  /sendResponse\(\{ ok: false, error: String\(err\) \}\)/,
  "poll failures never expose raw error text to extension callers"
);
assert.match(
  backgroundSource,
  /let settingsMigrationInFlight/,
  "settings migration has a shared in-flight serialization guard"
);

console.log("hardening regression contracts: passed");
