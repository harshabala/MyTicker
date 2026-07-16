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
| Finnhub API key | `chrome.storage.local` | Authenticate with the price data provider |
| Price history (last 15 min) | `chrome.storage.local` | Calculate 5-minute P&L changes |
| User preferences | `chrome.storage.sync` | Sync settings across your Chrome instances |
| Usage counters (`pts_metrics`) | `chrome.storage.local` | Setup progress, active-day dates, import success counts — never transmitted |

### Network requests

MyTicker network use:

- **Yahoo Finance chart API** (`query1.finance.yahoo.com`) — automatic prices for Indian NSE/BSE symbols (`.NS` / `.BO`) after you import holdings. No API key. Only the ticker symbol is requested.
- **Finnhub API** (`https://finnhub.io/api/v1/quote`) — optional, for US stocks when you add a free Finnhub key. Only symbol + your API key are sent.
- **CoinGecko API** — primary crypto price source for supported canonical assets; only the public crypto ID is requested.
- **Binance public API** — fallback for mapped liquid crypto pairs when CoinGecko has no quote; no API key is sent.
- Portfolio holdings, quantities, and keys are never uploaded to MyTicker servers (there are none).

### Data NOT collected

- ❌ No browsing history
- ❌ No personal information
- ❌ No analytics or telemetry
- ❌ No cookies or tracking
- ❌ No data shared with third parties

## Permissions

| Permission | Why it's needed |
|------------|----------------|
| `storage` | Save your holdings, settings, and price cache locally |
| `alarms` | Schedule periodic price polling in the background |
| `host_permissions` (finnhub.io) | Fetch real-time price quotes |
| `content_scripts` (all URLs) | Display the ticker strip on every webpage |

## Data Deletion

All data is stored locally in your browser. To delete all MyTicker data:

1. Go to `chrome://extensions`
2. Find MyTicker and click **Remove**
3. All stored data is automatically deleted

Alternatively, you can clear extension data via Chrome Settings → Privacy → Clear browsing data → Site data.

## Contact

If you have questions about this privacy policy, please open an issue on [GitHub](https://github.com/harshabala/myticker-extension/issues).
