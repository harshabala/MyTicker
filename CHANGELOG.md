# Changelog

All notable changes to MyTicker. Versions follow `manifest.json`.

## Unreleased: production hardening

### Fixed
- **Indian day P&L was a five-day change.** Yahoo's `chartPreviousClose` is the close before the first bar of the 5-day chart. Day P&L now uses the previous session's daily close (split-adjusted).
- A Finnhub previous close of `0` no longer turns a whole position's value into day P&L. Missing previous closes show `—` instead of a 15-minute change labelled "day".
- INR and USD P&L are never added together. Mixed portfolios show per-holding P&L in native currency and a "mixed currencies" total.
- Generic CSVs without a currency column no longer label US stocks as INR.
- Prices that missed the latest poll (partial outage, rate limit, locked Finnhub key) are marked stale, and the popup no longer says **Live** for old or closed-market prices. New **Closed** label outside trading hours.
- A corrupted or mismatched Finnhub session key no longer stops every provider; the key reads as locked and other prices continue.
- Clearing or re-importing holdings during a refresh no longer brings the old positions back.
- `-₹0.00` / `-0.00%` rounding artefacts.

### Security
- Finnhub vault: PBKDF2 raised from 310,000 to 600,000 iterations; stricter record validation; old vaults are re-encrypted on next unlock. A legacy plaintext key now prompts for an unlock code.
- `chrome.storage.session` access pinned to trusted extension contexts.
- CSV import: RFC 4180 quoting, size/row/column/cell/holding caps, prototype-pollution-safe rows, strict number parsing (Indian digit grouping supported; negative, NaN, and infinite quantities rejected), ticker-shaped symbols only.
- Removed the unused `query2.finance.yahoo.com` host permission; a test now keeps `host_permissions` equal to the hosts the code contacts.
- Console logs no longer include symbols.

### Reliability
- 12-second timeout on every provider request (CoinGecko and Binance had none).
- HTTP 429/5xx pause the provider with exponential backoff (1 to 30 minutes, honouring `Retry-After`), persisted across service-worker restarts.
- Malformed JSON and HTTP errors yield partial results, never a failed refresh.

### Developer
- `npm test`, `npm run check`, and a GitHub Actions workflow. No npm dependencies (removed unused `@phosphor-icons/react`).
