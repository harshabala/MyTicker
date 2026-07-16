// Regression harness for native currencies in popup mover rows.
// Run with: node test_fixtures/test_popup_movers.mjs

class Element {
  constructor() {
    this.children = [];
    this.className = "";
    this._textContent = "";
  }
  append(...children) { this.children.push(...children); }
  set textContent(value) { this._textContent = String(value); this.children = []; }
  get textContent() { return this._textContent || this.children.map((child) => child.textContent).join(""); }
}

globalThis.document = {
  addEventListener() {},
  createElement() { return new Element(); }
};

const { buildMoverItem } = await import(`../popup.js?test=${Date.now()}`);
const indianMover = buildMoverItem({ symbol: "RELIANCE.NS", displayName: "Reliance", dayPnl: 25, dayPnlPct: 1, currency: "INR" });
const usMover = buildMoverItem({ symbol: "MSFT", displayName: "Microsoft", dayPnl: 25, dayPnlPct: 1, currency: "USD" });

let failed = 0;
function assert(condition, message) {
  if (condition) console.log(`  ✅ ${message}`);
  else { failed++; console.error(`  ❌ ${message}`); }
}

console.log("\n💱 popup mover currencies");
assert(indianMover.textContent.includes("₹25.00"), "Indian mover uses INR even with no aggregate currency");
assert(usMover.textContent.includes("$25.00"), "US mover uses USD even with no aggregate currency");
console.log(`\n${failed ? "failed" : "passed"}`);
process.exit(failed ? 1 : 0);
