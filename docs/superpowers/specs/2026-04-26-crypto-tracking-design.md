# MyTicker Crypto Tracking Design

## Date
2026-04-26

## Context
MyTicker is a Chrome extension that displays a live ticker strip of stock/crypto holdings with P&L. Currently, crypto support is ornamental: it shows a hardcoded top-5 watchlist with manual text entry and no real price fetching. This design adds legitimate crypto tracking via CoinGecko API with a unified provider registry architecture.

## Goals
- Replace fake crypto prices with real CoinGecko price data
- Add a coin search/picker in settings for user-friendly crypto portfolio management
- Refactor price fetching into a unified provider registry that cleanly separates stock and crypto concerns
- Maintain backward compatibility with existing stock functionality
- Handle rate limits gracefully (CoinGecko free tier)

## Non-Goals
- Wallet integration (Phantom/Solflare) — out of scope, manual entry only
- Exchange API connections (Binance/Coinbase) — out of scope
- macOS app or local server — not needed, extension calls CoinGecko directly
- Real-time WebSocket prices — CoinGecko free tier is REST polling only

## Architecture

### Provider Registry Pattern

```
PriceProvider (base interface)
├── FinnhubPriceProvider (stocks — refactored)
└── CoinGeckoPriceProvider (crypto — new)

ProviderRegistry
├── register(provider)
├── canHandle(symbol): boolean
├── getProvider(symbol): PriceProvider
└── getQuotes(symbols[]): Promise<Quote[]>
```

### Symbol Routing

Each provider implements `canHandle(symbol)`:
- **FinnhubProvider**: uppercase letters (standard stock ticker format, e.g., AAPL, TCS, RELIANCE). Note: Indian stocks like RELIANCE.NS are also valid.
- **CoinGeckoProvider**: lowercase alphanumeric, typical crypto coin ID format (e.g., bitcoin, ethereum, solana). Uses a heuristic: if symbol is lowercase and contains no numbers-only tokens, it's likely a crypto ID. The provider attempts the API call and handles 404 gracefully.
- **Fallback**: if no provider claims a symbol, try all providers in order (Finnhub first, then CoinGecko), use first success

### Quote Interface

All providers return a normalized `Quote` object:
```typescript
interface Quote {
  symbol: string;        // User-facing symbol (BTC, AAPL)
  price: number;         // Current price in USD
  change?: number;       // Absolute change
  changePercent?: number;// Percentage change
  source: string;        // Provider name ("finnhub", "coingecko")
  timestamp: number;     // Unix ms
}
```

## Components

### New Files

1. **`src/providers/price-provider.js`** — Base interface/class defining the provider contract
2. **`src/providers/coin-gecko-provider.js`** — CoinGecko implementation
3. **`src/providers/registry.js`** — Registry that routes symbols and aggregates results
4. **`src/popup/crypto-coin-picker.js`** — Search/picker UI component for settings

### Modified Files

1. **`src/providers/finnhub-provider.js`** — Refactor to implement base interface
2. **`src/background.js`** — Replace direct Finnhub usage with registry
3. **`src/settings/settings.html`** — Replace crypto textarea with coin picker
4. **`src/settings/settings.js`** — Handle crypto holdings with coinId + quantity
5. **`manifest.json`** — Add `https://api.coingecko.com` to `host_permissions`

## Data Flow

### Current Flow
```
User enters stock symbols in settings
  → Storage: { symbols: ["AAPL", "TCS"], investedAmount: 10000 }
Background alarm fires
  → FinnhubProvider.getQuotes(symbols)
  → Calculates P&L
  → Updates ticker
```

### New Flow
```
User manages stocks: same as before (CSV import or manual entry)
User manages crypto: uses coin picker in settings
  → Calls CoinGecko /search?q=btc
  → User selects Bitcoin, enters quantity 0.5
  → Storage: { 
      stockSymbols: ["AAPL", "TCS"],
      investedAmount: 10000,
      cryptoHoldings: [
        { coinId: "bitcoin", symbol: "BTC", quantity: 0.5, avgBuyPrice: 50000 }
      ]
    }

Background alarm fires
  → Build symbol list: stockSymbols + cryptoHoldings[].symbol
  → ProviderRegistry.getQuotes(allSymbols)
    → Registry groups by provider
    → Calls Finnhub for stocks, CoinGecko for crypto (parallel)
    → Merges results
  → Calculates P&L
    → Stocks: same formula (currentValue - investedAmount)
    → Crypto: sum(quantity * (currentPrice - avgBuyPrice)) where avgBuyPrice defaults to 0 if not provided (shows full current value as gain)
  → Updates ticker with mixed stock + crypto data
```

## Storage Schema Migration

### v1 (Current)
```json
{
  "symbols": ["AAPL", "TCS"],
  "investedAmount": 10000,
  "refreshInterval": 60,
  "apiKey": "..."
}
```

### v2 (New)
```json
{
  "stockSymbols": ["AAPL", "TCS"],
  "investedAmount": 10000,
  "refreshInterval": 60,
  "apiKey": "...",
  "cryptoHoldings": [
    { "coinId": "bitcoin", "symbol": "BTC", "quantity": 0.5, "avgBuyPrice": 50000 }
  ]
  // avgBuyPrice is optional; omitting it defaults to 0 (shows full current value as unrealized gain)
}
```

**Migration strategy**: On first load with new version, if `symbols` exists and `stockSymbols` does not:
1. Copy `symbols` → `stockSymbols`
2. Initialize `cryptoHoldings` as `[]`
3. Optionally delete old `symbols` key (or keep for rollback safety)

## CoinGecko Provider Details

### API Endpoints
- **Price fetch**: `GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true`
- **Search**: `GET https://api.coingecko.com/api/v3/search?query=btc`

### Rate Limiting
- Free tier: ~10-30 calls/minute
- Enforce minimum 6 seconds between calls in CoinGeckoProvider
- Queue pending requests, flush when rate limit window allows
- If rate limited (429), return cached data with stale warning

### Error Handling
- Network failure: return `null` for affected symbols, log warning
- Rate limit: return cached data, set `stale` flag
- Unknown coin ID: return `null`, log warning
- Partial failure: return successful quotes, omit failed ones

## UI: Crypto Coin Picker

### In Settings Page
Replace current crypto config section:

```
┌─────────────────────────────────────┐
│ Crypto Holdings                      │
│                                      │
│ [Search coins...          ] 🔍       │
│ ───────────────────────────────────  │
│ BTC  Bitcoin      0.5000  $52,340  ✕│
│ ETH  Ethereum     2.0000  $3,120   ✕│
│ SOL  Solana      10.0000  $142     ✕│
│ ───────────────────────────────────  │
│ [+ Add Custom Coin]                  │
└─────────────────────────────────────┘
```

### Search Behavior
- Debounced input (300ms)
- Calls CoinGecko `/search` API
- Shows dropdown with: icon, name, symbol, current price
- Click to add → opens quantity + avg buy price input modal
- Manual "Add Custom" option for coins not in CoinGecko

## Error Handling

### Provider-Level
- Each provider handles its own errors (network, rate limit, auth)
- Returns `null` for individual failed symbols
- Never throws — registry expects partial results

### Registry-Level
- Parallel calls with `Promise.allSettled()`
- Successful results merged, failures logged
- If all providers fail, show "Unable to fetch prices" in ticker

### UI-Level
- Stale data warning if last successful fetch > 2x refresh interval
- Individual provider warnings: "⚠ Crypto data delayed" / "⚠ Stock data delayed"
- Tooltip on hover showing last update time per provider

## Testing Plan

### Unit Tests
- `PriceProvider` interface compliance for both providers
- `ProviderRegistry` routing logic
- `CoinGeckoProvider` rate limiting
- `CoinGeckoProvider` response parsing
- Storage migration v1 → v2

### Integration Tests
- End-to-end alarm → registry → ticker flow
- Mixed stock + crypto portfolio rendering
- Error state rendering (one provider down)

### Manual Tests
- Search picker finds coins correctly
- Adding/removing crypto holdings
- Rate limit behavior (rapid refresh)
- Offline behavior

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CoinGecko rate limits extension | High | Medium | Aggressive client-side rate limiting, cached data fallback |
| Schema migration breaks existing users | Medium | High | Backward-compatible read, graceful migration, keep old keys |
| Registry adds complexity | Medium | Low | Well-tested base interface, clear separation |
| CoinGecko API changes | Low | Medium | Abstract provider interface, easy to swap endpoints |

## Success Criteria
- [ ] User can search and add Bitcoin, Ethereum, Solana via picker
- [ ] Real prices display in ticker within 60 seconds of alarm
- [ ] P&L calculation works for mixed stock + crypto portfolio
- [ ] Rate limit handled gracefully (no crashes, stale data warning)
- [ ] Existing stock functionality unchanged
- [ ] All unit tests pass
