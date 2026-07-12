# Brand — MyTicker

Live stock & crypto ticker strip with portfolio P&L on every browser tab.

## Identity

**Quiet finance utility.** Ambient companion under the browser chrome — not a dashboard, not a memecoin toy.

**Personality:** Precise · high-utility · restrained · Obsidian Gold  

## Palette — Obsidian Gold

| Role | Hex | Use |
|------|-----|-----|
| bg | `#000000` | Canvas |
| surface | `#1C1C1E` | Grouped lists |
| hover | `#2C2C2E` | Hover |
| text | `#F5F5F7` | Primary |
| text-2 | `#98989D` | Secondary |
| text-3 | `#636366` | Meta |
| gold | `#D4C08A` | **Rare:** primary CTA + focus only |
| gold-pressed | `#9A8550` | Pressed |
| up / down | `#30D158` / `#FF453A` | P&L deltas only |

**Do not** paint section titles gold. **Do not** use multi-stop gradients on chrome.

## Typography

System SF Pro stack. Rem ladder in `brand.css`. Tabular nums for money. No 9–10px chrome.

## Surfaces

Hairline borders + inset catch-light only. No soft floating drop shadows. Strip may use translucent near-black + blur with solid fallback.

## Motion

Ease-out only (100–280ms). No bounce, no infinite pulse, no gold shimmer sweeps.

## Files

| File | Role |
|------|------|
| `brand.css` | Tokens |
| `motion.css` | Motion |
| `ticker.css` | Injected strip |
| `popup.html` / `options.html` | Surfaces |
| `icons/` | Extension icons (16/32/48/128) |
