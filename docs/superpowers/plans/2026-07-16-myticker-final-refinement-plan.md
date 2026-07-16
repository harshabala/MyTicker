# MyTicker Final Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MyTicker's tape truthful in native currencies, readable at user-selected sizes, easy to configure, and coherent across system/light/dark themes.

**Architecture:** Keep this dependency-free Manifest V3 extension local-first. `shared.js` owns normalized state and settings; `contentShared.js` mirrors only the classic-content-script formatters; options owns configuration; CSS semantic variables drive all surfaces.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, `chrome.storage.local`, `chrome.alarms`, standalone Node `.mjs` fixtures.

---

## File map

- `shared.js` — defaults, normalization, currency metadata, ticker state.
- `contentShared.js`, `contentScript.js`, `ticker.css` — tape formatting, mounting, scale and motion.
- `options.html`, `options.js`, `brand.css` — settings IA, instruments, themes and type tokens.
- `popup.html`, `popup.js` — holdings/watchlist overview.
- `test_fixtures/test_shared.mjs`, `test_ticker_render.mjs`, `test_ui_copy.mjs` — contracts.
- `docs/content-inventory.md`, `docs/information-architecture.md` — final handoff.

### Task 1: Preserve native currency from source to tape

**Files:** Modify `shared.js`, `contentShared.js`, `contentScript.js`; test `test_fixtures/test_shared.mjs`, `test_fixtures/test_ticker_render.mjs`.

- [ ] **Step 1: Write failing currency tests.**

```js
assert.equal(inferDisplayCurrency({ symbol: "RELIANCE.NS" }), "INR");
assert.equal(inferDisplayCurrency({ symbol: "AAPL" }), "USD");
assert.equal(inferDisplayCurrency({ assetClass: "crypto", symbol: "BTC" }), "USD");
assert.equal(tickerItems.find((item) => item.symbol === "RELIANCE.NS").currency, "INR");
```

- [ ] **Step 2: Verify the test fails.** Run `node test_fixtures/test_shared.mjs`; expected: failure because the normalizer does not exist.

- [ ] **Step 3: Implement deterministic metadata.**

```js
function inferDisplayCurrency(item = {}) {
  if (item.currency === "INR" || item.currency === "USD") return item.currency;
  if (item.assetClass === "crypto") return "USD";
  return /\.(NS|BO)$/i.test(item.symbol || "") ? "INR" : "USD";
}
function normalizeTickerItem(item, kind) {
  return { ...item, kind, currency: inferDisplayCurrency(item) };
}
```

Use it for positions, watchlist, crypto and quote merging. Retain per-holding source currency and never present mixed-currency aggregate P&L as one currency.

- [ ] **Step 4: Add render assertions** `assert.match(renderedIndianItem.textContent, /₹/);`, plus `$` checks for US and crypto.
- [ ] **Step 5: Verify.** Run `node test_fixtures/test_shared.mjs && node test_fixtures/test_ticker_render.mjs`; expected: exit 0.
- [ ] **Step 6: Commit.** `git add shared.js contentShared.js contentScript.js test_fixtures/test_shared.mjs test_fixtures/test_ticker_render.mjs && git commit -m "fix: preserve native quote currencies"`

### Task 2: Add a coherent tape-size preference

**Files:** Modify `shared.js`, `options.html`, `options.js`, `contentScript.js`, `ticker.css`, `brand.css`; test `test_fixtures/test_shared.mjs`, `test_fixtures/test_ticker_render.mjs`.

- [ ] **Step 1: Write failing settings tests.**

```js
assert.equal(DEFAULT_SETTINGS.tickerStyleConfig.tapeScale, "comfortable");
assert.equal(normalizeTapeScale("large"), "large");
assert.equal(normalizeTapeScale("invalid"), "comfortable");
```

- [ ] **Step 2: Verify failure.** Run `node test_fixtures/test_shared.mjs`; expected: missing default/normalizer.
- [ ] **Step 3: Add the fixed vocabulary.**

```js
const TAPE_SCALES = Object.freeze({ compact: 0.92, comfortable: 1.08, large: 1.20 });
function normalizeTapeScale(value) {
  return Object.hasOwn(TAPE_SCALES, value) ? value : "comfortable";
}
```

- [ ] **Step 4: Add labelled Appearance radios.**

```html
<fieldset class="choice-group" aria-describedby="tape-size-help">
  <legend>Tape size</legend>
  <label><input type="radio" name="tapeScale" value="compact"> Compact</label>
  <label><input type="radio" name="tapeScale" value="comfortable"> Comfortable <span>Recommended</span></label>
  <label><input type="radio" name="tapeScale" value="large"> Large</label>
</fieldset>
<p id="tape-size-help">Changes the tape's height, type, and spacing on every page.</p>
```

- [ ] **Step 5: Apply the scale to a tape data attribute and CSS variable.**

```js
root.dataset.tapeScale = normalizeTapeScale(settings?.tickerStyleConfig?.tapeScale);
```

```css
#portfolio-ticker-strip[data-tape-scale="comfortable"] { --pts-scale: 1.08; }
#portfolio-ticker-strip[data-tape-scale="large"] { --pts-scale: 1.20; }
#portfolio-ticker-strip { min-height: calc(38px * var(--pts-scale)); font-size: calc(12px * var(--pts-scale)); }
```

Scale padding, gap, type and status marker; keep horizontal scrolling and static content under reduced motion.
- [ ] **Step 6: Verify.** Run `node test_fixtures/test_shared.mjs && node test_fixtures/test_ticker_render.mjs && rg "tape-scale|--pts-scale" contentScript.js ticker.css`; expected: exit 0 and all three selectors.
- [ ] **Step 7: Commit.** `git add shared.js options.html options.js contentScript.js ticker.css brand.css test_fixtures && git commit -m "feat: add configurable market tape size"`

### Task 3: Make watchlist and crypto adding searchable and explicit

**Files:** Modify `options.html`, `options.js`, `shared.js`, `popup.js`; test `test_fixtures/test_shared.mjs`, `test_fixtures/test_ui_copy.mjs`.

- [ ] **Step 1: Write failing catalog/input tests.**

```js
assert.deepEqual(normalizeInstrumentInput("reliance", "india", "NSE"), { symbol: "RELIANCE.NS", currency: "INR" });
assert.deepEqual(normalizeInstrumentInput("bitcoin", "crypto"), { symbol: "BTC", coinGeckoId: "bitcoin", currency: "USD" });
assert.match(optionsHtml, /CoinGecko is the primary crypto source/);
assert.doesNotMatch(optionsHtml, /Coinbase|DeFiLlama/);
```

- [ ] **Step 2: Verify failure.** Run `node test_fixtures/test_shared.mjs && node test_fixtures/test_ui_copy.mjs`; expected: catalog/input contract absent.
- [ ] **Step 3: Define the supported crypto catalog.**

```js
const SUPPORTED_CRYPTO = Object.freeze([
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "solana", symbol: "SOL", name: "Solana" }
]);
```

- [ ] **Step 4: Build Watchlist add.** Provide India, US, Index/ETF, Crypto types; an India exchange selector; labelled search/input; result suggestions and a live inline error. Normalize `.NS`/`.BO`; state that US prices need Finnhub.
- [ ] **Step 5: Build Crypto selection.** Keep Off/Top 5/Manual. Manual has search, Add and removable chips; Top 5 shows the exact defaults. State: `CoinGecko supplies crypto prices. Binance is used only as a fallback for mapped liquid pairs.` Unknown input says: `Choose one of the supported CoinGecko assets.`
- [ ] **Step 6: Reuse normalized metadata in popup watchlist.** Render native currency, asset label, stale/unavailable state, and remove by canonical key.
- [ ] **Step 7: Verify.** Run `node test_fixtures/test_shared.mjs && node test_fixtures/test_ui_copy.mjs && node test_fixtures/test_ticker_render.mjs`; expected: exit 0.
- [ ] **Step 8: Commit.** `git add options.html options.js shared.js popup.js test_fixtures && git commit -m "feat: add searchable watchlist and crypto controls"`

### Task 4: Apply MyTicker design system and task-based IA

**Files:** Modify `manifest.json`, `options.html`, `options.js`, `popup.html`, `popup.js`, `contentScript.js`, `brand.css`, `ticker.css`; test `test_fixtures/test_ui_copy.mjs`, `test_fixtures/test_content_script_classic.mjs`.

- [ ] **Step 1: Write failing canonical-name/navigation tests.**

```js
assert.match(optionsHtml, /Portfolio/);
assert.match(optionsHtml, /Watchlist/);
assert.match(optionsHtml, /Crypto/);
assert.match(optionsHtml, /Data &amp; diagnostics/);
assert.match(optionsHtml, /Appearance/);
```

Require visible `MyTicker`; retain lower-case storage keys and CSS IDs as machine identifiers.
- [ ] **Step 2: Verify failure.** Run `node test_fixtures/test_ui_copy.mjs`; expected: legacy naming/tabs fail.
- [ ] **Step 3: Rebuild settings navigation.** Map import/holdings to Portfolio, configuration to Watchlist/Crypto, sources/logs to Data & diagnostics, visual controls to Appearance. Preserve hash navigation and roving-tab keyboard behavior.
- [ ] **Step 4: Make theme behavior deterministic.**

```js
const theme = settings.tickerStyleConfig?.theme || "system";
document.documentElement.dataset.theme = theme;
```

Support system/light/dark; system follows `prefers-color-scheme`; explicit choices override it.
- [ ] **Step 5: Replace ad-hoc styles with semantic tokens.**

```css
:root { --surface: #f7f8fa; --ink: #17202a; --positive: #078a63; --negative: #c84a54; --divider: #d9dde3; }
:root[data-theme="dark"] { --surface: #101418; --ink: #eef2f5; --positive: #36c58e; --negative: #ff7a84; --divider: #2c343c; }
* { font-synthesis: none; }
.financial { font-variant-numeric: tabular-nums; font-weight: 600; }
```

Use 700 product/metric headings, 600 section headings, 500 labels/metadata, 400 body; no generic gold fills; 32px targets and visible focus.
- [ ] **Step 6: Normalize copy and motion.** Visible product name is `MyTicker`; tape pauses on hover/focus; reduced motion disables refresh animation; user-triggered transitions stay <=300ms.
- [ ] **Step 7: Verify.** Run `node test_fixtures/test_ui_copy.mjs && node test_fixtures/test_content_script_classic.mjs`; expected: exit 0.
- [ ] **Step 8: Commit.** `git add manifest.json options.html options.js popup.html popup.js contentScript.js brand.css ticker.css test_fixtures && git commit -m "feat: refine MyTicker design and settings IA"`

### Task 5: Audit and remediate final UI

**Files:** Modify only actionable files among `brand.css`, `ticker.css`, `options.*`, `popup.*`, `contentScript.js`; test all fixtures.

- [ ] **Step 1: Run the Impeccable, frontend-design, Apple-design, and UI-wiki audits.** Inspect Compact/Comfortable/Large, system/light/dark, focus, empty, stale, unavailable and loaded states.
- [ ] **Step 2: Record file, selector/function, impact, and minimal remedy for every actionable finding.** Do not add unrelated scope.
- [ ] **Step 3: Implement those remedies and add a regression assertion for changed behavior.** Examples include contrast, control labels, target size, motion restraint, or default scale.
- [ ] **Step 4: Verify.** Run `for f in test_fixtures/test_*.mjs; do node "$f"; done`; expected: every fixture exits 0.
- [ ] **Step 5: Commit.** `git add brand.css ticker.css options.html options.js popup.html popup.js contentScript.js test_fixtures && git commit -m "fix: polish MyTicker accessibility and visual states"`

### Task 6: Produce editorial and IA handoff

**Files:** Create `docs/content-inventory.md`, `docs/information-architecture.md`; test `test_fixtures/test_ui_copy.mjs`.

- [ ] **Step 1: Inventory exact final visible strings** by popup, Portfolio, Watchlist, Crypto, Data & diagnostics, Appearance, tape and diagnostics; include state copy and provider claims with location, purpose and rationale.
- [ ] **Step 2: Document the IA** with navigation map, screen ownership and flows for import, watchlist add, crypto select, appearance and diagnostics. Explain holdings-first, watchlist-second, crypto-third, diagnostics-last grouping.
- [ ] **Step 3: Verify traceability.** Run `rg -n "MyTicker|CoinGecko|Binance|Tape size|Data & diagnostics" docs/content-inventory.md docs/information-architecture.md && node test_fixtures/test_ui_copy.mjs`; expected: required concepts found and test exits 0.
- [ ] **Step 4: Commit.** `git add docs/content-inventory.md docs/information-architecture.md && git commit -m "docs: add MyTicker content and IA handoff"`

### Task 7: Deploy the verified build

**Files:** Synchronize `/Users/harshabalakrishnan/Desktop/MyTicker-dev`.

- [ ] **Step 1: Verify the clean feature worktree.** Run `git status --short && for f in test_fixtures/test_*.mjs; do node "$f"; done`; expected: no product changes and all tests pass.
- [ ] **Step 2: Sync only extension source.**

```bash
rsync -a --delete --exclude '.git/' --exclude '.worktrees/' --exclude '.claude/' --exclude '.superpowers/' ./ /Users/harshabalakrishnan/Desktop/MyTicker-dev/
```

- [ ] **Step 3: Verify desktop contents.** Run `rg -n '"version"|"name"' /Users/harshabalakrishnan/Desktop/MyTicker-dev/manifest.json && rg -n 'CoinGecko|Tape size|MyTicker' /Users/harshabalakrishnan/Desktop/MyTicker-dev/options.html`; expected: canonical name and controls present.
- [ ] **Step 4: Reload the existing Brave extension loaded from that desktop folder.** Inspect popup, settings and an ordinary page; confirm page-level tape, native currency, scale and theme modes.
- [ ] **Step 5: Report evidence.** Provide exact folder, build/version, test results, and checked screens; never claim browser-chrome placement.
