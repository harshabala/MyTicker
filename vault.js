// Versioned, dependency-free encryption primitives for the Finnhub key vault.
export const VAULT_VERSION = 1;
// OWASP (2023) guidance for PBKDF2-HMAC-SHA256. Records written by v0.5.0 and
// earlier used 310,000; they still decrypt and are re-wrapped on next unlock.
export const VAULT_ITERATIONS = 600000;
export const LEGACY_VAULT_ITERATIONS = 310000;
const SUPPORTED_ITERATIONS = new Set([VAULT_ITERATIONS, LEGACY_VAULT_ITERATIONS]);
const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(code, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(String(code)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Reject records we did not write: wrong version, unknown KDF cost, bad sizes. */
export function assertSupportedVaultRecord(record) {
  if (!record || typeof record !== "object" || record.version !== VAULT_VERSION || !SUPPORTED_ITERATIONS.has(record.iterations)) {
    throw new Error("Unsupported vault record");
  }
  if (decodeBase64(record.salt).length !== SALT_BYTES || decodeBase64(record.iv).length !== IV_BYTES || !record.ciphertext) {
    throw new Error("Unsupported vault record");
  }
}

/** True when a record should be re-encrypted with the current KDF cost. */
export function vaultNeedsUpgrade(record) {
  return !!record && record.iterations !== VAULT_ITERATIONS;
}

async function importVaultKeyMaterial(material) {
  return crypto.subtle.importKey("raw", decodeBase64(material), { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}

export async function createVaultRecord(secret, unlockCode) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(unlockCode, salt, VAULT_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(String(secret)));
  return { version: VAULT_VERSION, iterations: VAULT_ITERATIONS, salt: encodeBase64(salt), iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext)) };
}

export async function decryptVaultRecord(record, unlockCode) {
  assertSupportedVaultRecord(record);
  const salt = decodeBase64(record.salt);
  const iv = decodeBase64(record.iv);
  const key = await deriveKey(unlockCode, salt, record.iterations);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, decodeBase64(record.ciphertext));
  return decoder.decode(plaintext);
}

// This is AES key material derived from the unlock code, not the API key. It is
// held only in chrome.storage.session by the service worker and vanishes on restart.
export async function deriveVaultKeyMaterial(record, unlockCode) {
  assertSupportedVaultRecord(record);
  const salt = decodeBase64(record.salt);
  const material = await crypto.subtle.importKey("raw", encoder.encode(String(unlockCode)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: record.iterations }, material, 256);
  return encodeBase64(new Uint8Array(bits));
}

export async function decryptVaultRecordWithMaterial(record, keyMaterial) {
  assertSupportedVaultRecord(record);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(record.iv) }, await importVaultKeyMaterial(keyMaterial), decodeBase64(record.ciphertext));
  return decoder.decode(plaintext);
}
