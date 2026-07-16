# MyTicker Settings Form Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Watchlist, Crypto, and Appearance a shared spacing system, contained manual selection UI, durable saved-state feedback, and a standard popup settings gear.

**Architecture:** Keep existing settings data flow and provider behavior. Add layout utility classes to `options.html`, small state helpers in `options.js`, and fixture contracts in the standalone Node tests. The popup gear is an HTML-only SVG correction; no popup state changes are required.

**Tech Stack:** Manifest V3 extension, vanilla HTML/CSS/JavaScript, `chrome.storage`, standalone Node `.mjs` fixtures.

---

## File map

- `options.html` — field-stack/card/list/chip/save-state CSS and Settings markup.
- `options.js` — mark dirty/reset saved labels, save-state persistence and dynamic crypto classes.
- `popup.html` — standard cog SVG while retaining Settings accessible name.
- `test_fixtures/test_ui_copy.mjs` — structural, spacing, save-state, and gear regressions.

### Task 1: Establish Settings form cadence and Watchlist layout

**Files:** Modify `options.html`; test `test_fixtures/test_ui_copy.mjs`.

- [ ] **Step 1: Write failing layout-contract assertions.**

```js
assert.match(optionsHtml, /\.form-stack\s*\{[^}]*gap:\s*16px/);
assert.match(optionsHtml, /\.settings-card\s*\{[^}]*padding:\s*24px/);
assert.match(optionsHtml, /\.configured-list\s*\{[^}]*padding:/);
assert.match(optionsHtml, /class="form-stack"[\s\S]*id="watchlistType"/);
```

- [ ] **Step 2: Verify red.** Run `node test_fixtures/test_ui_copy.mjs`; expected: failure because the form-cadence classes do not exist.

- [ ] **Step 3: Add shared field-stack and action/list styles.**

```css
.settings-card { padding: 24px; }
.form-stack { display: grid; gap: 16px; }
.field { display: grid; gap: 8px; }
.form-action-row { margin-top: 16px; }
.configured-list { margin-top: 16px; padding: 12px 14px; }
```

Use existing tokens and responsive values; preserve 32px targets and visible focus. Place Watchlist fields in the stack in market → exchange → symbol/hint → inline error → action → configured list order.

- [ ] **Step 4: Verify green.** Run `node test_fixtures/test_ui_copy.mjs`; expected: exit 0 with Watchlist spacing/list assertions.
- [ ] **Step 5: Commit.** `git add options.html test_fixtures/test_ui_copy.mjs && git commit -m "feat: structure MyTicker settings forms"`

### Task 2: Contain manual crypto selection

**Files:** Modify `options.html`, `options.js`; test `test_fixtures/test_ui_copy.mjs`.

- [ ] **Step 1: Write failing selector assertions.**

```js
assert.match(optionsHtml, /class="crypto-selector"/);
assert.match(optionsHtml, /id="cryptoSearchResults" class="crypto-results"/);
assert.match(optionsHtml, /id="cryptoSelectedChips" class="crypto-chips"/);
assert.match(optionsHtml, /\.crypto-results\s*\{[^}]*display:\s*flex/);
```

- [ ] **Step 2: Verify red.** Run `node test_fixtures/test_ui_copy.mjs`; expected: missing contained-result/chip class contracts.
- [ ] **Step 3: Create contained crypto layout.**

```html
<div id="cryptoManualField" class="field crypto-selector" hidden inert>
  <label class="field-label" for="cryptoSearch">Search supported crypto</label>
  <input id="cryptoSearch" autocomplete="off" placeholder="BTC, Bitcoin, ethereum…" />
  <div id="cryptoSearchResults" class="crypto-results"></div>
  <div id="cryptoSelectedChips" class="crypto-chips"></div>
  <p class="field-hint">…provider/order guidance…</p>
</div>
```

Style results as compact wrapping buttons and selected coins as a separately padded chip row. `renderCryptoSelector()` must attach the same classes to dynamic buttons/chips, preserve canonical add/remove behavior, and keep the container hidden/inert outside Manual mode.

- [ ] **Step 4: Verify green.** Run `node test_fixtures/test_ui_copy.mjs && node test_fixtures/test_shared.mjs`; expected: exit 0.
- [ ] **Step 5: Commit.** `git add options.html options.js test_fixtures/test_ui_copy.mjs && git commit -m "feat: contain MyTicker manual crypto selection"`

### Task 3: Make saved state durable and resettable

**Files:** Modify `options.html`, `options.js`; test `test_fixtures/test_ui_copy.mjs`.

- [ ] **Step 1: Write failing state-contract assertions.**

```js
assert.match(optionsSource, /setSaveButtonState\(.*saved/);
assert.match(optionsSource, /markSaveDirty\(.*crypto/);
assert.match(optionsSource, /markSaveDirty\(.*appearance/);
assert.match(optionsHtml, /id="saveCryptoButton"[^>]*data-save-scope="crypto"/);
```

- [ ] **Step 2: Verify red.** Run `node test_fixtures/test_ui_copy.mjs`; expected: helpers and scope attributes absent.
- [ ] **Step 3: Implement bounded save feedback.**

```js
function setSaveButtonState(scope, saved) {
  const button = document.querySelector(`[data-save-scope="${scope}"]`);
  if (!button) return;
  button.textContent = saved ? "Saved ✓" : "Save";
  button.classList.toggle("is-saved", saved);
}
function markSaveDirty(scope) { setSaveButtonState(scope, false); }
```

Call `setSaveButtonState("crypto", true)` only after successful storage write and reset it from crypto mode/search/add/remove handlers. Do the same for Appearance toggles/theme/speed/tape-size. Keep the toast as secondary confirmation.

- [ ] **Step 4: Verify green.** Run `node test_fixtures/test_ui_copy.mjs && node test_fixtures/test_content_script_classic.mjs`; expected: exit 0.
- [ ] **Step 5: Commit.** `git add options.html options.js test_fixtures/test_ui_copy.mjs && git commit -m "feat: retain MyTicker save confirmation"`

### Task 4: Replace the popup header glyph with a standard gear

**Files:** Modify `popup.html`; test `test_fixtures/test_ui_copy.mjs`.

- [ ] **Step 1: Write failing gear assertion.**

```js
assert.match(popupHtml, /id="openOptions"[\s\S]*aria-label="Settings"/);
assert.match(popupHtml, /<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*<path[^>]*d="[^\"]+"/);
assert.doesNotMatch(popupHtml, /sun|brightness/i);
```

- [ ] **Step 2: Verify red.** Run `node test_fixtures/test_ui_copy.mjs`; expected: current glyph does not satisfy the cog-specific contract.
- [ ] **Step 3: Replace only the SVG path.** Use a conventional cog with teeth and a central circular opening; retain `viewBox`, button ID, title, and accessible label.
- [ ] **Step 4: Verify green.** Run `node test_fixtures/test_ui_copy.mjs`; expected: exit 0.
- [ ] **Step 5: Commit.** `git add popup.html test_fixtures/test_ui_copy.mjs && git commit -m "fix: use MyTicker settings gear"`

### Task 5: Audit and deploy

**Files:** Synchronize `/Users/harshabalakrishnan/Desktop/MyTicker-dev`.

- [ ] **Step 1: Audit Watchlist, Manual Crypto, Appearance and popup in light/dark/reduced-motion.** Check 24px card padding, 16px stacks, 8px label/control pairing, contained chips/results, saved/dirty reset, focus, and real gear semantics.
- [ ] **Step 2: Run full verification.** Run `for f in test_fixtures/test_*.mjs; do node "$f"; done && git diff --check`; expected: all fixtures pass.
- [ ] **Step 3: Sync runtime source.** Run `rsync -a --delete --exclude '.git/' --exclude '.worktrees/' --exclude '.claude/' --exclude '.superpowers/' ./ /Users/harshabalakrishnan/Desktop/MyTicker-dev/`; exclude any user-owned unstaged spec if still present.
- [ ] **Step 4: Verify desktop source.** Run `rg -n 'form-stack|crypto-selector|data-save-scope|aria-label="Settings"' /Users/harshabalakrishnan/Desktop/MyTicker-dev/options.html /Users/harshabalakrishnan/Desktop/MyTicker-dev/popup.html`; expected: all final contracts present.
