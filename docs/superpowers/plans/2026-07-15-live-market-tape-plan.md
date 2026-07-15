# Live Market Tape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable, portfolio-first live tape for my ticker, with current prices, watchlist routing, keyless crypto quotes, and the approved Obsidian terminal visual system.

**Architecture:** `background.js` will normalize holdings, stored watchlist entries, and crypto configuration into a single quote request set, then write ordered `tickerItems` to `positionsState`. `priceProviders.js` will route equities to Yahoo/Finnhub and crypto to CoinGecko with a narrow Binance fallback. `contentScript.js` will mount before rendering cached state and render ticker items by group.

**Tech Stack:** Chrome Manifest V3, ES modules, browser `fetch`, Chrome storage/alarms, standalone Node ESM test scripts, CSS Shadow DOM.

---

## File structure

- `shared.js` — pure ticker-item normalization, stable ordering, and price formatting helpers.
- `priceProviders.js` — provider routing plus CoinGecko and Binance public-quote adapters.
- `background.js` — combines holdings, watchlist, and crypto; refreshes and persists ordered state.
- `contentScript.js` — mounts safely, renders item type/price/change/P&L and accessible states.
- `ticker.css` — Obsidian terminal strip and reduced-motion/static behavior.
- `manifest.json` — exact new provider host permissions.
- `test_fixtures/test_shared.mjs` — regression tests for normalization/order/formatting.
- `test_fixtures/test_price_providers.mjs` — deterministic `fetch` tests for CoinGecko and Binance fallback.

### Task 1: Define pure ticker-item contracts

**Files:**
- Modify: `shared.js:3-290`
- Modify: `test_fixtures/test_shared.mjs`

- [ ] **Step 1: Write failing normalization tests**

Append these test cases before the summary in `test_fixtures/test_shared.mjs`:

```js
import { buildTickerItems, formatQuotePrice } from "../shared.js";

const tickerItems = buildTickerItems({
  positions: [{ symbol: "TCS.NS", displayName: "TCS", lastPrice: 3200, dayPnl: 50, dayPnlPct: 1.2, currency: "INR" }],
  watchlist: [{ symbol: "AAPL", displayName: "AAPL", lastPrice: 210, changePct: -0.5, currency: "USD" }],
  crypto: [{ symbol: "bitcoin", displayName: "BTC", lastPrice: 65000, changePct: 2.1, currency: "USD" }]
});
assert(tickerItems.map((item) => item.kind).join(",") === "holding,watchlist,crypto", "ticker items are holdings, watchlist, crypto");
assert(tickerItems[0].dayPnl === 50, "holding preserves P&L");
assert(tickerItems[1].dayPnl == null, "watchlist never has personal P&L");
assert(formatQuotePrice(3200, "INR").includes("3"), "formats INR quote price");
assert(formatQuotePrice(null, "USD") === "—", "missing quote is unavailable");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test_fixtures/test_shared.mjs`

Expected: failure because `buildTickerItems` and `formatQuotePrice` are not exported.

- [ ] **Step 3: Implement minimal pure helpers**

Add this exact contract to `shared.js` and export both names:

```js
function formatQuotePrice(value, currency = "USD") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency", currency, minimumFractionDigits: number >= 100 ? 2 : 4,
    maximumFractionDigits: number >= 100 ? 2 : 4
  }).format(number);
}

function buildTickerItems({ positions = [], watchlist = [], crypto = [] } = {}) {
  const fromPosition = positions.map((item) => ({ ...item, kind: "holding" }));
  const fromWatchlist = watchlist.map((item) => ({ ...item, kind: "watchlist", dayPnl: null }));
  const fromCrypto = crypto.map((item) => ({ ...item, kind: "crypto", dayPnl: null }));
  return [...fromPosition, ...fromWatchlist, ...fromCrypto];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test_fixtures/test_shared.mjs`

Expected: exit code 0, including the four new ticker-item assertions.

- [ ] **Step 5: Commit**

```bash
git add shared.js test_fixtures/test_shared.mjs
git commit -m "feat: add normalized ticker items"
```

### Task 2: Add public crypto provider fallback

**Files:**
- Modify: `priceProviders.js:1-224`
- Modify: `manifest.json:30-35`
- Create: `test_fixtures/test_price_providers.mjs`

- [ ] **Step 1: Write failing provider tests**

Create `test_fixtures/test_price_providers.mjs` with a controlled global fetch and these assertions:

```js
import { CoinGeckoPriceProvider, BinancePriceProvider, getCryptoQuotes } from "../priceProviders.js";

let calls = [];
globalThis.fetch = async (url) => {
  calls.push(String(url));
  if (String(url).includes("coingecko")) return new Response(JSON.stringify({ bitcoin: { usd: 65000, usd_24h_change: 1.5, last_updated_at: 100 } }), { status: 200 });
  if (String(url).includes("binance")) return new Response(JSON.stringify({ lastPrice: "3000", priceChangePercent: "-0.5" }), { status: 200 });
  return new Response("", { status: 404 });
};

const gecko = await new CoinGeckoPriceProvider().getQuotes(["bitcoin"]);
assert(gecko[0].symbol === "bitcoin" && gecko[0].lastPrice === 65000, "CoinGecko maps a crypto quote");
const fallback = await getCryptoQuotes(["ethereum"], { coinGecko: { getQuotes: async () => [] }, binance: new BinancePriceProvider() });
assert(fallback[0].lastPrice === 3000 && calls.some((url) => url.includes("ETHUSDT")), "Binance fetches mapped unresolved asset");
```

Include local `assert`, totals, and `process.exit(failed ? 1 : 0)` in the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test_fixtures/test_price_providers.mjs`

Expected: failure because the crypto provider exports do not exist.

- [ ] **Step 3: Implement provider adapters and explicit routing**

Add `CoinGeckoPriceProvider`, `BinancePriceProvider`, and `getCryptoQuotes` to `priceProviders.js`. CoinGecko must batch IDs through `https://api.coingecko.com/api/v3/simple/price?ids=...&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`; it returns `{ symbol, lastPrice, prevClose: null, changePct, currency: "USD", source: "coingecko" }`. Binance must use only this explicit mapping:

```js
const BINANCE_USDT_PAIRS = { bitcoin: "BTCUSDT", ethereum: "ETHUSDT", binancecoin: "BNBUSDT", ripple: "XRPUSDT", solana: "SOLUSDT" };
```

Use `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${pair}` and return the same shape with `source: "binance"`. `getCryptoQuotes(ids, providers)` calls CoinGecko first, computes unresolved IDs, then asks Binance only for unresolved mapped IDs. Catch network/HTTP/JSON failures inside each provider and return `[]`; never reject the complete quote operation.

Add these host permissions to `manifest.json`:

```json
"https://api.coingecko.com/*",
"https://data-api.binance.vision/*"
```

- [ ] **Step 4: Run provider and existing tests**

Run: `node test_fixtures/test_price_providers.mjs && node test_fixtures/test_shared.mjs`

Expected: both scripts exit 0; the fallback assertion proves that an empty CoinGecko result reaches Binance.

- [ ] **Step 5: Commit**

```bash
git add priceProviders.js manifest.json test_fixtures/test_price_providers.mjs
git commit -m "feat: add resilient crypto quotes"
```

### Task 3: Include the existing watchlist and crypto in refresh state

**Files:**
- Modify: `background.js:1-300`
- Modify: `shared.js`
- Modify: `test_fixtures/test_shared.mjs`

- [ ] **Step 1: Write a failing state-order test**

Add a pure test that passes one holding, one zero-quantity watchlist item, and one crypto item into the new state-builder helper, then asserts `state.tickerItems.map(({ kind }) => kind)` is `["holding", "watchlist", "crypto"]` and aggregate day P&L equals the holding-only aggregate.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test_fixtures/test_shared.mjs`

Expected: failure because the state helper does not yet expose `tickerItems`.

- [ ] **Step 3: Implement combined refresh data**

In `background.js`, include `STORAGE_KEYS.watchlist` in the local storage read. Normalize stored watchlist entries to `{ symbol, displayName, quantity: 0, assetClass: "watchlist", currency }` and fetch them with equities. Convert crypto configuration to CoinGecko IDs (`bitcoin`, `ethereum`, `binancecoin`, `ripple`, `solana`) rather than Finnhub `BINANCE:` strings. Fetch equities with `getAllQuotes` and crypto with `getCryptoQuotes`, merge both snapshots, then build `positionsState.tickerItems` from holdings positions, quote-only watchlist records, and quote-only crypto records.

Keep `positionsState.positions` and `aggregate` holdings-only for existing popup calculations. Preserve state if a group has no items; clear state only if holdings, watchlist, and enabled crypto are all empty.

- [ ] **Step 4: Run the pure suite**

Run: `node test_fixtures/test_shared.mjs`

Expected: exit code 0; ordering and holdings-only aggregate tests pass.

- [ ] **Step 5: Commit**

```bash
git add background.js shared.js test_fixtures/test_shared.mjs
git commit -m "feat: include watchlist and crypto in tape state"
```

### Task 4: Render current prices reliably in the tape

**Files:**
- Modify: `contentScript.js:1-405`
- Modify: `ticker.css:1-320`

- [ ] **Step 1: Add a failing DOM regression harness**

Create `test_fixtures/test_ticker_render.mjs` that loads `contentScript.js` in a minimal DOM implementation, supplies cached state before dispatching `DOMContentLoaded`, then asserts the mounted host exists and its rendered text includes the cached symbol and price. Use a fake `chrome.storage` whose `get` callbacks resolve synchronously and whose runtime URL is `ticker.css`.

- [ ] **Step 2: Run it to verify the current race**

Run: `node test_fixtures/test_ticker_render.mjs`

Expected: fail because the cached state renders before `tickerBar` is created and no later render occurs.

- [ ] **Step 3: Make mount and render sequencing explicit**

Store the latest local state in a module variable. At the end of `ensureTickerContainer`, call `renderTicker(latestState)` if it exists. In `init`, assign `latestState` before every `renderTicker` call.

Change item rendering to consume `state.tickerItems || state.positions`. For each item, render its stable group marker at the first item of a group, its display name, `formatQuotePrice(item.lastPrice, item.currency)`, signed `changePct || dayPnlPct`, and only holding `dayPnl`. Render `Updating markets` when mounted but state is absent; render `No items — add holdings or a watchlist` only when a resolved state has no items. Preserve stale copy and ARIA status.

Update the strip to 34px and apply the Obsidian terminal tokens: graphite solid fallback, lowercase brand, tabular figures, thin separators, and semantic emerald/coral values. Only animate overflowing duplicated content; make the static reduced-motion path horizontally scrollable. Use 180–260ms ease-out only for state transitions, not for every price tick.

- [ ] **Step 4: Run the ticker regression and all unit scripts**

Run: `node test_fixtures/test_ticker_render.mjs && node test_fixtures/test_price_providers.mjs && node test_fixtures/test_shared.mjs`

Expected: all scripts exit 0 and the cached-state test proves immediate rendering after a delayed mount.

- [ ] **Step 5: Commit**

```bash
git add contentScript.js ticker.css test_fixtures/test_ticker_render.mjs
git commit -m "feat: render live prices in the market tape"
```

### Task 5: Align popup and options language with the tape

**Files:**
- Modify: `popup.js`
- Modify: `popup.html`
- Modify: `options.html`
- Modify: `brand.css`

- [ ] **Step 1: Write a failing DOM text test**

Extend `test_fixtures/test_ticker_render.mjs` or add `test_fixtures/test_copy.mjs` to assert the product label is `my ticker`, the watchlist tab is labelled `Watchlist`, and settings expose the section labels `Holdings`, `Watchlist`, `Crypto`, and `Data sources`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test_fixtures/test_copy.mjs`

Expected: failure showing the old title/copy or missing source section.

- [ ] **Step 3: Apply the cohesive copy and visual tokens**

Update visible product labels to lowercase `my ticker`. Keep the existing popup’s functional Holdings/Watchlist tabs but use the same tabular-number class and graphite/emerald token family as the strip. In settings, use visible labels and helper copy for **Holdings**, **Watchlist**, **Crypto**, and **Data sources**; explain CoinGecko primary/Binance fallback without implying price execution or investment advice. Preserve existing field labels and contrast-safe focus states.

- [ ] **Step 4: Run all scripts and inspect the extension files**

Run: `node test_fixtures/test_shared.mjs && node test_fixtures/test_price_providers.mjs && node test_fixtures/test_ticker_render.mjs && node test_fixtures/test_copy.mjs && node --check background.js && node --check contentScript.js && node --check priceProviders.js && node --check popup.js && node --check options.js`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add popup.js popup.html options.html brand.css test_fixtures/test_copy.mjs
git commit -m "design: unify my ticker market surfaces"
```

### Task 6: Package-level verification and manual browser check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a manual acceptance checklist**

Document: reload the unpacked extension; open an ordinary `https` tab; confirm cached prices appear immediately; add an NSE watchlist symbol; enable crypto; simulate/observe a provider outage; enable reduced motion; and confirm no strip is expected on `chrome://` pages.

- [ ] **Step 2: Run static verification**

Run: `python3 -m json.tool manifest.json >/dev/null && git diff --check && node test_fixtures/test_shared.mjs && node test_fixtures/test_price_providers.mjs && node test_fixtures/test_ticker_render.mjs && node test_fixtures/test_copy.mjs`

Expected: all commands exit 0.

- [ ] **Step 3: Perform manual Chrome verification**

Load/reload the unpacked folder in `chrome://extensions`, then perform every README checklist item. Record any provider response or content-script error before making further edits.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add live tape verification guide"
```

## Plan self-review

- **Spec coverage:** Tasks 1 and 3 implement ordering and holdings-only P&L; Task 2 implements the selected crypto sources; Task 4 implements current-price rendering, startup reliability, appearance, accessibility, and states; Task 5 aligns the app; Task 6 validates browser behavior.
- **Scope:** Coinbase and DeFiLlama are intentionally excluded as specified. No backend, trading, or browser-chrome feature is introduced.
- **Consistency:** `tickerItems`, `kind`, `lastPrice`, `changePct`, and `currency` are used consistently across state, provider, renderer, and tests.
- **Placeholder scan:** no deferred implementation markers are present.
