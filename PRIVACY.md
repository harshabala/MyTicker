# Privacy Policy for MyTicker

**Last updated:** July 10, 2026

## Overview

MyTicker is a browser extension that displays a live stock and cryptocurrency ticker strip. This privacy policy explains what data the extension accesses and how it is handled.

## Data Collection

**MyTicker does NOT collect, store, or transmit any personal data to any server.**

### Data stored locally

The following data is stored **exclusively in your browser** using Chrome's `chrome.storage` API:

| Data | Storage | Purpose |
|------|---------|---------|
| Portfolio holdings (from CSV) | `chrome.storage.local` | Display your stocks/crypto in the ticker |
| Encrypted Finnhub API-key vault | `chrome.storage.local` | Store the optional US-equity provider key encrypted in this browser |
| Finnhub vault unlock material | `chrome.storage.session` | Keep only the derived unlock material for the current browser session; it is cleared after restart |
| Price history (last 15 min) | `chrome.storage.local` | Calculate 5-minute P&L changes |
| User preferences | `chrome.storage.sync` | Sync settings across your Chrome instances |
| Usage counters (`pts_metrics`) | `chrome.storage.local` | Setup progress, active-day dates, import success counts — never transmitted |

### Network requests

MyTicker network use:

- **Yahoo Finance chart APIs** (`query1.finance.yahoo.com` and `query2.finance.yahoo.com`) — automatic prices for Indian NSE/BSE symbols (`.NS` / `.BO`) after you import holdings. No API key. Only the ticker symbol is requested.
- **Finnhub API** (`finnhub.io/api/v1/quote`) — optional, for US stocks when you add a free Finnhub key. Only symbol + your API key are sent.
- **CoinGecko API** (`api.coingecko.com/api/v3`) — primary crypto price source for supported canonical assets; only the public crypto ID is requested.
- **Binance public API** (`data-api.binance.vision/api/v3`) — fallback for mapped liquid crypto pairs when CoinGecko has no quote; no API key is sent.
- Portfolio holdings, quantities, and keys are never uploaded to MyTicker servers (there are none).

The optional Finnhub key is encrypted locally before it is stored. You choose the unlock code; MyTicker keeps only derived unlock material for the active browser session, so you must unlock the vault again after a browser restart. The unlock code and decrypted API key are not stored.

### Data NOT collected

- ❌ No browsing history
- ❌ No personal information
- ❌ No analytics or telemetry
- ❌ No portfolio telemetry (no holdings, quantities, values, or P&L are sent for measurement)
- ❌ No cookies or tracking
- ❌ No data shared with third parties

## Permissions

| Permission | Why it's needed |
|------------|----------------|
| `storage` | Save your holdings, settings, and price cache locally |
| `alarms` | Schedule periodic price polling in the background |
| `host_permissions` (finnhub.io) | Fetch real-time price quotes |
| `content_scripts` (all URLs) | Run the ticker tape on all pages at document start so it can reserve space before page content is displayed; the extension does not read page content |
| `web_accessible_resources` (`ticker.css`, all URLs) | Let the tape's closed Shadow DOM load its own stylesheet on the pages where it appears |

## Data Deletion

All data is stored locally in your browser. To delete all MyTicker data:

1. Go to `chrome://extensions`
2. Find MyTicker and click **Remove**
3. All stored data is automatically deleted

Alternatively, you can clear extension data via Chrome Settings → Privacy → Clear browsing data → Site data.

## Contact

If you have questions about this privacy policy, please open an issue on [GitHub](https://github.com/harshabala/myticker-extension/issues).
