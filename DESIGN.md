---
name: MyTicker
description: A precise, local-first market companion that stays quiet while you browse.
colors:
  obsidian: "#0c0c0d"
  surface: "#18181a"
  ink: "#f5f5f7"
  muted-ink: "#98989d"
  gold: "#c99724"
  gold-hover: "#e0ae36"
  gain: "#34d399"
  loss: "#ff453a"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
rounded:
  sm: "8px"
  md: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "#17120a"
    rounded: "{rounded.sm}"
    padding: "10px 16px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.sm}"
    size: "32px"
---

# Design System: MyTicker

## Overview

**Creative North Star: "Obsidian Gold Instrument Panel"**

MyTicker is a precise, local-first market companion. It uses calm obsidian surfaces, thin separators, tabular data, and a rare gold signal for deliberate action. The popup should feel like browser chrome with market intelligence, never like a miniature trading terminal.

Gold is a scarce interaction metal; green and red remain market semantics. The system rejects purple gradients, blue grid meshes, hero-metric billboards, generic card grids, and TV-news ticker energy.

## Colors

Obsidian carries the canvas; gold is reserved for action, focus, and current selection.

### Primary
- **Rare Metal Gold** (`#c99724`): primary actions, focused controls, and selected tab underlines only.

### Neutral
- **Obsidian** (`#0c0c0d`): primary dark background.
- **Instrument Surface** (`#18181a`): popup and settings surfaces.
- **Precision Ink** (`#f5f5f7`): primary text and market data.
- **Quiet Ink** (`#98989d`): supporting labels only.

### Named Rules
**The Rare Metal Rule.** Gold does not decorate containers, headings, or passive status; it communicates action, focus, and selection.

## Typography

**Display Font:** system SF-style sans stack.
**Body Font:** system SF-style sans stack.
**Label/Mono Font:** system sans; use tabular numerals for all market values.

The hierarchy is compact and utility-led: 700 for one primary value or title, 600 for sections, 500 for labels, and 400 for supporting copy.

## Elevation

The system is flat by default. Depth comes from tonal layering, thin borders, and restrained inset highlights rather than soft floating shadows. No decorative glass surfaces or broad drop shadows.

## Components

### Buttons
- **Shape:** 8px radius; 32px minimum target for icon-only controls.
- **Primary:** rare-metal gold with dark ink; `10px 16px` padding.
- **Quiet:** transparent surface with border, quiet ink, and gold hover/focus treatment.
- **Iconography:** Phosphor is the exclusive source. Use `weight="regular"` at 20px by default, 16px in compact contexts, `fill` only for selected navigation, and `bold` only for optical correction. Every icon-only control has an accessible label and tooltip.

### Cards / Containers
- **Corner Style:** 12px for grouped content, never oversized.
- **Background:** tonal surface with a thin border; no decorative shadow.
- **Internal Padding:** 16px standard, 24px for settings forms.

### Navigation
- Tabs use quiet ink by default, precision ink when selected, and one gold hairline as the selection cue. Icons never replace clear labels in the popup’s two-tab navigation.

## Do's and Don'ts

### Do:
- **Do** use Phosphor icons as the single icon family and align them to the 4px spacing system.
- **Do** use gold for CTAs, focus rings, and selected states; use green and red only for market direction.
- **Do** keep popup controls browser-native in scale and density.
- **Do** make reduced-motion changes immediate where movement is not necessary.

### Don't:
- **Don't** use AI-purple gradient glows or blue grid meshes.
- **Don't** use centered layout hero blocks in settings or popup.
- **Don't** use tiny uppercase tracked kicker eyebrows, identical card grids, or TV-news marquee energy.
- **Don't** use gold section titles, multi-stop chrome gradients, or full-saturation inactive controls.
- **Don't** mix Lucide, Heroicons, Font Awesome, emoji, or hand-drawn icons with Phosphor.
