// Regression harness for delayed page-body mounting in the content script.
// Run with: node test_fixtures/test_ticker_render.mjs

import { readFile } from "node:fs/promises";
import vm from "node:vm";

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: options.once });
    this.listeners.set(type, entries);
  }
  dispatchEvent(event) {
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      entry.listener(event);
      if (entry.once) this.listeners.set(event.type, this.listeners.get(event.type).filter((x) => x !== entry));
    }
  }
}

class StyleDeclaration {
  constructor() { this.properties = new Map(); this.priorities = new Map(); }
  setProperty(name, value, priority = "") { this.properties.set(name, String(value)); this.priorities.set(name, String(priority)); }
  getPropertyValue(name) { return this.properties.get(name) || ""; }
  getPropertyPriority(name) { return this.priorities.get(name) || ""; }
  removeProperty(name) { const value = this.getPropertyValue(name); this.properties.delete(name); this.priorities.delete(name); return value; }
  get marginTop() { return this.getPropertyValue("margin-top"); }
  set marginTop(value) { this.setProperty("margin-top", value); }
}

class Element extends EventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = new StyleDeclaration();
    this.className = "";
    this.classList = {
      add: (...names) => { this.className = `${this.className} ${names.join(" ")}`.trim(); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      toggle: (name, force) => { if (force) this.classList.add(name); else this.classList.remove(name); }
    };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, before) {
    child.parentNode = this;
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  attachShadow() { this.shadowRootForTest = new Element("shadow-root"); return this.shadowRootForTest; }
  getBoundingClientRect() { return { top: 0, height: 0 }; }
  get offsetHeight() { return 0; }
  get offsetWidth() { return 0; }
  get textContent() { return this._textContent || this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._textContent = String(value); this.children = []; }
}

class TestDocument extends EventTarget {
  constructor() {
    super();
    this.documentElement = new Element("html");
    this.body = null;
  }
  createElement(tagName) { return new Element(tagName); }
  querySelector(selector) {
    if (selector === "main") return this.chatgptShell;
    return selector === "dialog[open]" && this.chatgptDialog?.hasAttribute("open") ? this.chatgptDialog : null;
  }
}

const state = {
  displayCurrency: "USD",
  aggregate: { dayPnl: 0, dayPnlPct: 0 },
  tickerItems: [
    { kind: "holding", symbol: "RELIANCE.NS", displayName: "Reliance", lastPrice: 1450, dayPnl: 25, dayPnlPct: 0.5, currency: "INR" },
    { kind: "holding", symbol: "MSFT", displayName: "Microsoft", lastPrice: 480, dayPnl: 25, dayPnlPct: -0.5, currency: "USD", stale: true },
    { kind: "watchlist", symbol: "AAPL", displayName: "Apple", lastPrice: 210, changePct: 1.5, currency: "USD" },
    { kind: "crypto", symbol: "bitcoin", displayName: "Bitcoin", lastPrice: 65000, changePct: 1.5, currency: "USD", assetClass: "crypto" }
  ]
};
const requestedTapeSize = process.env.TAPE_SCALE === "compact" ? "compact" : "large";
const lifecycleMessages = [];
let settingsChangeListener;
let resizeObserver;
let documentObserver;
globalThis.document = new TestDocument();
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.location = { hostname: "chatgpt.com", origin: "https://chatgpt.com" };
globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.disconnected = false; resizeObserver = this; }
  observe(target) { this.target = target; }
  disconnect() { this.disconnected = true; }
};
globalThis.MutationObserver = class {
  constructor(callback) { this.callback = callback; this.disconnected = false; documentObserver = this; }
  observe(target, options) { this.target = target; this.options = options; }
  disconnect() { this.disconnected = true; }
  trigger(records) { this.callback(records, this); }
};
globalThis.getComputedStyle = (element) => ({
  marginTop: element.style.getPropertyValue("margin-top") || "0px",
  position: element.style.getPropertyValue("position") || "static"
});
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.setTimeout = (callback) => { callback(); return null; };
globalThis.clearTimeout = () => {};
globalThis.chrome = {
  runtime: {
    getURL: (path) => path,
    sendMessage: (message) => lifecycleMessages.push(message)
  },
  storage: {
    sync: { get: (_keys, callback) => callback({ pts_settings: { enabled: true, tickerStyleConfig: { tapeScale: requestedTapeSize } } }) },
    local: { get: (_keys, callback) => callback({ pts_positions_state: state }) },
    onChanged: { addListener(listener) { settingsChangeListener = listener; } }
  }
};

const contentSharedSource = await readFile(new URL("../contentShared.js", import.meta.url), "utf8");
vm.runInThisContext(contentSharedSource, { filename: "contentShared.js" });

const tickerCss = await readFile(new URL("../ticker.css", import.meta.url), "utf8");
console.log("\n🎨 reduced-transparency theme fallback");
const reducedTransparencyBlock = tickerCss.match(/@media \(prefers-reduced-transparency: reduce\) \{([\s\S]*)\n\}/)?.[1] || "";
assert(reducedTransparencyBlock.includes("background: var(--pts-bg"), "uses the semantic tape background when reduced transparency is requested");
assert(!/prefers-color-scheme: (?:dark|light)[\s\S]*background:\s*#(?:000000|ffffff)/.test(reducedTransparencyBlock), "does not override an explicit tape theme with OS-scheme black or white");
assert(tickerCss.includes('.pts-ticker-bar[data-theme="light"]') && tickerCss.includes('.pts-ticker-bar[data-theme="dark"]'), "defines explicit light and dark tape tokens while system mode continues to follow the OS");

await import(`../contentScript.js?test=${Date.now()}`);
document.body = new Element("body");
document.body.getBoundingClientRect = () => ({ top: 999 });
document.body.style.setProperty("margin-top", "12px", "important");
document.documentElement.style.setProperty("scroll-padding-top", "7px", "important");
document.documentElement.style.setProperty("--myticker-tape-reservation", "18px", "important");
document.chatgptShell = new Element("main");
document.chatgptShell.id = "myticker-chatgpt-shell";
document.documentElement.appendChild(document.body);
document.dispatchEvent({ type: "DOMContentLoaded" });

const host = document.documentElement.children.find((child) => child.id === "pts-ticker-container");
const rendered = host?.shadowRootForTest?.textContent || "";
console.log("\n📟 delayed ticker mount");
assert(Boolean(host), "mounts after the body becomes available");
assert(host?.shadowRootForTest?.children.find((child) => child.className.includes("pts-ticker-bar"))?.getAttribute("data-tape-size") === requestedTapeSize, `applies the selected ${requestedTapeSize} tape size to the tape root`);
const tickerBar = host?.shadowRootForTest?.children.find((child) => child.className.includes("pts-ticker-bar"));
const tickerParts = tickerBar?._ptsParts;
tickerBar.getBoundingClientRect = () => ({ top: 0, height: 53 });
resizeObserver?.callback();
assert(tickerParts?.scrollWrapper?.getAttribute("tabindex") === "0" && tickerParts.scrollWrapper.getAttribute("role") === "group" && tickerParts.scrollWrapper.getAttribute("aria-label"), "provides a labelled focusable tape strip so keyboard focus pauses the marquee");
assert(document.body.style.marginTop === "65px", "reserves the measured tape height in addition to the original body margin");
assert(document.documentElement.style.getPropertyValue("scroll-padding-top") === "53px" && document.documentElement.style.getPropertyValue("--myticker-tape-reservation") === "53px", "publishes the measured reservation to browser scrolling and the document custom property");
assert(document.body.style.getPropertyPriority("margin-top") === "important" && document.documentElement.style.getPropertyPriority("scroll-padding-top") === "important" && document.documentElement.style.getPropertyPriority("--myticker-tape-reservation") === "important", "owns active reservation styles with important priority");
assert(document.chatgptShell.className === "" && document.chatgptShell.style.getPropertyValue("padding-top") === "", "leaves the normal-flow ChatGPT main shell unchanged");
assert(!document.documentElement.className.includes("myticker-chatgpt-tape-reserved"), "does not apply the ChatGPT adapter to the document root");
assert(Boolean(resizeObserver?.target) && Boolean(documentObserver?.target), "observes tape size and document lifecycle changes");
assert(documentObserver?.options?.attributes && documentObserver.options.attributeFilter?.includes("open"), "observes dialog open attribute changes without polling");
document.chatgptDialog = new Element("dialog");
document.chatgptDialog.setAttribute("open", "");
document.chatgptDialog.style.setProperty("position", "fixed");
document.chatgptDialog.style.setProperty("top", "2px", "important");
document.chatgptDialog.style.setProperty("inset", "1px", "important");
document.chatgptDialog.style.setProperty("height", "90vh", "important");
document.chatgptDialog.getBoundingClientRect = () => ({ top: 20, left: 20, width: 400, height: 300, right: 420, bottom: 320 });
documentObserver?.trigger([{ type: "attributes", attributeName: "open", target: document.chatgptDialog }]);
assert(!document.chatgptDialog.className.includes("myticker-chatgpt-tape-reserved") && document.chatgptDialog.style.getPropertyValue("inset") === "1px", "leaves a small fixed open dialog entirely untouched");
document.chatgptDialog.getBoundingClientRect = () => ({ top: 0, left: 0, width: 1200, height: 800, right: 1200, bottom: 800 });
documentObserver?.trigger([{ type: "attributes", attributeName: "open", target: document.chatgptDialog }]);
assert(document.chatgptDialog.className.includes("myticker-chatgpt-tape-reserved") && document.chatgptDialog.style.getPropertyValue("inset") === "53px 0 0", "offsets only the open full-screen ChatGPT dialog once");
assert(document.chatgptDialog.style.getPropertyPriority("inset") === "important" && document.chatgptDialog.style.getPropertyPriority("height") === "important", "owns active dialog offsets with important priority");
document.chatgptDialog.getBoundingClientRect = () => ({ top: 53, left: 0, width: 1200, height: 747, right: 1200, bottom: 800 });
tickerBar.getBoundingClientRect = () => ({ top: 0, height: 61 });
resizeObserver?.callback();
assert(document.body.style.marginTop === "73px" && document.documentElement.style.getPropertyValue("scroll-padding-top") === "61px", "reconciles the layout reservation when the measured tape height changes");
assert(document.chatgptDialog.style.getPropertyValue("inset") === "61px 0 0" && document.chatgptDialog.style.getPropertyValue("height") === "calc(100% - 61px)", "updates the dialog offset once when the tape resizes");
document.chatgptDialog.getBoundingClientRect = () => ({ top: 61, left: 0, width: 1200, height: 739, right: 1200, bottom: 800 });
documentObserver?.trigger([{ type: "attributes", attributeName: "open", target: document.chatgptDialog }]);
assert(document.chatgptDialog.className.includes("myticker-chatgpt-tape-reserved") && document.chatgptDialog.style.getPropertyValue("inset") === "61px 0 0", "retains the tracked dialog reservation during document reconciliation after it shifts");
document.chatgptDialog.removeAttribute("open");
documentObserver?.trigger([{ type: "attributes", attributeName: "open", target: document.chatgptDialog }]);
assert(!document.chatgptDialog.className.includes("myticker-chatgpt-tape-reserved") && document.chatgptDialog.style.getPropertyValue("top") === "2px" && document.chatgptDialog.style.getPropertyPriority("top") === "important", "restores the dialog exactly when it closes");
const previousBody = document.body;
const previousResizeObserver = resizeObserver;
document.body = new Element("body");
document.body.getBoundingClientRect = () => ({ top: 700 });
document.body.style.setProperty("margin-top", "9px", "important");
document.documentElement.appendChild(document.body);
documentObserver?.trigger([{ type: "childList", target: document.documentElement }]);
assert(previousBody.style.marginTop === "12px" && document.body.style.marginTop === "70px" && previousResizeObserver.disconnected, "restores the replaced body and moves reservation ownership to the new body");
assert(rendered.includes("Apple"), "renders cached ticker item after delayed mount");
assert(rendered.includes("210.00"), "renders cached current price after delayed mount");
assert(rendered.includes("₹1,450.00"), "renders Indian holdings in rupees");
assert(rendered.includes("$480.00") && rendered.includes("$65,000.00"), "renders US and crypto items in dollars");
assert(rendered.includes("holdings") && rendered.includes("watchlist"), "marks ticker group boundaries");
assert(rendered.includes("p&l") && !rendered.includes("p&l $0.00"), "shows personal P&L only for holdings");
assert(rendered.includes("stale"), "shows an item-level stale indicator");

console.log("\n📡 content lifecycle telemetry");
const contentStages = lifecycleMessages
  .filter((message) => message.type === "content-script-lifecycle")
  .map((message) => message.payload?.stage);
assert(contentStages.includes("loaded"), "reports that the content script loaded");
assert(contentStages.includes("storage-settings-read"), "reports that settings were read");
assert(contentStages.includes("mount-success"), "reports successful ticker mounting");
assert(contentStages.includes("render-success"), "reports successful ticker rendering");

settingsChangeListener({ pts_settings: { newValue: { enabled: false } } }, "sync");
document.body.dispatchEvent({ type: "transitionend", propertyName: "margin-top" });
assert(document.body.style.marginTop === "9px", "restores the original page offset after the tape is disabled");
assert(document.documentElement.style.getPropertyValue("scroll-padding-top") === "7px" && document.documentElement.style.getPropertyValue("--myticker-tape-reservation") === "18px", "restores original document inline reservation values exactly");
assert(document.body.style.getPropertyPriority("margin-top") === "important" && document.documentElement.style.getPropertyPriority("scroll-padding-top") === "important" && document.documentElement.style.getPropertyPriority("--myticker-tape-reservation") === "important", "restores inline reservation priorities exactly");
assert(Boolean(resizeObserver?.disconnected) && Boolean(documentObserver?.disconnected), "cleans up the dialog adapter and both observers when disabled");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
