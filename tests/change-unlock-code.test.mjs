import { test } from "node:test";
import assert from "node:assert/strict";
import { createVaultRecord, decryptVaultRecord, decryptVaultRecordWithMaterial, LEGACY_VAULT_ITERATIONS } from "../vault.js";
import { createChromeFake, loadBackground, send } from "./helpers.mjs";

async function withVault(tag, code = "123456") {
  const record = await createVaultRecord("fh-secret", code);
  const fake = createChromeFake({ sync: { pts_settings: { enabled: false } }, local: { pts_finnhub_vault: record } });
  await loadBackground(fake, tag);
  return { fake, record };
}
const change = (fake, currentCode, newCode) => send(fake.listeners, { type: "vault-change-code", payload: { currentCode, newCode } });

test("changing the code re-encrypts the key: new code works, old code does not", async () => {
  const { fake, record } = await withVault("change-ok");
  const response = await change(fake, "123456", "a much longer pass phrase");
  assert.deepEqual(response, { ok: true, status: { configured: true, unlocked: true, legacy: false } });
  const next = fake.local.get("pts_finnhub_vault");
  assert.notEqual(next.ciphertext, record.ciphertext);
  assert.notEqual(next.salt, record.salt);
  assert.equal(await decryptVaultRecord(next, "a much longer pass phrase"), "fh-secret");
  await assert.rejects(decryptVaultRecord(next, "123456"));
  assert.equal(await decryptVaultRecordWithMaterial(next, fake.session.get("pts_finnhub_vault_aes_material")), "fh-secret", "stays unlocked with the new code");
  await send(fake.listeners, { type: "vault-lock", payload: {} });
  assert.equal((await send(fake.listeners, { type: "vault-unlock", payload: { unlockCode: "123456" } })).ok, false);
  assert.equal((await send(fake.listeners, { type: "vault-unlock", payload: { unlockCode: "a much longer pass phrase" } })).ok, true);
});

test("a wrong current code changes nothing", async () => {
  const { fake, record } = await withVault("change-wrong");
  assert.deepEqual(await change(fake, "654321", "new code 123"), { ok: false, error: "Vault operation failed" });
  assert.deepEqual(fake.local.get("pts_finnhub_vault"), record);
  assert.equal(fake.session.size, 0);
});

test("an invalid new code changes nothing", async () => {
  const { fake, record } = await withVault("change-invalid");
  for (const bad of ["12345", "x".repeat(129), 42, undefined]) {
    assert.equal((await change(fake, "123456", bad)).ok, false, String(bad));
  }
  assert.equal((await change(fake, "", "new code 123")).ok, false, "current code required");
  assert.deepEqual(fake.local.get("pts_finnhub_vault"), record);
});

test("a storage failure while writing leaves the old vault intact and usable", async () => {
  const { fake, record } = await withVault("change-storage");
  fake.hooks.beforeSet = async (values) => {
    if ("pts_finnhub_vault" in values) throw new Error("QUOTA_BYTES quota exceeded");
  };
  assert.equal((await change(fake, "123456", "new code 123")).ok, false);
  fake.hooks.beforeSet = null;
  assert.deepEqual(fake.local.get("pts_finnhub_vault"), record);
  assert.equal(await decryptVaultRecord(fake.local.get("pts_finnhub_vault"), "123456"), "fh-secret");
});

test("a vault replaced while re-encrypting is not overwritten", async () => {
  const { fake } = await withVault("change-race");
  const replacement = await createVaultRecord("other-key", "999999");
  let reads = 0;
  const originalGet = fake.chrome.storage.local.get;
  fake.chrome.storage.local.get = async (keys) => {
    const result = await originalGet(keys);
    if (Array.isArray(keys) && keys.length === 1 && keys[0] === "pts_finnhub_vault" && ++reads === 2) {
      fake.local.set("pts_finnhub_vault", replacement); // concurrent Replace key
      return { pts_finnhub_vault: replacement };
    }
    return result;
  };
  assert.equal((await change(fake, "123456", "new code 123")).ok, false);
  assert.deepEqual(fake.local.get("pts_finnhub_vault"), replacement);
});

test("no vault, legacy plaintext key, and untrusted senders are refused", async () => {
  const fake = createChromeFake({ sync: { pts_settings: { enabled: false } }, local: { pts_price_api_key: "plain" } });
  await loadBackground(fake, "change-legacy");
  assert.equal((await change(fake, "123456", "new code 123")).ok, false);
  assert.equal(fake.local.get("pts_price_api_key"), "plain");
  const { fake: vaulted, record } = await withVault("change-untrusted");
  const response = await send(vaulted.listeners, { type: "vault-change-code", payload: { currentCode: "123456", newCode: "new code 123" } }, { id: "test-extension-id", tab: { id: 1 }, frameId: 0, url: "https://evil.example/" });
  assert.equal(response, undefined);
  assert.deepEqual(vaulted.local.get("pts_finnhub_vault"), record);
});

test("changing the code on an old 310k vault also upgrades it", async () => {
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode("123456"), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: LEGACY_VAULT_ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("fh-secret"));
  const fake = createChromeFake({ sync: { pts_settings: { enabled: false } }, local: { pts_finnhub_vault: { version: 1, iterations: LEGACY_VAULT_ITERATIONS, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) } } });
  await loadBackground(fake, "change-legacy-kdf");
  assert.equal((await change(fake, "123456", "new code 123")).ok, true);
  assert.equal(fake.local.get("pts_finnhub_vault").iterations, 600000);
});

test("Options offers a change-code form with current, new, and confirm fields", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../options.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../options.js", import.meta.url), "utf8");
  for (const id of ["vaultCurrentCode", "vaultNewCode", "vaultNewCodeConfirm", "vaultNewCodeStrength", "changeUnlockCodeButton"]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /id="vaultCurrentCode"[^>]*autocomplete="current-password"/);
  assert.match(js, /sendVaultMessage\("vault-change-code", \{ currentCode, newCode \}\)/);
});
