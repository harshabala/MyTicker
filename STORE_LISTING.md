# Chrome Web Store Listing

## Short Description (132 chars max)
Live stock & crypto ticker strip on every tab. Track portfolio P&L from Zerodha, Groww, Upstox, and more. 100% private.

## Detailed Description

**MyTicker** puts a sleek, live-updating stock ticker strip at the top of every webpage you visit — just like the scrolling tickers on financial news channels, but for YOUR personal portfolio.

### 🎯 What it does

Import your holdings from any Indian or US broker (Zerodha, Groww, Upstox, or any generic CSV), and MyTicker will show you:

• **5-minute P&L** — see how your stocks moved in the last 5 minutes
• **Daily P&L** — track your day's gains and losses at a glance
• **Aggregate portfolio** — total P&L across all holdings
• **Top movers** — your best and worst performers today

The ticker scrolls smoothly across the top of every page. Hover to pause. Click the extension icon for a quick P&L summary.

### 🪙 Crypto Support

Optionally add supported crypto to your ticker (CoinGecko primary, with mapped Binance fallback):
• **Top 5 watchlist** — BTC, ETH, BNB, XRP, SOL (unit price change, qty 1)
• **Manual holdings** — search and select from Bitcoin/BTC, Ethereum/ETH, BNB, XRP, and Solana/SOL; remove selected assets with their chips.

### 🔒 100% Private

Your data NEVER leaves your browser:
• Holdings stored locally in Chrome storage
• Optional Finnhub API key encrypted locally; its derived unlock material lasts only for the current browser session, so you unlock it again after restart
• No analytics, tracking, accounts, or portfolio telemetry

### 🌐 Why MyTicker runs on all pages

The ticker tape starts on all pages before page content so it can reserve its small strip of layout space consistently. It does not read page content. Prices are requested only from Yahoo Finance (`query1.finance.yahoo.com` and `query2.finance.yahoo.com`) for Indian equities, Finnhub (`finnhub.io`) for optional US-equity quotes, CoinGecko (`api.coingecko.com`) for crypto, and mapped Binance fallback (`data-api.binance.vision`) when CoinGecko has no quote.

### ⚡ Premium Design

• Dark glassmorphism popup with P&L at a glance
• Apple-style settings page with drag-and-drop CSV import
• Smooth animations and glow effects
• Keyboard shortcut: Ctrl+Shift+Y (Mac: ⌘+Shift+Y) to toggle

### 📊 Supported Brokers

• Zerodha (holdings export CSV)
• Groww (holdings export CSV)
• Upstox (holdings export CSV)
• Any broker with a generic CSV (symbol, quantity, avg price)

### 🛠 Setup (30 seconds)

1. Get a free API key from finnhub.io
2. Paste it in Settings → Test connection
3. Import your broker CSV or add crypto
4. Done — your ticker is live!

## Category
Productivity

## Language
English

## Privacy Policy URL
https://github.com/harshabala/myticker-extension/blob/main/PRIVACY.md
