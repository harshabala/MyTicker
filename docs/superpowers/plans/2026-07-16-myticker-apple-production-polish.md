# MyTicker Apple Production Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`. Steps use checkbox syntax for tracking.

**Goal:** Close the final Apple-design audit gaps without changing MyTicker’s information architecture or market-data behavior.

**Architecture:** Keep interaction behavior CSS-only and deliberately restrained. Add press response only to the existing popup Settings cog, declare a semantic high-contrast override for extension surfaces and controls, and convert the core Settings layout rhythm to root-relative units while retaining the established visual dimensions at the default browser text size.

**Tech Stack:** Manifest V3 extension; static HTML/CSS/JavaScript; Node fixture tests.

---

### Task 1: Apple interaction, contrast, and scalable Settings rhythm

**Files:**
- Modify: `popup.html`
- Modify: `options.html`
- Modify: `brand.css`
- Modify: `test_fixtures/test_ui_copy.mjs`

- [ ] **Step 1: Write failing static regressions**

Add assertions that require:

```js
assert(/\.icon-btn:active\s*\{[\s\S]*?transform:\s*scale\(0\.97\)/.test(popupHtml), "gives the popup Settings cog immediate press feedback");
assert(/@media \(prefers-contrast: more\)/.test(brandCss), "provides a high-contrast mode");
assert(/\.page\s*\{[\s\S]*?padding:\s*1\.75rem 1\.5rem 3rem/.test(optionsHtml), "uses root-relative Settings page rhythm");
```

- [ ] **Step 2: Run the focused fixture to verify red**

Run: `node test_fixtures/test_ui_copy.mjs`

Expected: the three new assertions fail because no cog press rule, high-contrast media query, or root-relative page rhythm exists.

- [ ] **Step 3: Implement the smallest compliant CSS changes**

```css
/* popup.html */
.icon-btn { transition: transform var(--motion-press) var(--ease-press), background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out); }
.icon-btn:active { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) { .icon-btn:active { transform: none; } }

/* brand.css */
@media (prefers-contrast: more) {
  :root { --bg-surface: var(--bg); --border: var(--text-secondary); --material-elevated-shadow: none; }
}

/* options.html */
.page { padding: 1.75rem 1.5rem 3rem; }
```

Ensure selected/high-contrast controls retain a visible gold focus indication and a defined border. Do not add springs, gesture listeners, or material blur layers.

- [ ] **Step 4: Run focused test to verify green**

Run: `node test_fixtures/test_ui_copy.mjs`

Expected: all UI-copy assertions pass.

- [ ] **Step 5: Run the full extension verification and commit**

Run: `node test_fixtures/test_shared.mjs && node test_fixtures/test_price_providers.mjs && node test_fixtures/test_ticker_render.mjs && node test_fixtures/test_popup_movers.mjs && node test_fixtures/test_content_script_classic.mjs && node test_fixtures/test_content_telemetry_bridge.mjs && node test_fixtures/test_ui_copy.mjs && node --check options.js && node --check popup.js && node --check shared.js && node -e 'JSON.parse(require("fs").readFileSync("manifest.json","utf8"));' && git diff --check`

Expected: all commands exit 0.

Commit only the four files above with: `fix: complete MyTicker Apple design accessibility polish`.
