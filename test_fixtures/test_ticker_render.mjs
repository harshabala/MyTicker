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

class Element extends EventTarget {
  constructor(tagName) {
    super();
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = { setProperty() {} };
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
  getBoundingClientRect() { return { top: 0 }; }
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
const lifecycleMessages = [];
globalThis.document = new TestDocument();
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.chrome = {
  runtime: {
    getURL: (path) => path,
    sendMessage: (message) => lifecycleMessages.push(message)
  },
  storage: {
    sync: { get: (_keys, callback) => callback({ pts_settings: { enabled: true, tickerStyleConfig: { tapeScale: "large" } } }) },
    local: { get: (_keys, callback) => callback({ pts_positions_state: state }) },
    onChanged: { addListener() {} }
  }
};

const contentSharedSource = await readFile(new URL("../contentShared.js", import.meta.url), "utf8");
vm.runInThisContext(contentSharedSource, { filename: "contentShared.js" });

await import(`../contentScript.js?test=${Date.now()}`);
document.body = new Element("body");
document.documentElement.appendChild(document.body);
document.dispatchEvent({ type: "DOMContentLoaded" });

const host = document.documentElement.children.find((child) => child.id === "pts-ticker-container");
const rendered = host?.shadowRootForTest?.textContent || "";
console.log("\n📟 delayed ticker mount");
assert(Boolean(host), "mounts after the body becomes available");
assert(host?.shadowRootForTest?.children.find((child) => child.className.includes("pts-ticker-bar"))?.getAttribute("data-tape-size") === "large", "applies the selected tape size to the tape root");
assert(rendered.includes("Apple"), "renders cached ticker item after delayed mount");
assert(rendered.includes("210.00"), "renders cached current price after delayed mount");
assert(rendered.includes("₹1,450.00"), "renders Indian holdings in rupees");
assert(rendered.includes("$480.00") && rendered.includes("$65,000.00"), "renders US and crypto items in dollars");
assert(rendered.includes("holdings") && rendered.includes("watchlist"), "marks ticker group boundaries");
assert(rendered.includes("p&l") && !rendered.includes("p&l $0.00"), "shows personal P&L only for holdings");
assert(rendered.includes("stale"), "shows an item-level stale indicator");

console.log("\n📡 content lifecycle telemetry");
const contentStages = lifecycleMessages
  .filter((message) => message.action === "content-script-lifecycle")
  .map((message) => message.stage);
assert(contentStages.includes("loaded"), "reports that the content script loaded");
assert(contentStages.includes("storage-settings-read"), "reports that settings were read");
assert(contentStages.includes("mount-success"), "reports successful ticker mounting");
assert(contentStages.includes("render-success"), "reports successful ticker rendering");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
