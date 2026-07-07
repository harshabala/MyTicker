# MyTicker Crypto Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real crypto price tracking via CoinGecko API with a unified provider registry, replacing the current ornamental crypto support.

**Architecture:** Introduce a `PriceProvider` base class, implement `CoinGeckoPriceProvider` alongside the refactored `FinnhubPriceProvider`, and add a `ProviderRegistry` that routes symbols to the correct provider. The extension fetches prices in parallel from both sources and merges results.

**Tech Stack:** Vanilla JavaScript, Chrome Extension Manifest V3, CoinGecko REST API, Chrome Storage API

---

## File Structure

### New Files
- `src/providers/price-provider.js` — Abstract base class defining the provider interface
- `src/providers/coin-gecko-provider.js` — CoinGecko API implementation
- `src/providers/registry.js` — Provider registry for routing and aggregation
- `src/settings/crypto-coin-picker.js` — Coin search/picker component for settings page

### Modified Files
- `src/providers/finnhub-provider.js` — Refactor to extend PriceProvider base class
- `src/background.js` — Replace direct Finnhub usage with ProviderRegistry
- `src/settings/settings.html` — Replace crypto textarea with coin picker UI
- `src/settings/settings.js` — Add crypto holdings management and schema migration
- `manifest.json` — Add CoinGecko host permission

---

### Task 1: Add CoinGecko Host Permission

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Add CoinGecko to host_permissions**

Find the `host_permissions` array in `manifest.json`. Add `"https://api.coingecko.com/*"` alongside the existing Finnhub entry.

Expected result: `host_permissions` contains both Finnhub and CoinGecko URLs.

- [ ] **Step 2: Verify manifest is valid JSON**

Run: `cat manifest.json | python3 -m json.tool > /dev/null && echo "Valid JSON"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat(manifest): add CoinGecko host permission"
```

---

### Task 2: Create PriceProvider Base Class

**Files:**
- Create: `src/providers/price-provider.js`

- [ ] **Step 1: Write the base class**

```javascript
/**
 * Abstract base class for price providers.
 * All providers must extend this class and implement the abstract methods.
 */
class PriceProvider {
  constructor(name) {
    if (new.target === PriceProvider) {
      throw new TypeError('Cannot instantiate abstract PriceProvider directly');
    }
    this.name = name;
  }

  /**
   * Check if this provider can handle the given symbol.
   * @param {string} symbol - The symbol to check (e.g., "AAPL", "bitcoin")
   * @returns {boolean}
   */
  canHandle(symbol) {
    throw new Error('canHandle() must be implemented by subclass');
  }

  /**
   * Fetch quotes for an array of symbols.
   * @param {string[]} symbols - Array of symbols to fetch
   * @returns {Promise<Array<{symbol: string, price: number, change?: number, changePercent?: number, source: string, timestamp: number}>>}
   */
  async getQuotes(symbols) {
    throw new Error('getQuotes() must be implemented by subclass');
  }

  /**
   * Check if the provider is healthy (API accessible).
   * @returns {Promise<boolean>}
   */
  async isHealthy() {
    return true;
  }
}

export default PriceProvider;
```

- [ ] **Step 2: Commit**

```bash
git add src/providers/price-provider.js
git commit -m "feat(providers): add PriceProvider base class"
```

---

### Task 3: Refactor FinnhubProvider to Extend PriceProvider

**Files:**
- Modify: `src/providers/finnhub-provider.js`

- [ ] **Step 1: Read current file to understand existing implementation**

Run: `cat src/providers/finnhub-provider.js`

- [ ] **Step 2: Refactor to extend PriceProvider**

Add `import PriceProvider from './price-provider.js';` at the top.
Change class declaration to `class FinnhubPriceProvider extends PriceProvider`.
Add `super('finnhub');` in constructor.
Add `canHandle(symbol)` method that returns `true` for uppercase stock tickers (regex: `/^[A-Z]{1,5}(\.NS)?$/`).
Ensure `getQuotes()` returns objects with `source: 'finnhub'` and `timestamp: Date.now()`.

Example `canHandle`:
```javascript
canHandle(symbol) {
  return /^[A-Z]{1,5}(\.NS)?$/.test(symbol);
}
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node --check src/providers/finnhub-provider.js`
Expected: No output (success)

- [ ] **Step 4: Commit**

```bash
git add src/providers/finnhub-provider.js
git commit -m "refactor(providers): FinnhubProvider extends PriceProvider"
```

---

### Task 4: Create CoinGeckoProvider

**Files:**
- Create: `src/providers/coin-gecko-provider.js`

- [ ] **Step 1: Write the CoinGecko provider**

```javascript
import PriceProvider from './price-provider.js';

const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const MIN_CALL_INTERVAL_MS = 6000; // 6 seconds between calls for free tier

class CoinGeckoPriceProvider extends PriceProvider {
  constructor() {
    super('coingecko');
    this.lastCallTime = 0;
    this.pendingQueue = [];
    this.cache = new Map(); // symbol -> { price, timestamp }
  }

  canHandle(symbol) {
    // Crypto symbols are lowercase or mixed case, not standard stock tickers
    // Use heuristic: if it's not a stock ticker format, assume crypto
    const isStockTicker = /^[A-Z]{1,5}(\.NS)?$/.test(symbol);
    return !isStockTicker;
  }

  async getQuotes(symbols) {
    if (!symbols || symbols.length === 0) return [];

    // Rate limiting: wait if needed
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    if (timeSinceLastCall < MIN_CALL_INTERVAL_MS) {
      await this._sleep(MIN_CALL_INTERVAL_MS - timeSinceLastCall);
    }

    try {
      const ids = symbols.join(',');
      const url = `${COINGECKO_API_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
      
      const response = await fetch(url);
      this.lastCallTime = Date.now();

      if (response.status === 429) {
        console.warn('[CoinGecko] Rate limited. Returning cached data.');
        return this._getCachedQuotes(symbols);
      }

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json();
      const quotes = [];

      for (const symbol of symbols) {
        const coinData = data[symbol.toLowerCase()];
        if (coinData && coinData.usd) {
          const quote = {
            symbol: symbol.toUpperCase(),
            price: coinData.usd,
            change: coinData.usd_24h_change ? coinData.usd * (coinData.usd_24h_change / 100) : undefined,
            changePercent: coinData.usd_24h_change,
            source: 'coingecko',
            timestamp: Date.now()
          };
          this.cache.set(symbol, quote);
          quotes.push(quote);
        } else {
          console.warn(`[CoinGecko] No data for symbol: ${symbol}`);
        }
      }

      return quotes;
    } catch (error) {
      console.error('[CoinGecko] Error fetching quotes:', error);
      return this._getCachedQuotes(symbols);
    }
  }

  async searchCoins(query) {
    if (!query || query.length < 2) return [];

    try {
      const url = `${COINGECKO_API_BASE}/search?query=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`CoinGecko search error: ${response.status}`);
      }

      const data = await response.json();
      return (data.coins || []).slice(0, 10).map(coin => ({
        id: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        thumb: coin.thumb
      }));
    } catch (error) {
      console.error('[CoinGecko] Error searching coins:', error);
      return [];
    }
  }

  _getCachedQuotes(symbols) {
    return symbols
      .map(sym => this.cache.get(sym))
      .filter(q => q !== undefined);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default CoinGeckoPriceProvider;
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node --check src/providers/coin-gecko-provider.js`
Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add src/providers/coin-gecko-provider.js
git commit -m "feat(providers): add CoinGeckoPriceProvider"
```

---

### Task 5: Create ProviderRegistry

**Files:**
- Create: `src/providers/registry.js`

- [ ] **Step 1: Write the registry**

```javascript
import PriceProvider from './price-provider.js';

class ProviderRegistry {
  constructor() {
    this.providers = [];
  }

  register(provider) {
    if (!(provider instanceof PriceProvider)) {
      throw new TypeError('Provider must extend PriceProvider');
    }
    this.providers.push(provider);
  }

  /**
   * Get the provider that can handle a symbol.
   * Falls back to trying all providers if none explicitly claims it.
   * @param {string} symbol
   * @returns {PriceProvider|null}
   */
  getProvider(symbol) {
    for (const provider of this.providers) {
      if (provider.canHandle(symbol)) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Fetch quotes for all symbols, routing to appropriate providers.
   * @param {string[]} symbols
   * @returns {Promise<Array<{symbol, price, change, changePercent, source, timestamp}>>}
   */
  async getQuotes(symbols) {
    if (!symbols || symbols.length === 0) return [];

    // Group symbols by provider
    const groups = new Map(); // provider -> symbols[]
    const unclaimed = [];

    for (const symbol of symbols) {
      const provider = this.getProvider(symbol);
      if (provider) {
        if (!groups.has(provider)) {
          groups.set(provider, []);
        }
        groups.get(provider).push(symbol);
      } else {
        unclaimed.push(symbol);
      }
    }

    // Try unclaimed symbols with all providers (fallback)
    if (unclaimed.length > 0) {
      for (const provider of this.providers) {
        if (!groups.has(provider)) {
          groups.set(provider, []);
        }
        groups.get(provider).push(...unclaimed);
      }
    }

    // Call all providers in parallel
    const promises = [];
    for (const [provider, providerSymbols] of groups) {
      promises.push(
        provider.getQuotes(providerSymbols).catch(error => {
          console.error(`[ProviderRegistry] ${provider.name} failed:`, error);
          return [];
        })
      );
    }

    const results = await Promise.allSettled(promises);
    const quotes = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        quotes.push(...result.value);
      }
    }

    return quotes;
  }

  /**
   * Check health of all providers.
   * @returns {Promise<Map<string, boolean>>}
   */
  async healthCheck() {
    const health = new Map();
    for (const provider of this.providers) {
      health.set(provider.name, await provider.isHealthy());
    }
    return health;
  }
}

export default ProviderRegistry;
```

- [ ] **Step 2: Verify no syntax errors**

Run: `node --check src/providers/registry.js`
Expected: No output (success)

- [ ] **Step 3: Commit**

```bash
git add src/providers/registry.js
git commit -m "feat(providers): add ProviderRegistry for unified price fetching"
```

---

### Task 6: Update Background Script to Use Registry

**Files:**
- Modify: `src/background.js`

- [ ] **Step 1: Read current background.js to understand the alarm handler**

Run: `cat src/background.js`

- [ ] **Step 2: Replace Finnhub import with registry imports**

Replace:
```javascript
import FinnhubPriceProvider from './providers/finnhub-provider.js';
```
With:
```javascript
import ProviderRegistry from './providers/registry.js';
import FinnhubPriceProvider from './providers/finnhub-provider.js';
import CoinGeckoPriceProvider from './providers/coin-gecko-provider.js';
```

- [ ] **Step 3: Modify the alarm handler to use registry**

Find the alarm handler (likely in `chrome.alarms.onAlarm.addListener`). Replace the direct `FinnhubPriceProvider` instantiation and `getQuotes` call with:

```javascript
const registry = new ProviderRegistry();
const apiKey = data.apiKey; // from storage
if (apiKey) {
  registry.register(new FinnhubPriceProvider(apiKey));
}
registry.register(new CoinGeckoPriceProvider());

// Build symbol list from stocks and crypto
const allSymbols = [...(data.stockSymbols || [])];
if (data.cryptoHoldings) {
  for (const holding of data.cryptoHoldings) {
    if (holding.coinId) {
      allSymbols.push(holding.coinId);
    }
  }
}

const quotes = await registry.getQuotes(allSymbols);
```

- [ ] **Step 4: Update P&L calculation to include crypto**

After fetching quotes, calculate crypto P&L:
```javascript
let cryptoPnL = 0;
if (data.cryptoHoldings) {
  for (const holding of data.cryptoHoldings) {
    const quote = quotes.find(q => q.symbol.toUpperCase() === holding.symbol.toUpperCase());
    if (quote) {
      const buyPrice = holding.avgBuyPrice || 0;
      cryptoPnL += holding.quantity * (quote.price - buyPrice);
    }
  }
}
```

Merge crypto P&L with stock P&L for total display.

- [ ] **Step 5: Commit**

```bash
git add src/background.js
git commit -m "feat(background): use ProviderRegistry for unified price fetching"
```

---

### Task 7: Storage Schema Migration

**Files:**
- Modify: `src/settings/settings.js`
- Modify: `src/background.js`

- [ ] **Step 1: Add migration helper in settings.js**

Find the storage initialization/loading code. Add a migration function:

```javascript
async function migrateStorage() {
  const data = await chrome.storage.local.get(['symbols', 'stockSymbols', 'cryptoHoldings']);
  
  // Migrate v1 -> v2
  if (data.symbols && !data.stockSymbols) {
    await chrome.storage.local.set({
      stockSymbols: data.symbols,
      cryptoHoldings: []
    });
    console.log('[Migration] Converted symbols to stockSymbols + cryptoHoldings');
  }
  
  // Ensure cryptoHoldings exists
  if (!data.cryptoHoldings) {
    await chrome.storage.local.set({ cryptoHoldings: [] });
  }
}
```

Call `migrateStorage()` on settings page load.

- [ ] **Step 2: Add migration call in background.js**

Add the same migration function and call it in the initialization/startup code.

- [ ] **Step 3: Commit**

```bash
git add src/settings/settings.js src/background.js
git commit -m "feat(storage): add v1 to v2 schema migration"
```

---

### Task 8: Create Crypto Coin Picker Component

**Files:**
- Create: `src/settings/crypto-coin-picker.js`

- [ ] **Step 1: Write the picker component**

```javascript
import CoinGeckoPriceProvider from '../providers/coin-gecko-provider.js';

class CryptoCoinPicker {
  constructor(containerId, onAdd) {
    this.container = document.getElementById(containerId);
    this.onAdd = onAdd;
    this.provider = new CoinGeckoPriceProvider();
    this.debounceTimer = null;
    this.init();
  }

  init() {
    this.container.innerHTML = `
      <div class="crypto-picker">
        <input type="text" id="coin-search" placeholder="Search coins (e.g., Bitcoin, BTC)..." autocomplete="off">
        <div id="search-results" class="search-results"></div>
        <div id="selected-coins" class="selected-coins"></div>
      </div>
    `;

    this.searchInput = this.container.querySelector('#coin-search');
    this.resultsContainer = this.container.querySelector('#search-results');
    this.selectedContainer = this.container.querySelector('#selected-coins');

    this.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.resultsContainer.innerHTML = '';
      }
    });
  }

  async handleSearch(query) {
    clearTimeout(this.debounceTimer);
    if (query.length < 2) {
      this.resultsContainer.innerHTML = '';
      return;
    }

    this.debounceTimer = setTimeout(async () => {
      const coins = await this.provider.searchCoins(query);
      this.renderResults(coins);
    }, 300);
  }

  renderResults(coins) {
    if (coins.length === 0) {
      this.resultsContainer.innerHTML = '<div class="no-results">No coins found</div>';
      return;
    }

    this.resultsContainer.innerHTML = coins.map(coin => `
      <div class="coin-result" data-id="${coin.id}" data-symbol="${coin.symbol}" data-name="${coin.name}">
        <img src="${coin.thumb}" alt="${coin.name}" class="coin-icon">
        <span class="coin-name">${coin.name}</span>
        <span class="coin-symbol">${coin.symbol.toUpperCase()}</span>
      </div>
    `).join('');

    this.resultsContainer.querySelectorAll('.coin-result').forEach(el => {
      el.addEventListener('click', () => this.showAddModal(el.dataset));
    });
  }

  showAddModal(coinData) {
    const quantity = prompt(`Enter quantity of ${coinData.name} (${coinData.symbol.toUpperCase()}):`, '0');
    if (quantity === null || isNaN(parseFloat(quantity))) return;

    const avgBuyPrice = prompt(`Enter average buy price in USD (optional):`, '0');
    
    this.onAdd({
      coinId: coinData.id,
      symbol: coinData.symbol.toUpperCase(),
      quantity: parseFloat(quantity),
      avgBuyPrice: parseFloat(avgBuyPrice) || 0
    });

    this.searchInput.value = '';
    this.resultsContainer.innerHTML = '';
  }

  renderHoldings(holdings) {
    if (!holdings || holdings.length === 0) {
      this.selectedContainer.innerHTML = '<p class="no-holdings">No crypto holdings added yet.</p>';
      return;
    }

    this.selectedContainer.innerHTML = holdings.map((h, index) => `
      <div class="holding-item" data-index="${index}">
        <span class="holding-symbol">${h.symbol}</span>
        <span class="holding-quantity">${h.quantity}</span>
        <span class="holding-price">$${h.avgBuyPrice ? h.avgBuyPrice.toFixed(2) : 'N/A'}</span>
        <button class="remove-holding" data-index="${index}">Remove</button>
      </div>
    `).join('');

    this.selectedContainer.querySelectorAll('.remove-holding').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.onRemove(index);
      });
    });
  }

  onRemove(index) {
    // This should be overridden or handled by the parent
    console.log('Remove holding at index:', index);
  }
}

export default CryptoCoinPicker;
```

- [ ] **Step 2: Commit**

```bash
git add src/settings/crypto-coin-picker.js
git commit -m "feat(settings): add CryptoCoinPicker component"
```

---

### Task 9: Update Settings Page HTML

**Files:**
- Modify: `src/settings/settings.html`

- [ ] **Step 1: Replace crypto textarea with picker container**

Find the crypto configuration section (likely a `<div id="crypto-config">` or similar with a `<textarea>`). Replace it with:

```html
<div class="config-section">
  <h3>Crypto Holdings</h3>
  <div id="crypto-picker-container"></div>
</div>
```

- [ ] **Step 2: Add picker script import**

Add `<script type="module" src="crypto-coin-picker.js"></script>` in the settings page scripts section.

- [ ] **Step 3: Commit**

```bash
git add src/settings/settings.html
git commit -m "feat(settings): replace crypto textarea with coin picker"
```

---

### Task 10: Update Settings Page JavaScript

**Files:**
- Modify: `src/settings/settings.js`

- [ ] **Step 1: Import and initialize picker**

Add import at top:
```javascript
import CryptoCoinPicker from './crypto-coin-picker.js';
```

- [ ] **Step 2: Initialize picker on page load**

After page load / storage load, initialize:
```javascript
let cryptoHoldings = [];

const picker = new CryptoCoinPicker('crypto-picker-container', (holding) => {
  cryptoHoldings.push(holding);
  saveCryptoHoldings();
  picker.renderHoldings(cryptoHoldings);
});

async function saveCryptoHoldings() {
  await chrome.storage.local.set({ cryptoHoldings });
}

// Load existing holdings
chrome.storage.local.get(['cryptoHoldings'], (data) => {
  cryptoHoldings = data.cryptoHoldings || [];
  picker.renderHoldings(cryptoHoldings);
});
```

- [ ] **Step 3: Update save/load to use stockSymbols instead of symbols**

Find references to `symbols` in settings.js and update to use `stockSymbols` for the stock ticker list. Keep backward compatibility by reading `symbols` if `stockSymbols` doesn't exist (handled by migration).

- [ ] **Step 4: Commit**

```bash
git add src/settings/settings.js
git commit -m "feat(settings): integrate crypto picker and update storage keys"
```

---

### Task 11: Add CSS for Coin Picker

**Files:**
- Modify: `src/settings/settings.css` (or create if not exists)

- [ ] **Step 1: Add picker styles**

```css
.crypto-picker {
  margin: 1rem 0;
}

#coin-search {
  width: 100%;
  padding: 0.5rem;
  font-size: 1rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.search-results {
  border: 1px solid #ddd;
  border-top: none;
  max-height: 200px;
  overflow-y: auto;
  background: white;
}

.coin-result {
  display: flex;
  align-items: center;
  padding: 0.5rem;
  cursor: pointer;
  border-bottom: 1px solid #eee;
}

.coin-result:hover {
  background: #f5f5f5;
}

.coin-icon {
  width: 24px;
  height: 24px;
  margin-right: 0.5rem;
}

.coin-name {
  flex: 1;
  font-weight: 500;
}

.coin-symbol {
  color: #666;
  font-size: 0.9rem;
}

.selected-coins {
  margin-top: 1rem;
}

.holding-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
  background: #f9f9f9;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.holding-symbol {
  font-weight: bold;
  width: 60px;
}

.holding-quantity {
  flex: 1;
  text-align: center;
}

.holding-price {
  width: 80px;
  text-align: right;
  color: #666;
}

.remove-holding {
  margin-left: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: #ff4444;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.remove-holding:hover {
  background: #cc0000;
}

.no-holdings {
  color: #999;
  font-style: italic;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/settings/settings.css
git commit -m "feat(settings): add crypto picker styles"
```

---

### Task 12: Update Ticker Display for Mixed Data

**Files:**
- Modify: `src/content_scripts/ticker.js` (or wherever ticker rendering happens)

- [ ] **Step 1: Ensure crypto quotes display correctly**

The ticker should already display quotes generically. Verify that the `source` field from quotes is used to show provider info if needed (e.g., small label showing "CG" for CoinGecko quotes).

If the ticker shows P&L, ensure the total P&L passed from background.js includes both stock and crypto.

- [ ] **Step 2: Commit**

```bash
git add src/content_scripts/ticker.js
git commit -m "feat(ticker): display mixed stock and crypto quotes"
```

---

### Task 13: End-to-End Manual Test

- [ ] **Step 1: Load extension in Chrome**

1. Open Chrome → Extensions → Developer mode → Load unpacked
2. Select the MyTicker directory
3. Check for errors in service worker console

- [ ] **Step 2: Test settings page**

1. Open extension settings
2. Verify old stock symbols are still present (migration worked)
3. Use coin picker to search "bitcoin"
4. Add Bitcoin with quantity 0.5 and avg buy price 50000
5. Add Ethereum with quantity 2
6. Save settings

- [ ] **Step 3: Test price fetching**

1. Wait for alarm to fire (or trigger manually in chrome://extensions service worker)
2. Check ticker shows BTC and ETH prices
3. Verify P&L calculation includes crypto

- [ ] **Step 4: Test error handling**

1. Block CoinGecko domain in DevTools Network panel
2. Verify ticker still shows stocks with stale warning
3. Check console for error logs

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(crypto): complete CoinGecko integration with provider registry"
```

---

## Self-Review Checklist

- [ ] **Spec coverage**: All sections from the spec are addressed by tasks
  - Provider registry architecture → Tasks 2, 3, 4, 5
  - CoinGecko integration → Tasks 1, 4, 6
  - Search/picker UI → Tasks 8, 9, 10, 11
  - Storage migration → Task 7
  - Error handling → Embedded in Tasks 4, 5, 6
  - P&L calculation → Task 6

- [ ] **Placeholder scan**: No TBDs, TODOs, or vague instructions
- [ ] **Type consistency**: Quote interface matches across all providers and registry
- [ ] **File paths**: All paths are relative to project root
- [ ] **Testing**: Manual test plan included in Task 13

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-crypto-tracking-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session, batch execution with checkpoints

**Which approach?**
