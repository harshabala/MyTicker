# MyTicker Live Market Tape Design

## Purpose

Make **my ticker** a portfolio-first, live market tape that is dependable on ordinary web pages and readable at a glance. Chrome extensions cannot draw in the browser's address or bookmarks bars, so the product surface is a fixed strip at the top of each eligible webpage.

## Product model

The tape is ordered consistently:

1. **Holdings** — imported broker positions. These are the primary surface and show live price, daily percentage movement, and the user's daily P&L.
2. **Watchlist** — user-managed market symbols such as stocks, ETFs, indices, and optionally crypto. These show live price and daily percentage movement.
3. **Crypto** — an optional market section, either curated top assets or user-selected crypto assets. These show live price and 24-hour/daily percentage movement.

Each normalized item has a stable identity, `kind` (`holding`, `watchlist`, or `crypto`), display name, canonical quote symbol, current price, change percentage, optional P&L, currency, source, freshness, and availability state. The strip groups and orders items by `kind`, not by response order from APIs.

## Data architecture

### Equity and index quotes

- Yahoo Finance remains the keyless provider for NSE/BSE symbols.
- Finnhub remains the configured provider for US symbols. It requires the user’s API key.
- Watchlist equities share the same symbol and provider routing as holdings, but carry quantity `0` and never affect portfolio P&L.

### Crypto quotes

- A CoinGecko provider is the default, batched crypto source. It takes canonical CoinGecko IDs (`bitcoin`, `ethereum`, `solana`) and returns USD price, 24-hour percentage change, and source freshness.
- A Binance public-market provider is a fallback only for a small, explicit map of liquid USDT pairs (for example `bitcoin` → `BTCUSDT`). It returns the current price and 24-hour percentage change.
- CoinGecko is attempted first. Binance is used only for unresolved mapped assets. One provider’s failure must not prevent quotes from any other provider from rendering.
- DeFiLlama and Coinbase are deliberately not part of this release. Their specialties—on-chain token discovery and exchange-specific market data—do not improve the core watchlist tape enough to justify another source-selection surface.

The manifest adds host permissions only for the selected first-party API endpoints. API keys remain in `chrome.storage.local`; public providers require no MyTicker backend or account.

## State and refresh flow

The background worker combines imported holdings, watchlist entries, and crypto configuration into normalized quote requests. It polls at the existing user-selected interval, merges snapshots, computes holdings P&L, and writes one `positionsState` payload containing an ordered ticker-item collection and aggregate portfolio data.

The content script mounts first, then reads and renders the latest state. This order removes the current startup race where state may arrive before `document.body` and the ticker bar exist. Subsequent storage changes update the existing elements in place.

If a source fails, the previous known value remains visible with a stale marker. If no prior quote exists, the item renders a compact unavailable state instead of disappearing. The strip can render a watchlist or crypto section even with no imported holdings.

## Live tape visual system

### Character

The approved direction is **Obsidian terminal**: a composed market instrument rather than a generic news marquee.

- Product name: lowercase `my ticker`.
- Surface: cool graphite/near-black, with a subtle hairline and solid fallback when transparency is reduced.
- Typography: system sans for the product and names; tabular figures for prices and changes.
- Accent: a single restrained emerald for positive movement and live status. Negative movement uses a softened coral semantic color. Neutral and metadata stay cool gray.
- Geometry: a 34px strip, tight but breathable spacing, and separators rather than raised cards.

### Item anatomy

`[kind marker] [symbol] [price] [day change] [holding P&L when applicable]`

Items are repeated only when needed for continuous overflow scrolling. A holding’s P&L uses the display currency; a non-holding never shows personal P&L. Group markers appear at group boundaries, not in every item.

### Motion and accessibility

- The tape scrolls linearly only as a time-based marquee. It pauses on hover and keyboard focus.
- State transitions use a shared 180–260ms ease-out. No continuous flash, bounce, or animation for high-frequency number changes.
- `prefers-reduced-motion` changes the strip to a horizontally scrollable, static list.
- The bar has accessible status text; stale/unavailable information is not conveyed by color alone.
- The strip does not claim to render in restricted browser-owned pages.

## App-wide cohesion

Popup and options adopt the same vocabulary and foundation: lowercase **my ticker**, graphite surfaces, emerald as the sole positive/live accent, tabular financial figures, clear section dividers, and direct labels: **Holdings**, **Watchlist**, **Crypto**, and **Data sources**. Existing forms retain visible labels, inline guidance, keyboard access, contrast-safe controls, and clear empty/error states.

## Acceptance criteria

1. A refreshed normal webpage shows the existing state immediately; it does not wait for the next poll.
2. The strip presents current price and daily percent change for every quoteable item.
3. Imported holdings precede watchlist items, which precede crypto items.
4. Holdings alone contribute to aggregate and per-item P&L.
5. A default crypto configuration can receive current prices without a Finnhub key through CoinGecko; mapped assets can fall back to Binance.
6. One failed crypto provider does not blank other items or discard a prior quote.
7. Reduced-motion, empty, loading, stale, and unavailable states remain legible and usable.
8. Existing non-crypto holdings behavior and privacy boundaries continue to work.

## Testing

- Unit tests for item normalization, deterministic group ordering, quote formatting, and holdings-only P&L.
- Provider tests for CoinGecko’s response mapping, Binance fallback selection, and partial failure behavior using controlled `fetch` responses.
- Content-script tests for rendering existing state after delayed DOM mounting.
- Existing shared-state tests continue to run unchanged.

## Scope boundary

This release does not attempt to embed in Chrome’s browser chrome, add account syncing, execute trades, or build an on-chain token discovery product. It focuses on a reliable, beautiful webpage-level live tape and coherent supporting UI.
