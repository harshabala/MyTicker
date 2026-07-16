# MyTicker Final Refinement Design

## Objective

Turn the working market tape into a coherent, readable, and configurable product. The refinement prioritizes truthful pricing, discoverable market controls, system-aware visual design, and a stable editorial foundation for future copy review.

## Currency model

Quotes display in their native market currency. There is no synthetic portfolio-wide conversion in this release.

- NSE/BSE instruments render in INR (`₹`).
- US instruments render in USD (`$`).
- Crypto renders in its provider quote currency, initially USD.
- Currency travels with every normalized ticker item and is used both in the strip and popup/watchlist displays.
- Portfolio P&L continues to use its source holding currency. A mixed-currency aggregate is never silently presented as one currency.

## Market tape

The tape remains page-level browser content, not browser chrome. Its default density increases by 8% from the current Obsidian baseline so it remains readable on normal high-density laptop displays without becoming a banner.

### Scale control

Appearance contains a **Tape size** control with three explicit choices:

- Compact — 0.92×
- Comfortable — 1.08× (default)
- Large — 1.20×

The setting changes the bar height, type scale, item spacing, and status marker coherently through CSS custom properties. It does not change data order or polling. Reduced-motion keeps the tape static and horizontally scrollable at every scale.

## Information architecture

Settings becomes task-based:

1. **Portfolio** — import, holdings preview, portfolio currency context.
2. **Watchlist** — searchable add/remove experience for stocks, ETFs, indices, and supported crypto.
3. **Crypto** — enable/disable, top five/manual selection, provider explanation, source status.
4. **Data & diagnostics** — Yahoo/Finnhub/CoinGecko/Binance status, refresh settings, diagnostics, and safe lifecycle log.
5. **Appearance** — system/light/dark behavior, tape size, motion, and visual density.

The popup opens to Holdings. It keeps a watchlist tab and presents the tape state, but does not duplicate the full configuration interface.

## Search and add flows

Watchlist and crypto use progressive disclosure rather than a free-form, ambiguous symbol field.

- A search/add field provides an asset-type choice: India, US, index/ETF, or crypto.
- India accepts NSE/BSE symbol input and normalizes the exchange suffix.
- US/index/ETF accepts canonical provider symbols and explains that a Finnhub key is required for US prices.
- Crypto accepts a searchable supported list with canonical CoinGecko IDs and display symbols; supported defaults include BTC, ETH, BNB, XRP, and SOL.
- Invalid or unsupported input remains inline with a specific correction, never silently disappears.

## Brand, theme, and type

**MyTicker** is the canonical product name everywhere, retaining the capital M and T.

- Theme follows system preference by default, with explicit light/dark override in Appearance.
- Neutral surfaces are graphite in dark mode and cool white/slate in light mode.
- Emerald is reserved for positive movement and live status. Negative movement uses a controlled coral/red semantic value. Gold is not used as an arbitrary control fill.
- The UI uses one spacing scale and divider-led grouping rather than excessive cards.
- Financial values use tabular figures.

Type hierarchy:

| Role | Weight | Use |
| --- | ---: | --- |
| Product/display heading | 700 | MyTicker, primary metric, dialog title |
| Section heading | 600 | Settings section, market group |
| Interactive label | 500 | Tabs, buttons, input labels |
| Body | 400 | Helper text, descriptions |
| Metadata | 500 | Timestamps, provider state, captions |
| Financial data | 500–600 | Prices, percent movement, P&L |

Font synthesis is disabled; numeric regions use tabular figures and antialiased system typography.

## States and accessibility

- Controls preserve visible labels, keyboard focus, and contrast-safe states.
- User-triggered motion remains under 300ms and content-refresh motion is restrained.
- The tape pauses on hover and keyboard focus; reduced motion removes marquee animation.
- Empty, loading, unavailable, and stale states are explicit and not color-only.
- Interactive targets meet a 32px minimum target size.

## Verification and design audits

After implementation, run focused audits using Impeccable, frontend design guidance, Apple design guidance, and the UI wiki. Remediate actionable issues before release. Audit scope includes theme consistency, motion, typography hierarchy, control sizing, contrast, feedback states, and the tape at each size setting.

## Editorial and IA handoff

After the audit/remediation pass, create two reviewable Markdown artifacts:

1. `docs/content-inventory.md` — every visible string, location, context, and internal rationale for its wording.
2. `docs/information-architecture.md` — navigation map, settings hierarchy, popup/tape structure, user flows, ownership of each screen, and the reason for each grouping.

## Acceptance criteria

1. Indian holdings display INR values in the tape and relevant UI.
2. The tape default is visibly more readable than v0.5.0 and supports Compact, Comfortable, and Large settings.
3. Users can search/add supported watchlist and crypto instruments with clear validation.
4. The Crypto page visibly identifies CoinGecko primary and Binance fallback; it does not claim Coinbase or DeFiLlama integration.
5. MyTicker branding, theme tokens, typography weights, and control styles are coherent across popup, settings, diagnostics, and tape.
6. System, light, and dark modes render with readable contrast.
7. The design audits have no outstanding actionable findings.
8. The content inventory and IA documents are complete and traceable to visible UI.
