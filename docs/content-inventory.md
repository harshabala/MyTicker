# MyTicker content inventory

Source baseline: commit `98c276f` (the final popup and gold-surface refinement, including `popup.html`/`popup.js`, `options.html`/`options.js`, and `contentScript.js`). “Exact string” preserves source text; `{…}` marks runtime data, not a new claim. This is an inventory of meaningful user-visible or assistive text, rather than CSS-only labels or source-only constants.

## Popup

| Exact string | Location / surface | User-facing purpose | Internal rationale |
| --- | --- | --- | --- |
| `MyTicker` | Header | Identifies the extension. | Canonical product name. |
| `Settings` | Header gear button label/title | Opens the Settings page. | The popup has one header action; configuration lives in Settings. |
| `Holdings`; `Watchlist`; `Popup sections` | Tab bar and its accessible label | Switches the popup’s two primary views. | Holdings is the default, watchlist is secondary. |
| `Loading…` | Initial popup state | Indicates storage/setup state is being read. | Avoids a blank popup. |
| `Import your holdings`; `Zerodha CSV works immediately for Indian stocks (no API key)` | Setup checklist | First-run action and India-first reassurance. | Guides the shortest route to value. |
| `Prices loading`; `Fetching live prices… open any tab in a moment`; `Import holdings first` | Setup checklist | Explains the live-price prerequisite/progress. | Keeps asynchronous refresh understandable. |
| `Optional: US price key`; `Needed for US equities; crypto quotes use CoinGecko with Binance fallback` | Conditional setup checklist | Explains US-key scope. | Does not misstate crypto’s providers. |
| `Your day so far`; `Today {signed currency}`; `Today, mixed currencies`; `Live`; `Stale` | Holdings hero and live announcement | Shows aggregate daily outcome and quote freshness. | Primary portfolio-at-a-glance information. |
| `5-min change`; `Holdings`; `How P&L is calculated` | Holdings hero | Provides short-horizon context, count, and methodology/help. | Supports interpretation without exposing holdings externally. |
| `Top movers (today)`; `View all →` | Holdings movers | Highlights up to three largest absolute P&L movers and opens settings. | Gives a compact reason to inspect holdings. |
| `No symbols yet. Add symbols in Settings. Watchlist is the second strip group, after holdings.` | Empty Watchlist tab | Explains where to populate the list and its tape order. | Adding is owned by Settings while the popup remains a review surface. |
| `Crypto · USD`; `India · {NSE\|BSE} · INR`; `Index · USD`; `ETF · USD`; `US[ · {exchange}] · USD` | Watchlist row metadata | Identifies asset market/currency. | Prevents ambiguous ticker symbols. |
| `Stale`; `Unavailable`; `Remove {display name}` | Read-only watchlist quote/remove states | Signals bad/missing quote or removes an item. | The popup supports review and removal, while adding and list setup are in Settings. |
| `Mixed currencies` | Holdings aggregate fallback | States that one aggregate currency cannot be shown. | Avoids false precision. |

Gold is the shared interaction accent for selected tabs, primary actions, explanatory/action links, hover, and keyboard focus. Green and red remain semantic market-state colors for positive/success and negative/error values; they do not signal the current interactive selection.

## Page-level tape (not browser chrome)

The tape is a **page-level content-script strip at the top of eligible web pages**, rendered in a closed Shadow DOM. It is not a browser-toolbar/chrome surface.

| Exact string | Location / surface | User-facing purpose | Internal rationale |
| --- | --- | --- | --- |
| `Portfolio day profit and loss`; `Market tape. Focus pauses scrolling.` | Accessible labels | Names aggregate and explains focus behavior. | Keyboard users can pause the marquee. |
| `⚠ Stale`; `Price data may be outdated – check your API key or network` | Tape stale indicator/title | Warns that results may be old. | Provides an actionable likely cause. |
| `MyTicker · today {signed currency} ({signed percent}%)`; `MyTicker · today mixed currencies` | Tape aggregate | Shows portfolio daily aggregate. | Compact lead item for the tape. |
| `holdings`; `watchlist`; `crypto` | First item of each tape group | Marks group boundaries. | Makes the specified holdings → watchlist → crypto ordering legible. |
| `{display name}`; `{formatted price}`; `{signed percent}%`; `p&l {signed currency}`; `stale`; `Stale quote` | Tape item/accessible state | Displays quote, change, personal P&L for holdings, and freshness. | Quantity is deliberately not exposed. |
| `No items — add holdings or a watchlist` | Empty tape | Explains why no quotes appear. | Actionable empty state. |
| `Updating markets` | Loading tape | Shows refresh-in-progress. | Avoids blank content during initial state resolution. |

## Settings — Portfolio

| Exact string | Location / surface | User-facing purpose | Internal rationale |
| --- | --- | --- | --- |
| `MyTicker settings`; `Set up your portfolio, follow markets, and tune the live tape.` | Page header | Identifies settings and its scope. | Establishes task-oriented configuration. |
| `Portfolio`; `Portfolio import`; `Zerodha holdings export (recommended)` | Navigation/import lead | Opens the primary workflow. | India-first, holdings-first IA. |
| `Kite Console → Portfolio → Holdings → Download CSV. Drop it below. NSE symbols get .NS automatically.` | Import lead | Gives exact Zerodha export path and normalization behavior. | Reduces broker-import ambiguity. |
| `Import my holdings`; `Import demo sample`; `One-click import avoids browser file-permission issues. Or drop a local broker CSV below.` | Import actions | Loads bundled/user sample or explains local-file alternative. | Handles extension file-permission friction. |
| `More formats: Groww, Upstox, generic CSV`; `Broker preset`; `Match your CSV format if auto-detect misses`; `Zerodha`; `Groww`; `Upstox`; `Generic CSV` | Expanded format controls | Selects parser shape. | Keeps alternatives secondary to recommended path. |
| `Drop holdings CSV here, or click to browse`; `Recommended: Zerodha holdings export · also Groww, Upstox, generic`; `Drop CSV file here or press Enter to browse` | File drop zone | Chooses a CSV through mouse or keyboard. | Accessible import fallback. |
| `Import holdings`; `Clear all`; `{n} holdings`; `Importing…` | Import controls/status | Starts/imports/clears and reports count/progress. | Clear async feedback. |
| `Holdings preview`; `Current portfolio`; `Header stays fixed while rows scroll`; `Refresh`; `No holdings loaded`; `No holdings loaded — import a CSV above`; `Symbol`; `Qty`; `Broker`; `Exchange`; `manual`; `CRYPTO`; `Top 5 crypto watchlist enabled` | Preview | Reviews imported positions and crypto configuration. | Validation before relying on tape. |
| `Imports on this device: {success} succeeded · {fail} failed ({preset counts}).`; `Counted locally whenever a CSV parses to at least one holding. Stored only in this browser. Never uploaded.` | Import metrics | Reports local import outcome. | Privacy-safe, device-local feedback. |

## Settings — Watchlist

| Exact string | Location / surface | User-facing purpose | Internal rationale |
| --- | --- | --- | --- |
| `Watchlist`; `Market`; `India`; `US`; `Index`; `ETF`; `Crypto` | Watchlist tab/form | Chooses an asset type. | Separates supplemental market tracking from holdings. |
| `Indian exchange`; `NSE`; `BSE`; `Symbol or crypto`; `RELIANCE`; `Add to watchlist` | Watchlist fields/action | Collects a symbol and adds it. | Normalizes India symbols correctly. |
| `India symbols are normalized to the selected NSE/BSE suffix.`; `BTC or Bitcoin`; `Supported: BTC/Bitcoin, ETH/Ethereum, BNB, XRP, SOL/Solana.`; `AAPL or SPY`; `Use the canonical symbol. Live US prices require Finnhub.` | Dynamic hints | Explains valid input by selected market. | Provider requirements are scoped to US only. |
| `Unsupported crypto. Search BTC/Bitcoin, ETH/Ethereum, BNB, XRP, or SOL/Solana.`; `Enter an Indian symbol such as RELIANCE, then select NSE or BSE.`; `Enter a canonical US, index, or ETF symbol (for example AAPL or SPY).`; `{display name} added`; `Watching: {names}`; `No watchlist symbols configured yet.` | Validation/status | Corrects invalid input and confirms saved list. | Supports recoverable entry errors. |

## Settings — Crypto

| Exact string | Location / surface | User-facing purpose | Internal rationale |
| --- | --- | --- | --- |
| `Crypto`; `Crypto (advanced)`; `Crypto list`; `Off`; `Top 5`; `Manual` | Crypto tab/configuration | Enables and selects crypto tracking mode. | Third-level optional market feature. |
| `Search supported crypto`; `BTC, Bitcoin, ethereum…`; `Add {symbol} / {name}`; `{symbol} ×` | Manual selector | Searches catalog, adds/removes selected crypto. | Restricts quoteable manual choices to canonical catalog. |
| `Top 5: BTC, ETH, BNB, XRP, SOL. BTC / Bitcoin, ETH / Ethereum, BNB / BNB, XRP / XRP, SOL / Solana.` | Catalog help | States Top 5 and accepted names. | Matches implemented catalog only. |
| `CoinGecko first for supported canonical crypto; Binance for mapped liquid assets. CoinGecko is primary; Binance is a fallback for mapped liquid pairs.` | Provider help | Explains crypto source ordering. | Truthful implemented fallback behavior. |
| `No Finnhub key is required for crypto quotes.`; `Crypto becomes the third strip group, after holdings and watchlist.`; `Save`; `Crypto settings saved` | Scope/order/status | Clarifies no US key is required and tape placement. | Avoids legacy Finnhub crypto implication. |

## Settings — Data & diagnostics

| Exact string | Location / surface | User-facing purpose | Internal rationale |
| --- | --- | --- | --- |
| `Data & diagnostics`; `Setup status`; `Import your broker holdings to go live. Indian stocks price automatically — no API key.` | Composite tab/status | Groups operational setup and support information. | Low-frequency/support material is consolidated last. |
| `○ Holdings`; `○ Live prices`; `○ Last sync`; `○ India prices (auto)`; `✓ {label}` | Setup status pills | Shows setup completeness/current conditions. | Fast readiness scan. |
| `Large portfolio with a Finnhub key: free tier is ~60 calls/min. Prefer a 2+ minute refresh.` | Rate-limit warning | Warns about US-provider rate risk. | Safe operational expectation-setting. |
| `1. Import holdings`; `2. Go live`; `US key (optional)`; `Start by importing a Zerodha / Groww / Upstox holdings CSV. NSE/BSE prices load without Finnhub.` | Setup wizard | Offers ordered shortcuts. | Reinforces holdings-first flow. |
| `India (automatic)`; `NSE & BSE`; `Yahoo Finance · no API key`; `Auto`; `All .NS and .BO symbols from your broker CSV are fetched automatically after import.`; `Test connection`; `Testing…`; `✓ Connected`; `✓ India connected: TCS.NS: ₹{price}`; `Yahoo Finance returned no data. Try again shortly.`; `India connection failed: {message}` | India provider card/status | Communicates/tests automatic India pricing. | Yahoo is the implemented `.NS`/`.BO` provider. |
| `United States (optional)`; `NYSE & NASDAQ`; `Finnhub · free key for US equities`; `Optional`; `Finnhub API key`; `Enter your Finnhub API token`; `Show API key`; `Hide API key`; `Show / hide key`; `Get a free key at finnhub.io`; `Refresh interval (minutes)`; `How often the background worker refreshes quotes (via chrome.alarms).`; `Save`; `Test connection`; `Save your API key first` | US provider card | Configures and tests US-equity access. | Finnhub only serves configured US equities in this product. |
| `Diagnostics`; `Safe to copy: build, operational counts, provider availability, poll health, and the recent refresh lifecycle. It never includes keys, quantities, prices, or portfolio values.`; `Copy diagnostics`; `Refresh`; `Diagnostics copied`; `Could not copy diagnostics. Select the text and copy it manually.` | Diagnostics panel/actions | Shares safe support data. | Explicit privacy boundary. |
| `MyTicker diagnostics · build v{version}`; `Ticker enabled: {yes\|no}`; `Holdings: {n} · Watchlist: {n} · Ticker items: {n}`; `Last state update: {time\|Never}`; `Poll health: {n} consecutive failure(s) · last successful fetch {time\|Never}`; `Content script: {stage\|never reported} · {origin\|no page origin} · {time}` | Diagnostic output | Identifies build, configuration, counts, freshness and renderer lifecycle. | Bounded operational support record. |
| `Provider availability and latest result:`; `CoinGecko: primary crypto source · {eligible when supported crypto is enabled\|crypto disabled} · {n} quotes in last provider result`; `Binance: fallback for mapped liquid crypto only · {available\|crypto disabled} · {n} quotes in last provider result`; `Yahoo Finance: automatic for .NS/.BO · available · {n} quotes in last provider result`; `Finnhub: US equities · {API key configured\|no API key configured} · {n} quotes in last provider result` | Diagnostic output | Describes provider availability and latest counts. | Provider claims match source routing. |
| `Recent refresh lifecycle (safe operational counts only):`; `No refresh diagnostics recorded yet.`; `{time} · {event} · {counts}`; `Refresh failed` | Diagnostic output | Displays bounded lifecycle/history. | Contains counts only, no portfolio values. |
| `What changed`; `Live tape architecture: the service worker refreshes state on chrome.alarms; the content script renders that state in a closed Shadow DOM strip.`; `Provider behavior: Yahoo serves NSE/BSE, Finnhub serves configured US equities, and crypto uses CoinGecko as primary with Binance as fallback for mapped liquid assets.`; `Current release: v0.5.0 adds copyable diagnostics and a bounded, privacy-safe refresh log. Crypto providers are CoinGecko and Binance only; Coinbase and DeFiLlama are not implemented.` | Change notes | Explains architecture and release scope. | Prevents claims about unimplemented providers. |
| `Getting started`; `India-first: Import a Zerodha / Groww / Upstox holdings CSV on the Portfolio tab. NSE/BSE symbols get .NS / .BO and price automatically via Yahoo — no API key.` | Reference notes | Gives the first-run setup path. | Keeps the holdings-first flow discoverable without retired popup tape controls. |
| `How MyTicker works`; `Service worker fetches quotes on a chrome.alarms schedule (not setInterval), so fetches continue when the worker sleeps.`; `Content script injects a closed Shadow DOM ticker at the top of pages so host CSS cannot break the strip (and vice versa).`; `Holdings, last prices, and keys live in chrome.storage.local on this browser only — nothing is sent to our servers.`; `Fullscreen video (YouTube, Netflix, etc.) hides the strip so it does not cover the player.` | Reference notes | Explains implementation/privacy/behavior. | Accurate technical transparency. |
| `Troubleshooting`; `File permission / Error reading file: use Import my holdings or drop the CSV again; the import path uses the File API safely for extensions.`; `Missing Exchange/Currency columns: Zerodha-style exports are fine — we default NSE + INR when those columns are absent.`; `Empty strip: confirm holdings on Portfolio, then open any http(s) tab and wait for the next alarm refresh (or re-open the popup).`; `Setup errors appear in Data & diagnostics when something fails mid-import or fetch.` | Reference notes | Gives recovery paths. | Keeps support context beside diagnostics. |
| `Setup errors`; `Copy all`; `Clear`; `{n} error(s)` | Error log (only shown after an error) | Reviews/copies/clears in-session errors. | Error visibility without adding a separate tab. |

## Settings — Appearance

| Exact string | Location / surface | User-facing purpose | Internal rationale |
| --- | --- | --- | --- |
| `Appearance`; `Show stocks`; `Show crypto` | Appearance tab | Filters tape item classes. | Presentation controls belong together. |
| `Theme`; `System`; `Light`; `Dark`; `System follows your browser. The live tape uses the same choice.` | Theme controls | Selects shared settings/tape theme. | Ensures popup/settings/tape alignment. |
| `Ticker speed (seconds per loop)`; `Lower = faster scroll. Minimum 5 seconds.` | Motion control | Sets marquee duration. | Preserves readable bounds. |
| `Tape size`; `Compact (0.92×)`; `Comfortable (1.08×)`; `Large (1.20×)`; `Changes the tape height, type, spacing, and status markers. Reduced-motion mode stays static and scrollable.` | Tape-scale controls | Adjusts page-level tape density/accessibility. | Supports preference and reduced-motion behavior. |
| `Appearance saved` | Save status | Confirms persisted appearance settings. | Immediate feedback. |

## Shared transient validation / error copy

| Exact string | Location / surface | User-facing purpose | Internal rationale |
| --- | --- | --- | --- |
| `No file found in that drop. Try Browse or Import sample.`; `Please choose a CSV file, or click Import sample CSV.`; `CSV is too large (max 500 KB). Export only your holdings, not full transaction history.`; `That file is empty (0 bytes). Re-download the sample or re-export from your broker.`; `That file looks empty.`; `No holdings found in that CSV.`; `Could not read file ({detail}). Try Import sample CSV instead.`; `Could not load packaged CSV.` | Import toast/error states | Explains failed CSV selection/reading/parsing. | Gives a concrete recovery action. |
| `Auto-detected broker: {name}`; `Imported {n} holdings ({n} with .NS for NSE)`; `Imported {n} holdings ({preset})`; `All holdings cleared`; `Provider settings saved`; `Enter an API key first`; `Connection failed: {message}` | Import/provider toast status | Confirms success or directs correction. | Keeps async actions observable. |
| `Key rejected by Finnhub: {detail}. Regenerate at finnhub.io/dashboard.`; `Key accepted but returned unexpected data. Try again.`; `✓ Key valid (AAPL: ${price}) but Indian stocks (NSE/BSE) need a Finnhub paid plan. Free tier is US-only.`; `✓ Connected: TCS.NS: ₹{price} · AAPL: ${price}`; `✓ Key valid (AAPL: ${price}). NSE quotes will be fetched on next refresh.` | Finnhub test results | Describes US-key outcomes accurately. | Tests distinguish Finnhub US access from Yahoo India pricing. |
| `MyTicker v0.5.0 · Holdings and keys stay in this browser. India prices: Yahoo · US equities: Finnhub key required · Crypto: CoinGecko, with Binance fallback for mapped liquid assets. We don’t send your portfolio to our servers. · Built by Harsha Balakrishnan` | Settings footer | Persistent provider/privacy attribution. | Concise end-of-page truth statement. |

## Provider-claim boundary

Visible provider names are `Yahoo Finance`, `Finnhub`, `CoinGecko`, and `Binance`; their visible claims are recorded above. `Coinbase` and `DeFiLlama` appear only in the visible statement that they are **not implemented**. Internal identifiers are not provider claims: `source: "yahoo"`, `source: "finnhub"`, `source: "coingecko"`, `source: "binance"`; URLs such as `query1.finance.yahoo.com`, `finnhub.io`, `api.coingecko.com`, and `data-api.binance.vision`; and canonical/catalog keys such as `bitcoin`, `BTCUSDT`, or `crypto:bitcoin`. They are implementation routing details and should not be substituted into customer-facing copy.
