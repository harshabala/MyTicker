# MyTicker UI · Product Voice · Typography Audit

**Date:** 2026-07-17  
**Worktree:** `feature/tape-layout-reservation`  
**Scope:** `options.html` / `options.js`, `popup.html` / `popup.js`, `brand.css`, tape-facing strings in `ticker.css` / `contentScript.js`  
**North star:** Quiet, local-first personal market companion — holdings → watchlist → crypto ambient tape with portfolio day P&L. Not a trading terminal, crypto toy, or multi-app dashboard.  
**Lenses:** Laws of UX (Fitts, progressive disclosure, proximity, cognitive load), Typography hierarchy, Visual design (Rare Metal gold, tabular nums, consistent spacing).

## Verdict

Product voice is largely correct after prior finish work: providers are named truthfully, Finnhub is US-only, crypto is CoinGecko/Binance, and the popup is holdings-first. This pass fixed remaining **Critical/Important** false claims and type-scale violations. Residual items are Medium density and polish.

| Severity | Count found | Fixed this pass | Residual |
|---|---:|---:|---:|
| Critical | 2 | 2 | 0 |
| Important | 7 | 7 | 0 |
| Medium | 8 | 0 | 8 |

## Findings

| Severity | Area | Finding | Fix applied | Residual |
|---|---|---|---|---|
| Critical | B Copy · `options.html` tips (~2583) | “Toggle the strip: **Use the popup** or shortcut” is false — popup no longer toggles the tape (gear → settings only). | **Yes.** Copy now: toggle via keyboard shortcut; popup is day P&L summary. | No |
| Critical | C Type · `options.html` `.btn-copy-entry` (~1198) | Chrome control used `font-size: 10px` (banned 9–10px chrome). | **Yes.** `var(--text-meta, 11px)`, weight 500, slightly taller padding. | No |
| Important | B Copy · `options.html` tips (~2595) | Claimed watchlist symbols/exchanges are selected **in the popup**; add flow lives on Settings → Watchlist. | **Yes.** Points to Watchlist tab; popup is review-only. | No |
| Important | A Product accuracy · `options.html` portfolio summary (~2215–2216) | Hardcoded **Broker: Zerodha** and **Exchange: NSE / BSE** misrepresent Groww/Upstox/US books. | **Yes.** Dynamic `#portfolioSummaryBroker` / `#portfolioSummaryExchange` from holdings via `updatePortfolioSummary` in `options.js`. | No |
| Important | C Type · `ticker.css` `.pts-group-marker` / `.pts-item-stale` | Group labels at **9px** and stale badge at **10px** (sub-meta chrome on the ambient tape). | **Yes.** Both `calc(11px * scale)`; section weight 600. Uppercase group labels keep letter-spacing. | No |
| Important | C Type · `options.html` section titles (~1296, ~1327) | `font-weight: 650` is non-standard; design scale is 600 sections / 700 primary. | **Yes.** Section titles and intros use **600**. | No |
| Important | D Gold · `options.html` selected settings tabs (~1280–1281) | Selected tab **label painted gold**. DESIGN: precision ink when selected + **one gold hairline** only. | **Yes.** Selected tab color → `var(--text-primary)`; gold underline retained. | No |
| Important | D Gold · `options.html` `.section-intro-mark` (~1314) | Phosphor intro glyphs tinted gold (decorative, not CTA/focus/selection). | **Yes.** Quiet ink `var(--text-secondary)`. | No |
| Important | C Type · `popup.html` `.header-left h1` | Primary product title used section weight (600), not display (700). | **Yes.** `font-weight: var(--weight-display)` (700). | No |
| Medium | B Copy · `options.html` crypto guidance (~2456) | Manual crypto help concatenates catalog, provider policy, and strip order into one dense paragraph (Miller overload). | No | Split into short bullets / progressive note later |
| Medium | D Density · Data & diagnostics | Composite Data panel still long; multiple open disclosures by default increase scan cost. | No | Default-collapse low-priority disclosures |
| Medium | C Type · settings meta | Mixed hard-coded `11px` / `12px` / `13px` vs token ramp (`--text-*`) in older CSS blocks. | No | Tokenize remaining sizes in a type-cleanup pass |
| Medium | D Fitts · diagnostics Copy buttons | `.btn-copy-entry` still under 40px target (now ~28px min-height). Practical for dense log rows. | Partial (no 10px text) | Optional 32px target if logs stay sparse |
| Medium | A Naming · popup gear | Accessible name is “Settings” (test-locked); not “MyTicker settings”. | No | Keep unless tests updated intentionally |
| Medium | B Copy · popup “View all →” | Opens full settings, not a full movers list. | No | Rename to “Open settings →” or deep-link Portfolio |
| Medium | B Voice · Data privacy foot | “Nothing leaves your browser” is slightly absolute vs required provider HTTP. Footer/privacy docs are more precise. | No | Soften to “portfolio stays on this device; quotes from named providers” |
| Medium | C Tape · `pts-aggregate` | `text-transform: lowercase` on day P&L aggregate is stylistic; OK but atypical for money. | No | Prefer normal case if users misread |

## Axes summary

### A. Product naming & function
- **Pass:** `MyTicker` / `MyTicker settings` titles; holdings-first tabs; tape/strip language mostly consistent after tip fixes.
- **Fixed:** Hardcoded Zerodha/NSE summary; false popup-as-watchlist/add surface.
- **Residual:** Gear label “Settings”; Data page “eyebrow MyTicker” is quiet branding (not gold title).

### B. Copy accuracy
- **Pass:** Yahoo India, Finnhub US, CoinGecko primary + Binance fallback; Coinbase/DeFiLlama explicitly not implemented; vault/local storage claims aligned with diagnostics policy.
- **Fixed:** Tape toggle path; watchlist configuration path.
- **Residual:** Crypto wall-of-text guidance; absolute privacy foot wording.

### C. Typography
- **Pass:** System SF stack via `--font-sans`; `font-synthesis: none`; tabular nums on market UI; weight tokens 400/500/600/700 defined in `brand.css`.
- **Fixed:** 9–10px chrome on settings copy button and tape markers; 650 → 600 sections; popup title 700.
- **Residual:** Incomplete rem/token adoption for legacy px ladder in `options.html`.

### D. Density & UX laws
- **Pass:** Finnhub key progressive disclosure; chunked settings tabs; gold for CTAs/focus/selection outlines; ≥32–40px on primary controls and toggles.
- **Fixed:** Selected tab text no longer competes as gold chrome; intro icons de-gilded.
- **Residual:** Data tab length; crypto guidance density; some compact log targets.

## Strong existing choices (do not regress)
- Provider truth enforced by `test_ui_copy.mjs`.
- Popup: single Settings gear, Holdings/Watchlist tabs, day P&L hierarchy.
- Gold links/CTAs with paired ink tokens; green/red reserved for market direction.
- US key nested closed by default; crypto modes Off / Top 5 / Manual.

## Implementation map (this pass)

| File | Change |
|---|---|
| `options.html` | Copy fixes; 11px copy button; weight 600 sections; selected tab primary ink; quiet intro marks; dynamic summary IDs |
| `options.js` | `updatePortfolioSummary` / broker & exchange formatters; wire load, import, clear, preview |
| `popup.html` | Primary title weight 700; help-row uses `--text-meta` |
| `popup.js` | Watchlist empty state names Settings → Watchlist |
| `ticker.css` | Group/stale chrome ≥11px scaled; weight 600 |

## Verification
```
node test_fixtures/test_ui_copy.mjs          # 165 passed
node test_fixtures/test_popup_movers.mjs     # passed
node --check options.js
node --check popup.js
node test_fixtures/test_ticker_render.mjs    # 40 passed
```

## Recommended next pass (Medium only)
1. Chunk crypto guidance into three short lines.
2. Soften absolute privacy footers where providers fetch quotes.
3. Tokenize remaining hard-coded font sizes in options chrome.
4. Rename “View all →” or deep-link Portfolio preview.
