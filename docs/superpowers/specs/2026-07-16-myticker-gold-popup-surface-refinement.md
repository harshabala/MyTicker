# MyTicker Gold Popup and Surface Refinement

## Objective

Make the popup a calm, portfolio-first overview and extend its obsidian-and-gold visual language across Settings without weakening the extension's market-data semantics or accessibility.

## Popup scope

The popup has exactly two user tasks:

1. Review holdings, daily P&L, and top movers.
2. Review watchlist quotes and remove an unwanted item.

The popup must not add or configure market instruments, configure crypto, toggle the page-level tape, or carry appearance controls.

- Remove the header `+` control, quick-add sheet, associated quick-add input/logic, and popup quick-add copy.
- Keep the Watchlist tab as a compact read-only quote list with asset/currency metadata, price/change, freshness state, and a labelled remove action.
- Remove the `Ticker strip` card, tape toggle, update/local-only footer, and popup shortcut footer. Tape visibility, size, speed, and theme live only in Settings → Appearance.
- Retain one header action: an accessible, recognisable gear icon labelled `Settings`, opening the Settings page.
- Keep Holdings as the default tab, then the daily P&L summary and Top movers. The visual order is header → tabs → summary → movers.

## Gold-led MyTicker visual system

Gold is a deliberate MyTicker brand accent, anchored by the existing obsidian-and-gold app icon. It is not a market-performance color.

- Use a restrained gold token for active tab underline, primary CTA/selected controls, focus treatment, and explanatory/action links such as `How P&L is calculated`.
- Use graphite/obsidian for dark neutral surfaces and cool white/near-white for light surfaces. Apply the same semantic token names across popup, Settings, and tape where applicable.
- Reserve green for positive movement and live state; reserve coral/red for negative movement. Do not use gold to represent gains, losses, or quote freshness.
- Remove slate-blue as the generic interaction brand accent in favour of the gold token. Gold should be used as accents and selected controls, never as broad section wallpaper or a multi-stop gradient.

## Surface and type application

The third supplied reference establishes the tonal direction, not a pixel-for-pixel desktop-only template.

- Popup: icon and `MyTicker` header, gear action, two tabs with a gold active underline, a single summary panel, a separate movers panel, clear divider-led rows, and a compact shortcut hint only when it is still useful and not competing with core information.
- Settings: retain the five task sections and existing product flows; apply the same gold selected tab/control/link treatment, border-led grouping, consistent panel radius, and less visual competition between secondary content.
- Use system typography with the existing hierarchy: product/primary metric 700, section 600, labels/metadata 500, body 400, and tabular figures for financial values. Do not introduce a decorative display font.
- Keep system/light/dark mode. Explicit theme selection wins over system; both modes must maintain readable gold contrast.

## Accessibility and motion

- All retained interactive controls must have visible focus treatment, labels, and at least 32px target size.
- The gear uses an SVG with `aria-hidden="true"` and an accessible button label.
- Settings retains its keyboard tab behavior; popup retains valid Holdings/Watchlist tab panels and Arrow/Home/End navigation.
- Reduced-transparency renders solid surfaces; reduced-motion removes nonessential transition/scroll motion.
- Empty, stale, unavailable, loading, and mixed-currency states remain explicit and not color-only.

## Non-goals

- Do not move the tape into browser chrome; it remains page-level content.
- Do not add Coinbase, DeFiLlama, or a new provider.
- Do not remove Settings Watchlist/Crypto configuration or change quote/provider data behavior.
- Do not convert currencies.

## Acceptance criteria

1. Popup has no quick-add control or ticker-strip toggle; Settings owns those configuration actions.
2. Watchlist popup supports review and removal only.
3. The only popup header action is a labelled gear that opens Settings.
4. Popup and Settings visibly use the same restrained MyTicker gold accent system, while green/red remain financial/live semantics.
5. Holdings view retains daily P&L and movers as the primary information hierarchy.
6. Existing tests cover removed popup controls, gear semantics, watchlist read-only behavior, gold tokens, and existing keyboard/theme contracts.
