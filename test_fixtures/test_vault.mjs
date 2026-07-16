// Vault crypto regression fixtures. Run with: node test_fixtures/test_vault.mjs
import { createVaultRecord, decryptVaultRecord, VAULT_ITERATIONS } from "../vault.js";

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`  ✅ ${message}`); }
  else { failed++; console.error(`  ❌ ${message}`); }
}

console.log("\n🔐 Finnhub vault");
const record = await createVaultRecord("finnhub-secret-token", "123456");
assert(record.version === 1 && record.iterations === 310000, "stores versioned PBKDF2 metadata");
assert(typeof record.salt === "string" && typeof record.iv === "string" && typeof record.ciphertext === "string", "stores only encoded encrypted fields");
assert(!JSON.stringify(record).includes("finnhub-secret-token") && VAULT_ITERATIONS === 310000, "never stores the plaintext secret");
assert(await decryptVaultRecord(record, "123456") === "finnhub-secret-token", "decrypts with the correct unlock code");
let wrongCodeRejected = false;
try { await decryptVaultRecord(record, "000000"); } catch { wrongCodeRejected = true; }
assert(wrongCodeRejected, "rejects a wrong unlock code");
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
