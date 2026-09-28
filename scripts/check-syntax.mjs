// Static checks with no dependencies: syntax-check every shipped script and
// verify that every file the manifest references exists.
// Run with: npm run check
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Content scripts are classic scripts; everything else is an ES module.
const CLASSIC = ["contentShared.js", "contentScript.js"];
const MODULES = [
  "background.js", "shared.js", "popup.js", "options.js", "onboarding.js",
  "csvParser.js", "priceProviders.js", "metrics.js", "vault.js"
];

let failures = 0;
function fail(message) {
  failures++;
  console.error(`FAIL ${message}`);
}

function check(file, inputType) {
  const source = readFileSync(join(root, file));
  const result = spawnSync(process.execPath, [`--input-type=${inputType}`, "--check"], { input: source });
  if (result.status === 0) console.log(`OK   ${file} (${inputType})`);
  else fail(`${file}\n${String(result.stderr)}`);
}

for (const file of CLASSIC) check(file, "commonjs");
for (const file of MODULES) check(file, "module");

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  console.log("OK   manifest.json parses");
} catch (error) {
  fail(`manifest.json does not parse: ${error.message}`);
}

if (manifest) {
  const referenced = new Set([
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
  ].filter(Boolean));
  for (const file of referenced) {
    if (existsSync(join(root, file))) console.log(`OK   ${file} exists`);
    else fail(`manifest references missing file ${file}`);
  }
}

if (failures) {
  console.error(`\n${failures} static check(s) failed`);
  process.exit(1);
}
console.log("\nAll static checks passed");
