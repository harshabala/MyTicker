// Regression harness for native currencies in popup mover rows.
// Run with: node test_fixtures/test_popup_movers.mjs

class Element {
  constructor() {
    this.children = [];
    this.className = "";
    this._textContent = "";
    this.dataset = {};
    this.hidden = false;
    this.classList = {
      toggle: (name, force) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        if (force) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      }
    };
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = children; this._textContent = ""; }
  setAttribute() {}
  addEventListener() {}
  querySelector(selector) {
    const matches = (node) => selector.startsWith(".")
      ? node.className.split(/\s+/).includes(selector.slice(1))
      : selector === "[data-five-value]" ? node.dataset.fiveValue === "1"
        : selector === "[data-holdings-count]" ? node.dataset.holdingsCount === "1"
          : false;
    const visit = (node) => matches(node) ? node : node.children.map(visit).find(Boolean);
    return visit(this);
  }
  set textContent(value) { this._textContent = String(value); this.children = []; }
  get textContent() { return this._textContent || this.children.map((child) => child.textContent).join(""); }
  set innerHTML(value) { this.textContent = value; }
}

globalThis.document = {
  addEventListener() {},
  createElement() { return new Element(); }
};

const { buildMoverItem, getAggregateDisplay, renderHoldingsPanel, updatePnlInPlace } = await import(`../popup.js?test=${Date.now()}`);
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

const mixedTotal = getAggregateDisplay(null, 120, 2.4);
assert(mixedTotal.value === "Mixed currencies" && mixedTotal.percentage === "", "mixed totals omit aggregate percentage");
assert(mixedTotal.className === "pnl-flat", "mixed totals use neutral styling");

const mixedState = {
  displayCurrency: null,
  positions: [
    { symbol: "RELIANCE.NS", displayName: "Reliance", lastPrice: 1450, dayPnl: 25, dayPnlPct: 1, currency: "INR" },
    { symbol: "MSFT", displayName: "Microsoft", lastPrice: 480, dayPnl: 25, dayPnlPct: 1, currency: "USD" }
  ],
  aggregate: { dayPnl: 50, dayPnlPct: 9.9, window5mPnl: 20, window5mPnlPct: 8.8 }
};
const initialContainer = new Element();
renderHoldingsPanel(initialContainer, mixedState, null, { enabled: true });
assert(initialContainer.querySelector(".pnl-pct").hidden, "initial mixed render hides day percentage");
assert(initialContainer.querySelector(".pnl-value").className.includes("pnl-flat"), "initial mixed render is neutral");
assert(!initialContainer.querySelector("[data-five-value]").textContent.includes("%"), "initial mixed render hides 5-minute percentage");

const updateContainer = new Element();
renderHoldingsPanel(updateContainer, { ...mixedState, displayCurrency: "USD" }, null, { enabled: true });
updatePnlInPlace(updateContainer, mixedState, [], { enabled: true });
assert(updateContainer.querySelector(".pnl-pct").hidden, "in-place mixed update hides day percentage");
assert(updateContainer.querySelector(".pnl-value").className.includes("pnl-flat"), "in-place mixed update clears directional styling");
assert(!updateContainer.querySelector("[data-five-value]").textContent.includes("%"), "in-place mixed update hides 5-minute percentage");
console.log(`\n${failed ? "failed" : "passed"}`);
process.exit(failed ? 1 : 0);
