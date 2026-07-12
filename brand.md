# Brand — MyTicker

Live stock & crypto ticker strip with portfolio P&L on every browser tab.

## Identity

**Quiet finance utility.** Ambient companion under the browser chrome — not a dashboard, not a memecoin toy.

**Personality:** Precise · high-utility · restrained · Obsidian Gold  

## Palette — Obsidian Gold

Auto: `@media (prefers-color-scheme: light|dark)` in `brand.css` and `ticker.css`.

| Role | Dark | Light |
|------|------|-------|
| bg | `#000000` | `#F5F5F7` |
| surface | `#1C1C1E` | `#FFFFFF` |
| text | `#F5F5F7` | `#1D1D1F` |
| gold | `#D4C08A` | `#9A8550` |
| up / down | `#30D158` / `#FF453A` | `#248A3D` / `#D70015` |

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
