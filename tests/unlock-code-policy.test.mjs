import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidUnlockCode, assessUnlockCodeStrength, createVaultRecord, decryptVaultRecord,
  UNLOCK_CODE_MIN_LENGTH, UNLOCK_CODE_MAX_LENGTH
} from "../vault.js";
import { createChromeFake, loadBackground, send } from "./helpers.mjs";

test("the 6-character minimum is unchanged and long passphrases up to 128 characters are allowed", () => {
  assert.equal(UNLOCK_CODE_MIN_LENGTH, 6);
  assert.equal(UNLOCK_CODE_MAX_LENGTH, 128);
  assert.equal(isValidUnlockCode("123456"), true, "existing 6-digit codes stay valid");
  assert.equal(isValidUnlockCode("12345"), false);
  assert.equal(isValidUnlockCode("correct horse battery staple"), true, "spaces allowed");
  assert.equal(isValidUnlockCode("  pad  "), true, "leading/trailing spaces count, no trimming");
  assert.equal(isValidUnlockCode("pässwörd ✓ 秘密 🔐🔐"), true, "any characters");
  assert.equal(isValidUnlockCode("x".repeat(128)), true);
  assert.equal(isValidUnlockCode("x".repeat(129)), false);
  assert.equal(isValidUnlockCode("🔐".repeat(128)), true, "max counts characters, not UTF-16 units");
  for (const junk of [null, undefined, 123456, {}, ["123456"]]) assert.equal(isValidUnlockCode(junk), false);
});

test("strength is advisory: weak codes are still valid", () => {
  const level = (code) => assessUnlockCodeStrength(code).level;
  assert.equal(level(""), "empty");
  assert.equal(level("12345"), "invalid");
  assert.equal(level("x".repeat(129)), "invalid");
  assert.equal(level("123456"), "weak");
  assert.equal(level("aaaaaaaaaa"), "weak");
  assert.equal(level("12345678901"), "weak", "all digits under 12 is weak");
  assert.equal(level("tiger42!x"), "fair");
  assert.equal(level("correct horse battery"), "strong");
  assert.equal(level("Xk9#mQ2$vL7p"), "strong");
  assert.equal(level("aaaaaaaaaaaaaaaa"), "weak", "length alone is not strength");
  assert.ok(isValidUnlockCode("123456"), "weak does not mean rejected");
  assert.match(assessUnlockCodeStrength("123456").message, /12\+ characters/);
});

test("a 128-character passphrase with spaces and emoji round-trips through the vault", async () => {
  const code = `${"correct horse 🔐 ".repeat(7)}staple `;
  assert.ok(isValidUnlockCode(code) && [...code].length <= 128 && code.endsWith(" "));
  const record = await createVaultRecord("fh-key", code);
  assert.equal(await decryptVaultRecord(record, code), "fh-key");
  await assert.rejects(decryptVaultRecord(record, code.trim()), "exact code required; no silent trimming");
});

test("the worker enforces the same bounds on create and unlock", async () => {
  const fake = createChromeFake({ sync: { pts_settings: { enabled: false } } });
  await loadBackground(fake, "policy");
  const tooLong = "x".repeat(129);
  assert.equal((await send(fake.listeners, { type: "vault-create", payload: { apiKey: "k", unlockCode: tooLong } })).ok, false);
  assert.equal((await send(fake.listeners, { type: "vault-create", payload: { apiKey: "k", unlockCode: 1234567 } })).ok, false);
  assert.equal(fake.local.has("pts_finnhub_vault"), false);
  const passphrase = "my long pass phrase with spaces";
  assert.equal((await send(fake.listeners, { type: "vault-create", payload: { apiKey: "k", unlockCode: passphrase } })).ok, true);
  await send(fake.listeners, { type: "vault-lock", payload: {} });
  assert.equal((await send(fake.listeners, { type: "vault-unlock", payload: { unlockCode: tooLong } })).ok, false);
  assert.equal((await send(fake.listeners, { type: "vault-unlock", payload: { unlockCode: passphrase } })).ok, true);
});

test("Options shows an advisory strength hint and allows 128-character codes", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../options.html", import.meta.url), "utf8");
  assert.match(html, /id="vaultUnlockCode"[^>]*maxlength="128"[^>]*aria-describedby="vaultCodeStrength"/);
  assert.match(html, /id="vaultCodeStrength"[^>]*aria-live="polite"/);
});
