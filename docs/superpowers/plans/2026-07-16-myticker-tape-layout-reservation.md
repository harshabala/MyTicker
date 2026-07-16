# MyTicker Tape Layout Reservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`. Steps use checkbox syntax for tracking.

**Goal:** Reserve page layout space for the tape and safely accommodate ChatGPT's app shell.

**Architecture:** Extend the content-script lifecycle with a small reservation manager. It owns inline body/root values and a scoped ChatGPT shell marker; tape height comes from measurement and changes are observed, not inferred from a visual preset.

**Tech Stack:** MV3 content script, DOM APIs (`ResizeObserver`), static Node fixture tests.

---

### Task 1: Measured reservation lifecycle and ChatGPT adapter

**Files:**
- Modify: `contentScript.js`
- Modify: `test_fixtures/test_ticker_render.mjs`

- [ ] Write fixture assertions for measured body reservation, root scroll padding/custom property, exact inline-style restoration, resize reconciliation, and ChatGPT-only shell lifecycle.
- [ ] Run `node test_fixtures/test_ticker_render.mjs` and confirm the assertions fail before implementation.
- [ ] Implement the minimal reservation manager: snapshot values, measure `tickerBar.getBoundingClientRect().height`, apply/restore body/root values, observe bar resize, and disconnect on teardown.
- [ ] Implement a selector-scoped ChatGPT adapter that adds/removes only a MyTicker-owned class or style marker. Do not use root transforms or enumerate fixed elements.
- [ ] Re-run the focused fixture and then the complete fixture/syntax/manifest/diff suite.
- [ ] Commit only task files with `fix: reserve layout for MyTicker tape`.
