# MyTicker — flow metrics tasks (MT-1 … MT-4)

Branch: `feat/flow-metrics-2026-07`  
Plan source: Desktop `MyTicker-task-list-plan.md`

| ID | Task | Status |
|----|------|--------|
| — | `fix(popup): define missing pts_watchlist storage key` | [x] Done |
| — | Foundation: `pts_metrics`, `ACTIVATION_EVENT`, `isActivated`, `recordActiveDay`, `metrics.js`, background wiring, tests | [x] Done |
| **MT-1** | Collapse setup to a single progress spine (popup + options, API → holdings → live) | [x] Done |
| **MT-2** | “Your day so far” scoreboard, top-3 movers, method + privacy copy, strip status | [x] Done |
| **MT-3** | Zerodha golden path + sample CSV + local import stats | [x] Done |
| **MT-4** | Privacy + market-data honesty footer; `PRIVACY.md` metrics row | [x] Done |
| — | README dual sections (Start here / For technical users) | [x] Done |

## Activation definition

```
activated = api_ok AND holdings_count >= 1 AND ticker_enabled
            AND >= 1 successful price refresh
```

Constant: `ACTIVATION_EVENT = "myticker_activated"` in `shared.js`.

## Known limitation (not in this PR)

Watchlist **prices** may stay empty because `background.js` does not poll watchlist-only symbols. Watchlist storage key is fixed so the popup no longer hangs; price fill remains orthogonal follow-up work.

## Verify

```bash
node test_fixtures/test_shared.mjs
for f in background.js contentScript.js shared.js popup.js options.js onboarding.js csvParser.js priceProviders.js metrics.js; do
  node --input-type=module --check < "$f" && echo "OK $f"
done
```
