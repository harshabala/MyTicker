# MyTicker Extension Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a versioned, encrypted Finnhub-key vault and close every Extension Excellence audit finding without disturbing the live tape.

**Architecture:** A new dependency-free `vault.js` provides WebCrypto encryption. The service worker is the only component that decrypts an unlocked API key. Settings owns the user interaction, while shared settings migration and content-script resilience are independently testable.

**Tech Stack:** Manifest V3, Chrome storage local/session/sync, WebCrypto PBKDF2 + AES-GCM, Node fixture tests.

---

### Task 1: Version settings and secure extension boundaries

**Files:**
- Modify: `shared.js`, `background.js`, `contentScript.js`
- Modify: `test_fixtures/test_shared.mjs`, `test_fixtures/test_content_script_classic.mjs`

- [ ] Add a failing fresh/upgraded schema test for `migrateSettings`, including removal of legacy synced API-key fields; run `node test_fixtures/test_shared.mjs` and confirm it fails.
- [ ] Add `schemaVersion`, a pure `migrateSettings` normalizer, and install/startup migration writes; rerun the fixture and confirm it passes.
- [ ] Add failing harness assertions that untrusted messages cannot start a poll and an invalidated content context performs no further Chrome calls; run the targeted fixture and confirm it fails.
- [ ] Implement typed `{ type, payload }` routing with sender/context validation, context-invalidated teardown, and queued/debounced tape reconciliation; rerun both fixtures and confirm they pass.
- [ ] Run all existing fixture tests and commit the task.

### Task 2: Encrypt the Finnhub key and add the settings flow

**Files:**
- Create: `vault.js`, `test_fixtures/test_vault.mjs`
- Modify: `background.js`, `options.js`, `options.html`, `test_fixtures/test_price_providers.mjs`, `test_fixtures/test_ui_copy.mjs`

- [ ] Write failing vault tests for encrypt/decrypt, wrong code rejection, and record metadata; run `node test_fixtures/test_vault.mjs` and confirm it fails.
- [ ] Implement base64 encoding and `createVaultRecord`/`decryptVaultRecord` using PBKDF2-SHA-256 at 310,000 iterations and AES-GCM-256; rerun and confirm it passes.
- [ ] Add failing service-worker/options tests for migration of `pts_price_api_key`, locked quote degradation, unlocked session access, and non-secret vault status; run targeted fixtures and confirm they fail.
- [ ] Add vault message handlers and session-only derived key storage; migrate plaintext only after encrypted write success; remove plaintext; make polling use decrypted keys only.
- [ ] Add the create/unlock/lock/replace-key settings UI and exact state copy; rerun targeted fixtures, full fixtures, and commit the task.

### Task 3: Close privacy, permission, and release-gate evidence

**Files:**
- Modify: `PRIVACY.md`, `README.md`, `STORE_LISTING.md`, `test_fixtures/test_ui_copy.mjs`
- Modify if required by audit: `manifest.json`, `popup.js`, `options.js`

- [ ] Add a failing static audit assertion for documented Yahoo, CoinGecko, Binance, Finnhub, all-page tape access, encrypted key storage, and no unsafe dynamic code; run `node test_fixtures/test_ui_copy.mjs` and confirm it fails.
- [ ] Update the privacy/release copy and any needed empty/error states; ensure static HTML insertion remains constant-only or replace it with DOM API construction.
- [ ] Run `node --check` for all JS files, parse the manifest, run all fixtures, and `git diff --check origin/main...HEAD`; commit the task.

### Task 4: Final release review and manual package validation

**Files:**
- Verify only

- [ ] Run the complete fixture and syntax suite from Task 3.
- [ ] Review the manifest permission-to-feature mapping, CSP, message senders, vault storage, and all `innerHTML` callsites.
- [ ] Sync the verified worktree to `~/Desktop/MyTicker-dev` and compare file hashes.
- [ ] Reload the unpacked extension and manually verify fresh-profile, upgraded-profile, browser-restart locked-vault, tape enable/disable, and ChatGPT full-dialog behaviour.
