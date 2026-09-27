import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createVaultRecord, decryptVaultRecord, deriveVaultKeyMaterial, decryptVaultRecordWithMaterial,
  assertSupportedVaultRecord, vaultNeedsUpgrade, VAULT_ITERATIONS, LEGACY_VAULT_ITERATIONS
} from "../vault.js";
import { createChromeFake, loadBackground, send } from "./helpers.mjs";

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

// Build a record exactly as v0.5.0 did (310k iterations) to prove migration.
async function legacyRecord(secret, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: LEGACY_VAULT_ITERATIONS }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret));
  return { version: 1, iterations: LEGACY_VAULT_ITERATIONS, salt: b64(salt), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}

test("new records use AES-GCM with a fresh random salt and IV and the current KDF cost", async () => {
  const a = await createVaultRecord("secret", "123456");
  const b = await createVaultRecord("secret", "123456");
  assert.equal(a.iterations, VAULT_ITERATIONS);
  assert.ok(VAULT_ITERATIONS >= 600000);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(Buffer.from(a.salt, "base64").length, 16);
  assert.equal(Buffer.from(a.iv, "base64").length, 12);
  assert.equal(await decryptVaultRecord(a, "123456"), "secret");
});

test("legacy 310k records still decrypt and are flagged for upgrade", async () => {
  const record = await legacyRecord("legacy-secret", "abcdef");
  assert.equal(await decryptVaultRecord(record, "abcdef"), "legacy-secret");
  assert.equal(vaultNeedsUpgrade(record), true);
  assert.equal(vaultNeedsUpgrade(await createVaultRecord("x", "abcdef")), false);
});

test("tampered ciphertext and malformed records are rejected", async () => {
  const record = await createVaultRecord("secret", "123456");
  const bytes = Buffer.from(record.ciphertext, "base64");
  bytes[0] ^= 1;
  await assert.rejects(decryptVaultRecord({ ...record, ciphertext: bytes.toString("base64") }, "123456"));
  for (const bad of [null, {}, { ...record, version: 2 }, { ...record, iterations: 1000 }, { ...record, iv: b64(new Uint8Array(8)) }, { ...record, salt: "" }]) {
    assert.throws(() => assertSupportedVaultRecord(bad), /Unsupported vault record/);
  }
});

test("unlocking a legacy 310k vault re-wraps it at the current cost", async () => {
  const fake = createChromeFake({ sync: { pts_settings: { enabled: false } }, local: { pts_finnhub_vault: await legacyRecord("fh-key", "abcdef") } });
  await loadBackground(fake, "vault-upgrade");
  const response = await send(fake.listeners, { type: "vault-unlock", payload: { unlockCode: "abcdef" } });
  assert.equal(response.ok, true);
  const upgraded = fake.local.get("pts_finnhub_vault");
  assert.equal(upgraded.iterations, VAULT_ITERATIONS);
  assert.equal(await decryptVaultRecordWithMaterial(upgraded, fake.session.get("pts_finnhub_vault_aes_material")), "fh-key");
});

test("a wrong unlock code stores nothing in the session", async () => {
  const fake = createChromeFake({ sync: { pts_settings: { enabled: false } }, local: { pts_finnhub_vault: await createVaultRecord("fh-key", "123456") } });
  await loadBackground(fake, "vault-wrong");
  const response = await send(fake.listeners, { type: "vault-unlock", payload: { unlockCode: "654321" } });
  assert.deepEqual(response, { ok: false, error: "Vault operation failed" });
  assert.equal(fake.session.size, 0);
});

test("legacy plaintext key reports legacy status so the UI can prompt for a code", async () => {
  const fake = createChromeFake({ sync: { pts_settings: { enabled: false } }, local: { pts_price_api_key: "plain" } });
  await loadBackground(fake, "vault-legacy-status");
  const response = await send(fake.listeners, { type: "vault-status", payload: {} });
  assert.deepEqual(response, { ok: true, status: { configured: true, unlocked: false, legacy: true } });
});

test("mismatched session material fails safe: polling continues and the vault reads as locked", async () => {
  const record = await createVaultRecord("fh-key", "123456");
  const otherMaterial = await deriveVaultKeyMaterial(await createVaultRecord("other", "999999"), "999999");
  const fake = createChromeFake({
    sync: { pts_settings: { enabled: true } },
    local: { pts_finnhub_vault: record, pts_holdings: [{ symbol: "TCS.NS", quantity: 1, currency: "INR" }] },
    session: { pts_finnhub_vault_aes_material: otherMaterial }
  });
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 100, previousClose: 90, currency: "INR" } }] } }), { status: 200 });
  };
  await loadBackground(fake, "vault-mismatch");
  const response = await send(fake.listeners, { type: "poll-now", payload: {} });
  assert.deepEqual(response, { ok: true });
  assert.equal(fake.session.has("pts_finnhub_vault_aes_material"), false, "stale material dropped");
  assert.ok(urls.some((u) => u.includes("finance.yahoo.com")), "Yahoo still polled");
  assert.ok(!urls.some((u) => u.includes("token=")), "no Finnhub request without a key");
  assert.equal(fake.local.get("pts_positions_state").positions[0].lastPrice, 100);
});
