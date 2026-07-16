# MyTicker Settings Form Cadence Refinement

## Objective

Correct the Settings form layout, manual-crypto selection flow, and save feedback so Watchlist, Crypto, and Appearance share one deliberate, readable interaction system. Replace the popup header artwork with an unmistakable settings gear.

## Form cadence

Settings uses a consistent form-card rhythm rather than relying on bare neighbouring elements.

- Every configurable card has 24px internal padding.
- A field stack has 16px vertical gaps; a label sits 8px above its control; helper/error text sits 8px below it.
- Divided groups have 20–24px vertical padding on both sides of the divider.
- Buttons have their own action row with 16px top margin; status/empty/configured content begins at least 16px below that row.
- Inputs/selects occupy the available row width and never sit inline against their label unless the pattern deliberately communicates a compact choice.
- Empty/configured state becomes a padded, muted inset/list state, not text against the outer card edge.

## Watchlist

Watchlist remains Settings-only for adding items.

1. Market selector.
2. Conditional exchange selector for India.
3. Symbol or crypto input, plus its helper/validation message.
4. Add action row.
5. Padded configured/empty list state.

The selected market updates the input hint; validation remains inline. Adding an item refreshes the configured list without collapsing the form or placing text against a divider.

## Crypto manual mode

Manual is a contained selection region, displayed only when Manual mode is selected:

1. Search input.
2. Filtered canonical results in a compact wrap/grid of real Add buttons.
3. Selected holdings as removable chips in their own padded row.
4. Short provider/order guidance below the selection area.
5. Save action row.

Results and selected chips never share the same unstructured text flow. All state remains local until Save.

## Save feedback

Crypto and Appearance use persistent action feedback:

- Default label: `Save`.
- After a successful persistence: `Saved ✓` with semantic success treatment.
- Any relevant field/input/mode/chip/toggle change resets the label to `Save` before another save.
- Keep the existing toast only as a secondary transient confirmation; the button itself remains the durable local acknowledgement.

## Popup gear

The popup header retains one Settings action. It uses a standard cog/gear SVG silhouette (outer teeth plus central circular opening), `aria-hidden="true"`, and retains the accessible button name `Settings`.

## Non-goals

- No provider/data-routing changes.
- No change to tape placement, native currency, or settings task hierarchy.
- No popup Watchlist adding; it remains review/remove-only.

## Acceptance criteria

1. Watchlist form labels, controls, helper text, action row, and empty/configured state have measurable shared spacing.
2. Manual crypto results and chips are separately contained and visually stable.
3. Crypto and Appearance buttons visibly stay `Saved ✓` after a save and reset on change.
4. Popup Settings action uses a real gear icon.
5. Keyboard/focus, light/dark/reduced-motion, and current validation behavior remain intact.
