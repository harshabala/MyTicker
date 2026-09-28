// Versioned, dependency-free encryption primitives for the Finnhub key vault.
export const VAULT_VERSION = 1;
// OWASP (2023) guidance for PBKDF2-HMAC-SHA256. Records written by v0.5.0 and
// earlier used 310,000; they still decrypt and are re-wrapped on next unlock.
export const VAULT_ITERATIONS = 600000;
export const LEGACY_VAULT_ITERATIONS = 310000;
const SUPPORTED_ITERATIONS = new Set([VAULT_ITERATIONS, LEGACY_VAULT_ITERATIONS]);
const SALT_BYTES = 16;
const IV_BYTES = 12;

// Unlock-code policy. The 6-character floor is unchanged so every existing
// vault keeps working; anything longer (spaces, any characters) is allowed up
// to a sane cap. Strength is advice only and never blocks the user.
export const UNLOCK_CODE_MIN_LENGTH = 6;
export const UNLOCK_CODE_MAX_LENGTH = 128;
export const UNLOCK_CODE_RECOMMENDED_LENGTH = 12;

/** Length in characters (code points), so emoji and non-Latin text count once. */
function codeLength(code) {
  return [...String(code ?? "")].length;
}

/**
 * True when a code may be used to create or re-encrypt a vault. Codes are
 * used exactly as typed (no trimming): leading and trailing spaces count.
 */
export function isValidUnlockCode(code) {
  if (typeof code !== "string") return false;
  // The minimum is checked in UTF-16 units, as every release before this did.
  return code.length >= UNLOCK_CODE_MIN_LENGTH && codeLength(code) <= UNLOCK_CODE_MAX_LENGTH;
}

/**
 * Advisory strength for the Options hint: "invalid" | "weak" | "fair" | "strong".
 * 12+ characters (or a multi-word passphrase of that length) is strong;
 * short, all-digit, or single-character-repeated codes are weak.
 */
export function assessUnlockCodeStrength(code) {
  const text = typeof code === "string" ? code : "";
  const length = codeLength(text);
  if (!length) return { level: "empty", message: "Use 12+ characters, or a few random words with spaces." };
  if (!isValidUnlockCode(text)) {
    return length > UNLOCK_CODE_MAX_LENGTH
      ? { level: "invalid", message: `Too long: ${UNLOCK_CODE_MAX_LENGTH} characters maximum.` }
      : { level: "invalid", message: `At least ${UNLOCK_CODE_MIN_LENGTH} characters.` };
  }
  if (length >= UNLOCK_CODE_RECOMMENDED_LENGTH && new Set(text).size > 3) {
    return { level: "strong", message: "Strong. Nobody can use your key without this code." };
  }
  if (length < 8 || /^\d+$/.test(text) || new Set(text).size <= 2) {
    return { level: "weak", message: "Works, but easy to guess. 12+ characters or a few random words is much safer." };
  }
  return { level: "fair", message: "OK. 12+ characters or a passphrase makes it much harder to guess." };
}

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
