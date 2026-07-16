# MyTicker tape layout reservation

## Goal

Keep the live market tape visible without covering page content, while avoiding unsafe page-wide transforms.

## Decision

MyTicker will use a measured page-reservation layer whenever the tape is enabled. It will retain the page's pre-existing body margin, add the rendered tape height, and expose the same value as a document-level custom property plus `scroll-padding-top`. The reservation is applied and restored only by MyTicker's lifecycle.

The extension will not transform the root or blanket-adjust arbitrary fixed elements. Fixed website chrome is viewport-anchored and cannot be reflowed generically without breaking modals and application shells. Instead, a narrowly scoped ChatGPT adapter will shift its known top-level app shell only when the tape is active, and will fully restore it on disable.

## Behavior

- Measure the actual tape height from the rendered bar, not a hard-coded scale estimate.
- Apply `body` top margin as original margin plus tape height; apply `documentElement` `scroll-padding-top` and a `--myticker-tape-reservation` custom property.
- Maintain captured original inline values and restore them exactly when disabled or the page body is replaced.
- Apply the adapter only to `chatgpt.com` and `chat.openai.com`, only after the reservation is active, and never to dialogs or arbitrary fixed descendants.
- Use a `ResizeObserver` to reconcile visual tape size changes. Disconnect it and remove any adapter state on teardown.
- Keep reduced-motion behavior non-animated.

## Validation

Content-script fixtures cover measured reservation, exact restoration, resize updates, browser scroll-padding, and ChatGPT-only adapter application/cleanup. Existing full fixtures, syntax checks, manifest parsing, and whitespace checks remain required.
