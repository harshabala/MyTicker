# MyTicker Extension Hardening Design

## Goal

Make the MV3 extension safe to ship under the Extension Excellence gate while preserving the live tape and existing market-data behaviour.

## Approved security model

MyTicker encrypts the optional Finnhub API key at rest. The user creates a six-or-more-character unlock code once. The encrypted key, random salt, IV, algorithm version, and PBKDF2 iteration count live in `chrome.storage.local`; plaintext is deleted only after the encrypted record is safely written. Entering the code unlocks the key for the current browser session by storing only derived vault material in `chrome.storage.session`. A browser restart requires one new unlock, but no routine lock/unlock interaction is imposed while the browser remains open.

If the vault is locked, US quotes fail closed with clear UI copy. India and crypto providers continue normally. Existing plaintext local keys are migrated from the settings page; the key is never prefilled or rendered after this release.

## Architecture

- `vault.js` owns versioned WebCrypto primitives: PBKDF2-SHA-256 (310,000 iterations) derives an AES-GCM-256 key; helpers encode binary values as base64 records and never log secrets.
- `background.js` owns vault writes, unlock/lock requests, API-key decryption, schema migration on startup/install, and validated message routing.
- `options.js` is presentation only: it displays vault status, collects the unlock code, and asks the service worker to encrypt/unlock/replace the Finnhub key.
- `shared.js` defines the current settings schema and a pure migration function. Migration preserves supported preferences while removing legacy secret fields from synced settings.
- Content scripts stop cleanly after extension-context invalidation, retain idempotent tape injection, and debounce document reconciliation.

## Trust and messages

All extension messages use `{ type, payload }`. The service worker accepts UI-only operations only from the current extension origin and content lifecycle telemetry only from MyTicker content-script senders. Malformed or untrusted messages receive no privileged action. No message returns a passcode, key, ciphertext, or raw provider error.

## Storage and migration

`schemaVersion` is stored in settings. Fresh settings begin at the current version. Upgraded settings are normalized before use and written back once. The legacy `pts_price_api_key` remains readable solely to encrypt it during the explicit user migration; it is removed after success. A vault marker lets diagnostics distinguish "not configured", "locked", and "unlocked" without revealing secrets.

## UX and privacy

The Data & diagnostics settings surface contains a compact "Protect your Finnhub key" section with explicit status and action labels: Create unlock code, Unlock key, Lock key, and Replace key. Copy says that the unlock is needed after a browser restart. Settings continue to show explicit loading, empty, and unavailable states. Privacy documentation states every remote provider host, explains that the tape runs on all pages to reserve space before content, and says the API key is locally encrypted.

## Verification

Automated tests cover fresh and upgraded settings migration, vault encrypt/decrypt/wrong-code behaviour, trusted message routing, locked-vault degradation, and content-script invalidation. The final release gate audits manifest permissions, CSP, remote-code patterns, `innerHTML` safety, service-worker restart state, accessibility/copy, and fresh/upgraded-profile scenarios. Manual checks reload the unpacked extension and verify normal-page and ChatGPT full-dialog tape reservation.
