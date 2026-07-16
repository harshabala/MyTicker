# MyTicker Gold Popup and Surface Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the popup into a compact, read-only portfolio/watchlist overview and apply the MyTicker obsidian-and-gold visual system consistently across the popup and Settings.

**Architecture:** `popup.html` owns stable popup structure and styling, while `popup.js` only renders holdings/watchlist state and routes the single gear action to Settings. `brand.css` provides shared semantic gold, financial-state, and theme tokens; Settings consumes those tokens without changing existing quote/configuration behavior.

**Tech Stack:** Manifest V3 browser extension, vanilla HTML/CSS/JavaScript, `chrome.storage`, standalone Node `.mjs` fixtures.

---

## File map

- `popup.html` — simplified header, stable Holdings/Watchlist panels, popup visual tokens.
- `popup.js` — remove quick-add/tape-toggle handlers; retain review/remove/settings routing.
- `brand.css`, `options.html`, `ticker.css` — gold interaction tokens and consistent light/dark styling.
- `test_fixtures/test_ui_copy.mjs`, `test_fixtures/test_ticker_render.mjs` — structural and token regressions.

### Task 1: Make the popup a review-only surface

**Files:** Modify `popup.html`, `popup.js`; test `test_fixtures/test_ui_copy.mjs`.

- [ ] **Step 1: Write failing popup-scope assertions.**

```js
assert.doesNotMatch(popupHtml, /id="addWatchBtn"/);
assert.doesNotMatch(popupHtml, /quickAddInput|quickAddExchange|quickAddBtn/);
assert.doesNotMatch(popupSource, /doQuickAdd|renderTickerToggle/);
assert.match(popupHtml, /id="openOptions"[^>]*aria-label="Settings"/);
assert.match(popupHtml, /aria-controls="panelHoldings"/);
assert.match(popupHtml, /aria-controls="panelWatchlist"/);
```

- [ ] **Step 2: Verify red.**

Run: `node test_fixtures/test_ui_copy.mjs`

Expected: FAIL because quick-add and tape-toggle UI/handlers still exist.

- [ ] **Step 3: Remove configuration controls and preserve review actions.**

```html
<button type="button" class="icon-btn" id="openOptions" aria-label="Settings" title="Settings">
  <svg viewBox="0 0 24 24" aria-hidden="true">…gear path…</svg>
</button>
```

Delete the plus button, quick-add sheet and fields, its listeners/functions, popup tape-toggle card, popup tape toggle listener, and shortcut/footer UI. Keep Watchlist rows, textual quote freshness, and `Remove {display name}` actions.

- [ ] **Step 4: Verify review-only behavior.**

Run: `node test_fixtures/test_ui_copy.mjs && node test_fixtures/test_popup_movers.mjs`

Expected: both suites exit 0 and popup Watchlist still supports removal/state rendering.

- [ ] **Step 5: Commit.**

```bash
git add popup.html popup.js test_fixtures/test_ui_copy.mjs
git commit -m "feat: simplify MyTicker popup controls"
```

### Task 2: Apply the gold-led popup hierarchy

**Files:** Modify `brand.css`, `popup.html`; test `test_fixtures/test_ui_copy.mjs`.

- [ ] **Step 1: Write failing token and semantic-color assertions.**

```js
assert.match(brandCss, /--brand-gold:/);
assert.match(popupHtml, /var\(--brand-gold\)/);
assert.match(popupHtml, /\.pnl-positive\s*\{\s*color:\s*var\(--green\)/);
assert.match(popupHtml, /\.pnl-negative\s*\{\s*color:\s*var\(--red\)/);
```

- [ ] **Step 2: Verify red.**

Run: `node test_fixtures/test_ui_copy.mjs`

Expected: FAIL until gold is a named shared token and popup selected/link controls consume it.

- [ ] **Step 3: Define restrained gold tokens for all themes.**

```css
:root { --brand-gold: #c99724; --brand-gold-hover: #e0ae36; --brand-gold-muted: rgba(201, 151, 36, 0.14); }
:root[data-theme="light"] { --brand-gold: #a56f00; --brand-gold-hover: #875b00; --brand-gold-muted: rgba(165, 111, 0, 0.12); }
```

Use gold for the selected tab underline, primary settings action/gear focus/link emphasis; retain `--green` for positive/live and `--red` for negative values only.

- [ ] **Step 4: Recompose popup layout without changing content priorities.**

Use header → tabs → one daily-summary panel → movers panel. Use divider-led rows, modest radii, restrained border/shadow, and the existing system type hierarchy. Do not add gradients, dashboard hero treatment, or a separate font.

- [ ] **Step 5: Verify tokens and UI contracts.**

Run: `node test_fixtures/test_ui_copy.mjs && node test_fixtures/test_ticker_render.mjs`

Expected: both exit 0; market values remain tabular and reduced-motion tape behavior remains intact.

- [ ] **Step 6: Commit.**

```bash
git add brand.css popup.html test_fixtures/test_ui_copy.mjs
git commit -m "feat: apply MyTicker gold popup hierarchy"
```

### Task 3: Carry the gold system into Settings without changing flows

**Files:** Modify `brand.css`, `options.html`, `ticker.css`; test `test_fixtures/test_ui_copy.mjs`, `test_fixtures/test_ticker_render.mjs`.

- [ ] **Step 1: Write failing shared-surface assertions.**

```js
assert.match(optionsHtml, /var\(--brand-gold\)/);
assert.match(optionsHtml, /\.settings-tab\[aria-selected="true"\]::after[\s\S]*var\(--brand-gold\)/);
assert.doesNotMatch(tickerCss, /--green:[^;]+;[^}]*--brand-gold/);
```

- [ ] **Step 2: Verify red.** Run `node test_fixtures/test_ui_copy.mjs`; expected: gold is not yet consistently used in Settings.
- [ ] **Step 3: Apply gold only to interaction emphasis.** Use the shared token for selected Settings tab underline, primary CTA, visible focus, and explanatory links. Keep panels neutral, retain financial/live semantics, and maintain system/light/dark + reduced-transparency behavior.
- [ ] **Step 4: Verify.** Run `node test_fixtures/test_ui_copy.mjs && node test_fixtures/test_ticker_render.mjs`; expected: exit 0.
- [ ] **Step 5: Commit.**

```bash
git add brand.css options.html ticker.css test_fixtures/test_ui_copy.mjs
git commit -m "feat: align Settings with MyTicker gold system"
```

### Task 4: Final audit and desktop deployment

**Files:** Synchronize `/Users/harshabalakrishnan/Desktop/MyTicker-dev`.

- [ ] **Step 1: Audit popup keyboard/ARIA and theme states.** Check only one popup header action remains, tabs retain valid panels and Arrow/Home/End navigation, gear has an accessible label, and System/Light/Dark plus reduced-motion/transparency remain readable.
- [ ] **Step 2: Run complete verification.**

Run: `for f in test_fixtures/test_*.mjs; do node "$f"; done && git diff --check`

Expected: all fixtures exit 0 and no whitespace errors.

- [ ] **Step 3: Sync verified source.**

```bash
rsync -a --delete --exclude '.git/' --exclude '.worktrees/' --exclude '.claude/' --exclude '.superpowers/' ./ /Users/harshabalakrishnan/Desktop/MyTicker-dev/
```

- [ ] **Step 4: Verify desktop copy.**

Run: `rg -n 'MyTicker|brand-gold|aria-label="Settings"' /Users/harshabalakrishnan/Desktop/MyTicker-dev/popup.html /Users/harshabalakrishnan/Desktop/MyTicker-dev/brand.css`

Expected: canonical name, gear label, and shared gold token are present.
