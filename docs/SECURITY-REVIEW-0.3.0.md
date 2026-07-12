# Security review — MyTicker v0.3.0

**Date:** 2026-07-12  
**Scope:** MV3 extension source (no npm deps)

## Fixed in this release

| ID | Issue | Fix |
|----|-------|-----|
| M1 | Unallowlisted `baseUrl` could exfil API key | `sanitizeFinnhubBaseUrl()` — HTTPS finnhub.io only |
| M4 | Sync fallback for API key | Local `pts_price_api_key` only |
| H1 | Portfolio DOM scrapeable by host pages | Closed Shadow DOM ticker + no qty in titles |
| L3 | Hung quote fetch | 12s AbortController timeout |
| M3 | Privacy incomplete | Yahoo test-only documented in PRIVACY.md |

## Packaging hygiene

- `*.pem` / `*.crx` gitignored; **never** commit signing keys
- Store zip must exclude PEM, node secrets, and user holdings fixtures if present

## Residual / accepted

| ID | Note |
|----|------|
| M2 | Finnhub requires `token=` query param (provider design) |
| L2 | `<all_urls>` required for ambient strip product |
| H1 residual | Shadow DOM closed; host still sees empty mount node (no holdings data) |

## Verdict

**Conditional go for public release** after packaging excludes PEM and store listing matches PRIVACY.md.
