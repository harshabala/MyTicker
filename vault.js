// Versioned, dependency-free encryption primitives for the Finnhub key vault.
export const VAULT_VERSION = 1;
export const VAULT_ITERATIONS = 310000;

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

async function importVaultKeyMaterial(material) {
  return crypto.subtle.importKey("raw", decodeBase64(material), { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}

export async function createVaultRecord(secret, unlockCode) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(unlockCode, salt, VAULT_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(String(secret)));
  return { version: VAULT_VERSION, iterations: VAULT_ITERATIONS, salt: encodeBase64(salt), iv: encodeBase64(iv), ciphertext: encodeBase64(new Uint8Array(ciphertext)) };
}

export async function decryptVaultRecord(record, unlockCode) {
  if (!record || record.version !== VAULT_VERSION || record.iterations !== VAULT_ITERATIONS) throw new Error("Unsupported vault record");
  const salt = decodeBase64(record.salt);
  const iv = decodeBase64(record.iv);
  const key = await deriveKey(unlockCode, salt, record.iterations);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, decodeBase64(record.ciphertext));
  return decoder.decode(plaintext);
}

// This is AES key material derived from the unlock code, not the API key. It is
// held only in chrome.storage.session by the service worker and vanishes on restart.
export async function deriveVaultKeyMaterial(record, unlockCode) {
  if (!record || record.version !== VAULT_VERSION || record.iterations !== VAULT_ITERATIONS) throw new Error("Unsupported vault record");
  const salt = decodeBase64(record.salt);
  const material = await crypto.subtle.importKey("raw", encoder.encode(String(unlockCode)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: record.iterations }, material, 256);
  return encodeBase64(new Uint8Array(bits));
}

export async function decryptVaultRecordWithMaterial(record, keyMaterial) {
  if (!record || record.version !== VAULT_VERSION || record.iterations !== VAULT_ITERATIONS) throw new Error("Unsupported vault record");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(record.iv) }, await importVaultKeyMaterial(keyMaterial), decodeBase64(record.ciphertext));
  return decoder.decode(plaintext);
}
