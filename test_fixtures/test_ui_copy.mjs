// Static UI-copy regression checks. Run with: node test_fixtures/test_ui_copy.mjs
import { readFile } from "node:fs/promises";

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

const [popupHtml, popupJs, optionsHtml, optionsJs, brandCss, tickerCss, manifestSource, priceProvidersSource, backgroundSource, readmeSource, privacySource, storeListingSource] = await Promise.all([
  readFile(new URL("../popup.html", import.meta.url), "utf8"),
  readFile(new URL("../popup.js", import.meta.url), "utf8"),
  readFile(new URL("../options.html", import.meta.url), "utf8"),
  readFile(new URL("../options.js", import.meta.url), "utf8"),
  readFile(new URL("../brand.css", import.meta.url), "utf8"),
  readFile(new URL("../ticker.css", import.meta.url), "utf8"),
  readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../priceProviders.js", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
  readFile(new URL("../PRIVACY.md", import.meta.url), "utf8"),
  readFile(new URL("../STORE_LISTING.md", import.meta.url), "utf8")
]);

function mediaRuleBody(css, mediaQuery, selector) {
  const mediaStart = css.indexOf(`@media (${mediaQuery})`);
  if (mediaStart < 0) return "";

  const blockStart = css.indexOf("{", mediaStart);
  let depth = 0;
  let blockEnd = -1;
  for (let index = blockStart; index < css.length; index++) {
    if (css[index] === "{") depth++;
    if (css[index] === "}" && --depth === 0) {
      blockEnd = index;
      break;
    }
  }

  const mediaBody = css.slice(blockStart + 1, blockEnd);
  const ruleStart = mediaBody.indexOf(selector);
  if (ruleStart < 0) return "";
  const ruleBlockStart = mediaBody.indexOf("{", ruleStart);
  const ruleBlockEnd = mediaBody.indexOf("}", ruleBlockStart);
  return mediaBody.slice(ruleBlockStart + 1, ruleBlockEnd);
}
function cssRuleBodyAt(css, selector, startAt = 0) {
  const ruleStart = css.indexOf(selector, startAt);
  if (ruleStart < 0) return "";
  const blockStart = css.indexOf("{", ruleStart);
  let depth = 0;
  for (let index = blockStart; index < css.length; index++) {
    if (css[index] === "{") depth++;
    if (css[index] === "}" && --depth === 0) return css.slice(blockStart + 1, index);
  }
  return "";
}
function tokenMap(cssBlock) {
  return Object.fromEntries([...cssBlock.matchAll(/--([\w-]+):\s*(#[\da-fA-F]{6})/g)].map(([, name, value]) => [name, value]));
}
function contrastRatio(first, second) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [firstLuminance, secondLuminance] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (firstLuminance + 0.05) / (secondLuminance + 0.05);
}
const manifest = JSON.parse(manifestSource);
const visibleCopy = `${popupHtml}\n${popupJs}\n${optionsHtml}\n${optionsJs}`;
const visibleText = visibleCopy.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

console.log("\n📝 UI copy");
assert(popupHtml.includes("<h1>MyTicker</h1>"), "uses canonical MyTicker name in the popup");
assert(optionsHtml.includes("<h1>MyTicker settings</h1>"), "uses canonical MyTicker name in settings");
assert(manifest.name === "MyTicker", "uses canonical MyTicker name in the extension manifest");
assert(manifest.action?.default_title === "MyTicker", "uses canonical MyTicker name in the extension action title");
assert(manifest.version === "0.5.0", "ships the unmistakable 0.5.0 diagnostics build");
for (const tab of ["portfolio", "watchlist", "crypto", "data", "appearance"]) {
  assert(optionsHtml.includes(`data-tab="${tab}"`), `includes ${tab} in the task-based settings navigation`);
}
assert(!optionsHtml.includes('data-tab="setup"') && !optionsHtml.includes('data-tab="market"') && !optionsHtml.includes('data-tab="optional"'), "replaces implementation-oriented settings tabs with task-based navigation");
assert(optionsHtml.includes('id="copyDiagnosticsButton"'), "includes a copy diagnostics button");
assert(optionsHtml.includes('id="refreshDiagnosticsButton"'), "includes a refresh diagnostics button");
assert(/<button[^>]*id="refreshDiagnosticsButton"[^>]*>Refresh<\/button>/.test(optionsHtml), "Diagnostics Refresh control is a visible button labelled Refresh");
assert(optionsJs.includes('refreshDiagnosticsButton?.addEventListener("click", renderDiagnostics)'), "Diagnostics Refresh control renders current diagnostics on click");
assert(visibleText.includes("What changed"), "includes a visible What changed section");
assert(visibleText.includes("CoinGecko and Binance only"), "does not overclaim unimplemented crypto providers");
assert(visibleText.includes("Ticker enabled") && visibleText.includes("Holdings:") && visibleText.includes("Watchlist:"), "diagnostics copy includes required ticker and item counts");
assert(visibleText.includes("Content script:"), "diagnostics copy includes content-script status");
assert(visibleText.includes("CoinGecko:") && visibleText.includes("Binance:") && visibleText.includes("Yahoo Finance:") && visibleText.includes("Finnhub:"), "diagnostics copy names every active provider");
assert(visibleText.includes("Recent refresh lifecycle"), "diagnostics copy includes the bounded change-log lifecycle");
assert(visibleText.includes("CoinGecko first for supported canonical crypto"), "explains CoinGecko as the primary crypto source");
assert(visibleText.includes("Binance for mapped liquid assets"), "explains the Binance fallback");
assert(visibleText.includes("CoinGecko is primary; Binance is a fallback for mapped liquid pairs."), "uses truthful crypto provider copy");
assert(!/Coinbase (?:is |as )?(?:primary|fallback|provider)/i.test(visibleText) && !/DefiLlama (?:is |as )?(?:primary|fallback|provider)/i.test(visibleText), "does not claim unsupported crypto providers");
assert(visibleText.includes("Live US prices require Finnhub"), "makes the US live-price provider requirement explicit");
assert(visibleText.includes("BTC / Bitcoin") && visibleText.includes("SOL / Solana"), "lists the supported canonical crypto catalog");
assert(optionsHtml.includes('<option value="off">Off</option>') && optionsHtml.includes('<option value="top5">Top 5</option>') && optionsHtml.includes('<option value="manual">Manual</option>'), "uses explicit Off, Top 5, and Manual crypto modes");
assert(optionsHtml.includes('id="cryptoSearch"') && optionsHtml.includes('id="cryptoSelectedChips"'), "provides searchable manual crypto selection with removable chips");
assert(/<section class="crypto-selector" aria-label="Manual crypto selection">[\s\S]*?<div class="crypto-search-region">[\s\S]*?id="cryptoSearch"[\s\S]*?id="cryptoSearchResults" class="crypto-search-results" aria-live="polite"[\s\S]*?<div class="crypto-selected-region">[\s\S]*?id="cryptoSelectedChips" class="crypto-selected-chips" aria-live="polite"[\s\S]*?<div class="[^"]*crypto-selector-guidance"/.test(optionsHtml), "contains manual crypto search, selected coins, and guidance in dedicated semantic regions");
assert(["crypto-result-list", "crypto-result-action", "crypto-selected-chip", "crypto-chip-remove"].every((className) => optionsHtml.includes(`.${className}`)), "styles add results as compact actions and selections as removable chips");
const cryptoSelectedRegionRule = cssRuleBodyAt(optionsHtml, ".crypto-selected-region {");
assert(/padding:\s*10px 12px;/.test(cryptoSelectedRegionRule) && /border:\s*1px solid var\(--border\);/.test(cryptoSelectedRegionRule) && /background:\s*var\(--bg-surface\);/.test(cryptoSelectedRegionRule), "gives selected crypto chips their own padded inset region");
assert(/#cryptoManualField\.is-open\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/.test(optionsHtml), "allows the open manual crypto selector to grow without clipping its results or guidance");
const cryptoResultActionRule = cssRuleBodyAt(optionsHtml, ".crypto-result-action {");
const cryptoChipRemoveRule = cssRuleBodyAt(optionsHtml, ".crypto-chip-remove {");
assert(/min-height:\s*32px;/.test(cryptoResultActionRule) && /width:\s*32px;/.test(cryptoChipRemoveRule) && /height:\s*32px;/.test(cryptoChipRemoveRule), "keeps crypto add and remove controls at a 32px minimum target");
assert(optionsJs.includes('!selectedCrypto.some((item) => item.symbol === coin.id)') && optionsJs.includes('CRYPTO_CATALOG.filter((coin) => !selectedCrypto.some((item) => item.symbol === coin.id))'), "omits selected coins from manual crypto add results");
assert(popupJs.includes("Unavailable") && popupJs.includes("Stale"), "popup labels unavailable and stale watchlist quotes");
assert(!/id="addWatchBtn"/.test(popupHtml), "popup has no quick-add header action");
assert(!/quickAddInput|quickAddExchange|quickAddBtn/.test(popupHtml), "popup has no quick-add sheet inputs");
assert(!/doQuickAdd|setPlatformShortcut|enabledToggle|shortTimeAgo/.test(popupJs), "popup has no quick-add, shortcut, tape-toggle, or footer-update handlers");
assert(!/Ticker strip|Last updated|Local only|shortcut-hint/.test(popupHtml + popupJs), "popup omits tape controls and local-only or shortcut footer copy");
assert(/<button[^>]*id="openOptions"[^>]*aria-label="Settings"/.test(popupHtml), "popup retains one accessible Settings action");
assert((popupHtml.match(/class="icon-btn"/g) || []).length === 1, "Settings is the popup's only header action");
assert(/id="openOptions"[\s\S]*?<path d="M19\.14,12\.94a7\.43,7\.43/.test(popupHtml), "popup Settings action uses the standard cog silhouette");
const popupCogRule = cssRuleBodyAt(popupHtml, ".icon-btn {");
const popupCogPressedRule = cssRuleBodyAt(popupHtml, ".icon-btn:active {");
const popupReducedMotionCogRule = mediaRuleBody(popupHtml, "prefers-reduced-motion: reduce", ".icon-btn:active");
assert(/transition:[\s\S]*?transform/.test(popupCogRule) && /transform:\s*scale\(0\.96\)/.test(popupCogPressedRule), "popup Settings cog acknowledges press immediately with a compact transform");
assert(/transform:\s*none/.test(popupReducedMotionCogRule), "popup Settings cog keeps press feedback without transform when reduced motion is requested");
assert(/@media \(prefers-contrast: more\)/.test(brandCss) && /--bg-surface:\s*#(?:ffffff|18181a)/.test(brandCss) && /--border:\s*#(?:1d1d1f|f5f5f7)/.test(brandCss), "high-contrast mode uses near-solid MyTicker surfaces with clear borders");
assert(/@media \(prefers-contrast: more\)[\s\S]*?var\(--brand-gold\)/.test(optionsHtml + popupHtml), "high-contrast extension controls preserve gold focus and selection cues");
assert(popupHtml.includes('id="panelHoldings" role="tabpanel" aria-labelledby="tabHoldings"') && popupHtml.includes('id="panelWatchlist" role="tabpanel" aria-labelledby="tabWatchlist"'), "popup tabs control stable labelled tabpanels");
assert(popupJs.includes('event.key === "ArrowRight"') && popupJs.includes('event.key === "ArrowLeft"') && popupJs.includes('event.key === "Home"') && popupJs.includes('event.key === "End"'), "popup tabs support roving Arrow, Home, and End keyboard navigation");
assert(popupJs.includes('setAttribute("tabindex", selected ? "0" : "-1")'), "popup tab selection maintains a roving tabindex");
assert(optionsHtml.includes('@media (prefers-reduced-transparency: reduce)') && optionsHtml.includes('backdrop-filter: none') && optionsHtml.includes('background: var(--bg-surface);'), "reduced transparency replaces the settings-nav blur with a solid semantic surface");
const reducedMotionTickerExit = mediaRuleBody(tickerCss, "prefers-reduced-motion: reduce", ".pts-ticker-bar.pts-ticker-exiting");
assert(/\btransition\s*:\s*none\s*;/.test(reducedMotionTickerExit), "reduced-motion ticker exit removes its transition entirely");
assert(popupJs.includes("watch-asset") && popupJs.includes("formatWatchlistAssetLabel"), "popup renders a human-readable asset label for each watchlist item");
assert(popupHtml.includes("grid-template-columns: minmax(0, 1fr) auto auto auto auto"), "watchlist grid reserves a column for asset metadata without wrapping remove");
assert(optionsJs.includes("cryptoManualField.hidden = !open") && optionsJs.includes("cryptoManualField.inert = !open"), "non-manual crypto controls are hidden and inert");
assert(optionsJs.includes('resultList.className = "crypto-result-list"') && optionsJs.includes('button.className = "crypto-result-action"') && optionsJs.includes('chip.className = "crypto-selected-chip"') && optionsJs.includes('remove.className = "crypto-chip-remove"'), "renders the manual crypto controls with their contained selector semantics");
assert(!priceProvidersSource.includes("US/crypto: Finnhub"), "price provider header describes the implemented crypto providers");
for (const [name, source] of Object.entries({ backgroundSource, readmeSource, privacySource, storeListingSource })) {
  assert(source.includes("CoinGecko") && source.includes("Binance") && !/US\/crypto|for US stocks and crypto|Finnhub\/Binance/i.test(source), `${name} describes CoinGecko/Binance crypto sourcing without Finnhub crypto`);
}
assert(storeListingSource.includes("Bitcoin/BTC, Ethereum/ETH, BNB, XRP, and Solana/SOL") && !storeListingSource.includes("BINANCE:BTCUSDT"), "store listing describes the actual canonical manual crypto catalog");
assert(visibleText.includes("No Finnhub key is required for crypto quotes"), "states crypto quotes do not require a Finnhub key");
assert(visibleText.includes("Finnhub key is still required for US equities"), "keeps the US-equity Finnhub requirement distinct");
assert(visibleText.includes("third strip group, after holdings and watchlist"), "explains crypto strip placement");
assert(visibleText.includes("second strip group, after holdings"), "explains watchlist strip order");
assert(!visibleText.includes("Finnhub quotes via BINANCE:SYMBOL"), "removes the obsolete Finnhub-only crypto claim");
assert(!visibleText.includes("US equities and crypto need a free Finnhub key"), "removes the obsolete shared Finnhub requirement");
assert(brandCss.includes("--accent: #9fb0c3") && brandCss.includes("--green: #34d399"), "reserves emerald for positive market state and uses a neutral interaction accent");
assert(!optionsHtml.includes("background: var(--accent);") && !popupHtml.includes("background: var(--accent);"), "keeps the neutral interaction accent out of gold-branded primary surfaces");
assert(brandCss.includes("--brand-gold:") && brandCss.includes("--brand-gold-hover:") && brandCss.includes("--brand-gold-muted:"), "defines shared MyTicker gold, hover, and muted interaction tokens");
const systemDarkTokens = tokenMap(cssRuleBodyAt(brandCss, ":root {"));
const systemLightStart = brandCss.indexOf("/* ── Light theme (system) ── */");
const systemLightTokens = tokenMap(cssRuleBodyAt(brandCss, ":root {", systemLightStart));
const explicitLightTokens = tokenMap(cssRuleBodyAt(brandCss, 'html[data-theme="light"] {', brandCss.lastIndexOf('html[data-theme="light"] {')));
const explicitDarkTokens = tokenMap(cssRuleBodyAt(brandCss, 'html[data-theme="dark"] {', brandCss.lastIndexOf('html[data-theme="dark"] {')));
const goldThemes = [
  ["system dark", systemDarkTokens],
  ["system light", systemLightTokens],
  ["explicit light", explicitLightTokens],
  ["explicit dark", explicitDarkTokens]
];
const hasGoldTokens = (tokens) => ["brand-gold", "brand-gold-hover", "brand-gold-ink", "bg-surface"].every((name) => tokens[name]);
assert(goldThemes.every(([, tokens]) => hasGoldTokens(tokens)), "resolves a complete gold token set for system and explicit light/dark themes");
assert(goldThemes.every(([, tokens]) => hasGoldTokens(tokens) && contrastRatio(tokens["brand-gold"], tokens["bg-surface"]) >= 4.5 && contrastRatio(tokens["brand-gold-hover"], tokens["bg-surface"]) >= 4.5), "keeps gold link and hover text at WCAG AA contrast in every resolved theme");
assert(goldThemes.every(([, tokens]) => hasGoldTokens(tokens) && contrastRatio(tokens["brand-gold"], tokens["brand-gold-ink"]) >= 4.5 && contrastRatio(tokens["brand-gold-hover"], tokens["brand-gold-ink"]) >= 4.5), "keeps primary gold control text at WCAG AA contrast in normal and hover states");
assert(goldThemes.every(([, tokens]) => ["text-tertiary", "bg", "bg-surface"].every((name) => tokens[name]) && contrastRatio(tokens["text-tertiary"], tokens.bg) >= 4.5 && contrastRatio(tokens["text-tertiary"], tokens["bg-surface"]) >= 4.5), "keeps tertiary text at WCAG AA contrast on canonical page and surface backgrounds");
assert(/\.checklist-item\.done \.check-icon\s*\{[\s\S]*?background:\s*var\(--bg-surface\)[\s\S]*?color:\s*var\(--green\)/.test(popupHtml) && goldThemes.every(([, tokens]) => ["green", "bg-surface"].every((name) => tokens[name]) && contrastRatio(tokens.green, tokens["bg-surface"]) >= 4.5), "keeps the 11px success glyph at WCAG AA contrast against its resolved neutral checklist chip background");
assert((brandCss.match(/--brand-gold:/g) || []).length === 4 && (brandCss.match(/--brand-gold-hover:/g) || []).length === 4, "declares gold tokens once per canonical theme layer without overridden duplicates");
assert(!/transition:\s*all\s+0\.15s\s+ease/.test(optionsHtml + popupHtml), "uses motion tokens and explicit transition properties instead of transition-all");
assert(/html\[data-theme="dark"\]\s*\{[\s\S]*?--bg:\s*#0c0c0d;[\s\S]*?--bg-surface:\s*#18181a;/.test(brandCss), "uses graphite and obsidian rather than slate-blue dark surfaces");
assert(/\.tab\[aria-selected="true"\]::after\s*\{[\s\S]*?background:\s*var\(--brand-gold\)/.test(popupHtml), "uses MyTicker gold for the selected popup tab underline");
assert(/\.icon-btn:focus-visible\s*\{[\s\S]*?var\(--brand-gold\)/.test(popupHtml), "uses MyTicker gold for the Settings gear focus ring");
assert(/\.section-head \.link-quiet:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--brand-gold\)[\s\S]*?min-height:\s*32px/.test(popupHtml), "gives the quiet popup action a gold keyboard focus ring and a 32px target");
assert(/\.watch-remove:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--brand-gold\)/.test(popupHtml), "gives watchlist removal a gold keyboard focus ring");
assert(/button\.checklist-item:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--brand-gold\)/.test(popupHtml), "gives checklist actions a gold keyboard focus ring");
assert(/\.help-row a:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--brand-gold\)/.test(popupHtml), "gives the P&L methodology link a gold keyboard focus ring");
assert(/\.help-row a\s*\{[\s\S]*?color:\s*var\(--brand-gold\)/.test(popupHtml) && /\.section-head \.link-quiet\s*\{[\s\S]*?color:\s*var\(--brand-gold\)/.test(popupHtml), "uses MyTicker gold for explanatory and action links");
assert(/\.btn-setup\s*\{[\s\S]*?background:\s*var\(--brand-gold\)[\s\S]*?color:\s*var\(--brand-gold-ink\)/.test(popupHtml), "uses the paired MyTicker gold and ink tokens for the popup primary action");
assert(/\.pnl-positive\s*\{\s*color:\s*var\(--green\);\s*\}/.test(popupHtml) && /\.pnl-negative\s*\{\s*color:\s*var\(--red\);\s*\}/.test(popupHtml), "keeps green and red reserved for positive and negative market values");
assert(/\.settings-tab\[aria-selected="true"\]::after\s*\{[\s\S]*?background:\s*var\(--brand-gold\)/.test(optionsHtml), "uses MyTicker gold for the selected Settings tab underline");
assert(/\.btn-primary\s*\{[\s\S]*?background:\s*var\(--brand-gold\)[\s\S]*?color:\s*var\(--brand-gold-ink\)/.test(optionsHtml) && /\.btn-primary:hover\s*\{[\s\S]*?background:\s*var\(--brand-gold-hover\)/.test(optionsHtml), "uses paired MyTicker gold tokens for Settings primary CTAs");
assert(/\.btn:focus-visible,[\s\S]*?outline:\s*2px solid var\(--brand-gold\)/.test(optionsHtml) && /\.settings-tab:focus-visible::before\s*\{[\s\S]*?border:\s*1px solid var\(--brand-gold\)/.test(optionsHtml), "uses MyTicker gold for visible Settings keyboard focus");
assert(/input\[type="text"\]:focus,[\s\S]*?border-color:\s*var\(--brand-gold\)[\s\S]*?box-shadow:\s*0 0 0 3px var\(--brand-gold-muted\)/.test(optionsHtml), "uses gold rather than slate for Settings field focus");
assert(/\.golden-path-sample\s*\{[\s\S]*?color:\s*var\(--brand-gold\)/.test(optionsHtml) && optionsHtml.includes('style="color: var(--brand-gold); text-decoration: none;">finnhub.io</a>'), "uses MyTicker gold for Settings explanatory and action links");
assert(!/\.settings-tab\[aria-selected="true"\]::after\s*\{[\s\S]*?background:\s*var\(--accent\)/.test(optionsHtml) && !/\.btn-primary\s*\{[\s\S]*?background:\s*var\(--accent\)/.test(optionsHtml), "does not retain the neutral accent on Settings gold interaction primitives");
assert(/color:\s*var\(--green\)/.test(cssRuleBodyAt(optionsHtml, ".wizard-step.done")), "keeps completed Settings wizard steps in the semantic success color");
assert(/\.checklist-item\.done \.check-icon\s*\{[\s\S]*?border:\s*1px solid color-mix\(in srgb, var\(--green\) 45%, transparent\)[\s\S]*?color:\s*var\(--green\)/.test(popupHtml), "keeps completed popup checklist steps visibly semantic without tinting the glyph background");
const completedChecklistRule = cssRuleBodyAt(popupHtml, ".checklist-item.done");
assert(!/\bopacity\s*:/.test(completedChecklistRule) && /color:\s*var\(--text-secondary\)/.test(completedChecklistRule), "keeps completed checklist copy distinct without attenuating success contrast");
assert(optionsJs.includes('window.addEventListener("hashchange", () => applyLocationHash())') && optionsJs.includes('window.addEventListener("popstate", () => applyLocationHash())'), "applies valid settings hashes after Back and Forward navigation");
assert(optionsJs.includes('switchSettingsTab(tabId, { updateHash: false })') && optionsJs.includes('location.hash !== `#${tabId}`'), "handles location-driven tabs without a hash event loop");
assert(optionsJs.includes('history.pushState(null, "", `#${tabId}`)'), "user-selected settings tabs create browser history entries for Back and Forward navigation");
assert(optionsJs.includes('["setup", "market", "diagnostics", "tips"].includes(requested) ? "data" : requested'), "maps legacy settings hashes to the consolidated Data tab");
assert(optionsJs.includes('return requested ? (["setup", "market", "diagnostics", "tips"].includes(requested) ? "data" : requested) : "portfolio";'), "maps an empty settings hash to Portfolio for browser Back navigation");
assert(optionsHtml.includes('id="nav-data" data-tab="data" aria-selected="false" aria-controls="tab-data"'), "Data tab controls its single composite panel");
assert((optionsHtml.match(/role="tabpanel" aria-labelledby="nav-data"/g) || []).length === 1, "Data tab is the label for exactly one tabpanel");
assert(optionsHtml.includes('id="tab-data" role="tabpanel" aria-labelledby="nav-data" hidden'), "Data sections are wrapped by the composite Data tabpanel");
assert(optionsJs.includes('["tab-setup", "section-error-log", "tab-market", "tab-diagnostics", "tab-tips"]') && optionsJs.includes('dataPanel.append(section)'), "moves all Data sections into the composite panel before tab activation");
assert(/\.toggle-switch\s*\{[\s\S]*?height: 32px;/.test(optionsHtml), "toggle controls provide a 32px minimum hit area");
assert(optionsHtml.includes('<legend class="field-label">Tape size</legend>'), "uses the concise Tape size label");
assert(popupHtml.includes("font-variant-numeric: tabular-nums") && optionsHtml.includes("font-variant-numeric: tabular-nums"), "uses tabular numerals across market UI");
assert(optionsHtml.includes('name="theme"') && optionsHtml.includes('value="system"') && optionsHtml.includes('value="light"') && optionsHtml.includes('value="dark"'), "offers system, light, and dark theme controls");
assert(optionsJs.includes("applyDocumentTheme") && popupJs.includes("applyPopupTheme") && optionsJs.includes("DATA_PANEL_IDS"), "applies the selected theme and preserves consolidated data panels");
assert(brandCss.includes("--weight-display: 700") && brandCss.includes("--weight-section: 600") && brandCss.includes("--weight-label: 500") && brandCss.includes("--weight-body: 400"), "defines the intended type-weight hierarchy");
assert(/\.page\s*\{[^}]*padding:\s*1\.75rem\s+1\.5rem\s+3rem/.test(optionsHtml), "Settings page uses root-relative padding while preserving its 28/24/48px default rhythm");
assert(/\.settings-card\s*\{[^}]*padding:\s*24px/.test(optionsHtml), "Settings form cards use a consistent 24px inset");
assert(/\.form-stack\s*\{[^}]*display:\s*grid[^}]*gap:\s*16px/.test(optionsHtml), "Settings form stacks use a 16px rhythm");
assert(/\.form-stack\s+\.field\s*\{[^}]*gap:\s*8px/.test(optionsHtml), "Settings fields pair labels and controls with an 8px rhythm");
assert(/\.form-action-row\s*\{[^}]*margin-top:\s*16px/.test(optionsHtml), "Settings actions are separated from fields by 16px");
assert(/\.configured-list\s*\{[^}]*padding:\s*12px\s+14px/.test(optionsHtml), "Configured watchlist state has a padded list container");
assert(/\.configured-list\.field-hint\s*\{[^}]*margin-top:\s*16px/.test(optionsHtml), "Configured watchlist spacing overrides the later helper-text margin");
assert(/\.btn-row\.form-action-row\s*\{[^}]*padding:\s*0/.test(optionsHtml), "Watchlist action-row padding explicitly overrides the base button row");
const watchlistCard = optionsHtml.match(/<div class="card settings-card">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<div class="section" id="section-error-log"/)?.[1] || "";
assert(/class="form-stack"[\s\S]*?id="watchlistType"[\s\S]*?id="watchlistExchange"[\s\S]*?id="watchlistInput"[\s\S]*?id="watchlistHint"[\s\S]*?id="watchlistError"[\s\S]*?id="addWatchlistButton"[\s\S]*?id="watchlistConfigured"/.test(watchlistCard), "Watchlist follows market, exchange, symbol/hint, error, action, then configured-list order");
assert(optionsJs.includes('button.textContent = saved ? "Saved ✓" : "Save"') && optionsJs.includes('function setSettingsSaveFeedback(scope, saved, message = "")'), "Crypto and Appearance Save controls provide persistent saved feedback");
assert(optionsJs.includes('if (!storageSaveSucceeded())') && optionsJs.includes('setSettingsSaveFeedback("appearance", true)') && optionsJs.includes('setSettingsSaveFeedback("crypto", true)'), "only marks settings saved after each storage write succeeds");
assert(optionsJs.includes('markSettingsSaveDirty("appearance")') && optionsJs.includes('markSettingsSaveDirty("crypto")'), "returns saved controls to Save when their relevant settings change");
assert(optionsJs.includes('selectedCrypto.push({ symbol: coin.id, quantity: 1 });\n        markSettingsSaveDirty("crypto")') && optionsJs.includes('selectedCrypto = selectedCrypto.filter((entry) => entry.symbol !== item.symbol);\n      markSettingsSaveDirty("crypto")'), "manual crypto additions and removals reset the saved acknowledgement");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
