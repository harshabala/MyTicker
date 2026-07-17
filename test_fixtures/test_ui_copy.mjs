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

const [popupHtml, popupJs, optionsHtml, optionsJs, brandCss, motionCss, tickerCss, manifestSource, priceProvidersSource, backgroundSource, contentScriptSource, contentSharedSource, csvParserSource, metricsSource, onboardingSource, sharedSource, vaultSource, readmeSource, privacySource, storeListingSource] = await Promise.all([
  readFile(new URL("../popup.html", import.meta.url), "utf8"),
  readFile(new URL("../popup.js", import.meta.url), "utf8"),
  readFile(new URL("../options.html", import.meta.url), "utf8"),
  readFile(new URL("../options.js", import.meta.url), "utf8"),
  readFile(new URL("../brand.css", import.meta.url), "utf8"),
  readFile(new URL("../motion.css", import.meta.url), "utf8"),
  readFile(new URL("../ticker.css", import.meta.url), "utf8"),
  readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../priceProviders.js", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8"),
  readFile(new URL("../contentScript.js", import.meta.url), "utf8"),
  readFile(new URL("../contentShared.js", import.meta.url), "utf8"),
  readFile(new URL("../csvParser.js", import.meta.url), "utf8"),
  readFile(new URL("../metrics.js", import.meta.url), "utf8"),
  readFile(new URL("../onboarding.js", import.meta.url), "utf8"),
  readFile(new URL("../shared.js", import.meta.url), "utf8"),
  readFile(new URL("../vault.js", import.meta.url), "utf8"),
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

console.log("\n🎞️ Tape motion safety");
assert(!contentScriptSource.includes("BODY_TRANSITION_ATTR") && !/offsetHeight/.test(contentScriptSource) && !/style\.transition\s*=\s*`margin-top/.test(contentScriptSource), "reserves and restores page layout immediately without animating margin or forcing a synchronous reflow");
assert(!/body \*,\s*\n\s*body \*::before,\s*\n\s*body \*::after/.test(motionCss), "does not globally suppress every extension transition for reduced-motion users");
assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.btn-pressable:active[\s\S]*?transform:\s*none/.test(motionCss), "keeps reduced-motion policy scoped to positional button feedback");
assert(/\.pts-ticker-bar\.pts-reduced-motion[\s\S]*?animation:\s*none[\s\S]*?transition:\s*none/.test(tickerCss), "stops tape movement and bar transitions while preserving the static readable tape");

console.log("\n🔒 Release-gate privacy and extension-boundary audit");
const expectedProviderHosts = [
  "https://finnhub.io/*",
  "https://query1.finance.yahoo.com/*",
  "https://query2.finance.yahoo.com/*",
  "https://api.coingecko.com/*",
  "https://data-api.binance.vision/*"
];
assert(JSON.stringify(manifest.host_permissions) === JSON.stringify(expectedProviderHosts), "declares only the required Yahoo, CoinGecko, Binance, and Finnhub provider hosts");
assert(manifest.content_security_policy?.extension_pages === "script-src 'self'; object-src 'self';", "pins extension pages to self-hosted scripts with an explicit MV3 CSP");
assert(manifest.permissions?.length === 2 && manifest.permissions.includes("storage") && manifest.permissions.includes("alarms"), "requests only storage and alarms extension permissions");
assert(manifest.web_accessible_resources?.length === 1 && manifest.web_accessible_resources[0]?.resources?.length === 1 && manifest.web_accessible_resources[0]?.resources?.[0] === "ticker.css" && manifest.web_accessible_resources[0]?.matches?.join() === "<all_urls>", "exposes only the tape stylesheet to pages where the closed shadow-root tape needs it");
const releaseCopy = `${readmeSource}\n${privacySource}\n${storeListingSource}`;
for (const host of ["finnhub.io", "query1.finance.yahoo.com", "query2.finance.yahoo.com", "api.coingecko.com", "data-api.binance.vision"]) {
  assert(releaseCopy.includes(host), `discloses the ${host} remote host`);
}
assert(/all pages[\s\S]{0,160}(?:reserve space|before page content)/i.test(releaseCopy), "explains all-page tape access as early layout reservation before page content");
assert(/encrypted[\s\S]{0,120}(?:local|browser)[\s\S]{0,160}(?:session|restart)/i.test(releaseCopy), "discloses the encrypted local Finnhub vault and session-only unlock after restart");
assert(/no portfolio telemetry/i.test(releaseCopy), "explicitly rules out portfolio telemetry");
const extensionSource = [backgroundSource, contentScriptSource, contentSharedSource, csvParserSource, metricsSource, onboardingSource, optionsJs, popupJs, priceProvidersSource, sharedSource, vaultSource].join("\n");
assert(!/\beval\s*\(|new\s+Function\s*\(|https?:\/\/[^\s'"`]+\.js/i.test(extensionSource), "contains no unsafe dynamic code or remotely hosted JavaScript");
assert(!/innerHTML\s*=\s*`[^`]*\$\{/m.test(extensionSource), "keeps HTML insertion free of interpolated values");
for (const tab of ["portfolio", "watchlist", "crypto", "data", "appearance"]) {
  assert(optionsHtml.includes(`data-tab="${tab}"`), `includes ${tab} in the task-based settings navigation`);
}
assert(!optionsHtml.includes('data-tab="setup"') && !optionsHtml.includes('data-tab="market"') && !optionsHtml.includes('data-tab="optional"'), "replaces implementation-oriented settings tabs with task-based navigation");
assert(optionsHtml.includes('id="copyDiagnosticsButton"'), "includes a copy diagnostics button");
assert(optionsHtml.includes("Protect your Finnhub key") && optionsHtml.includes('id="saveProviderButton">Create unlock code') && optionsHtml.includes('id="unlockVaultButton"') && optionsHtml.includes('id="lockVaultButton"') && optionsHtml.includes('id="replaceVaultButton"'), "offers clear compact encrypted Finnhub create, unlock, lock, and replace controls");
assert(/<details class="provider-key-disclosure" id="section-finnhub-key">/.test(optionsHtml) && !/<details class="provider-key-disclosure" id="section-finnhub-key"[^>]*\sopen/.test(optionsHtml), "US Finnhub key form is nested in a disclosure closed by default");
assert(optionsHtml.includes("Manage Finnhub key") && optionsHtml.includes('id="finnhubApiKey"') && optionsHtml.includes('id="vaultUnlockCode"') && optionsHtml.includes('id="vaultUnlockConfirm"') && optionsHtml.includes('id="vaultStatus"') && optionsHtml.includes('id="testConnectionButton"') && optionsHtml.includes('id="providerStatus"') && optionsHtml.includes('id="vaultProtectionTitle"') && optionsHtml.includes('id="toggleApiKeyVisibility"'), "preserves Manage Finnhub key control and all Finnhub vault element IDs");
assert(optionsJs.includes("openFinnhubKeyDisclosure") && optionsJs.includes("sectionFinnhubKey.open = true") && optionsJs.includes("sectionMarket.open = true") && optionsJs.includes("step === 1 ? (sectionFinnhubKey || sectionMarket)"), "Manage keys wizard opens Data market section and the US key disclosure");
assert(optionsHtml.includes('id="testIndiaButton"') && optionsHtml.includes('id="indiaStatus"'), "keeps India provider test controls compact and available");
assert(!optionsJs.includes('finnhubApiKeyEl.value = savedKey') && optionsJs.includes('sendVaultMessage("vault-status")'), "does not preload the Finnhub key and requests non-secret vault status");
assert(optionsJs.includes('"key unlocked" : "key locked") : "not configured"'), "diagnostics distinguish Finnhub not-configured, locked, and unlocked states");
assert(optionsJs.includes('sendVaultMessage("vault-test-connection")'), "tests an already unlocked Finnhub key through the worker without rendering it");
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
const setupWelcomeRule = cssRuleBodyAt(optionsHtml, ".setup-welcome {");
const warnBannerRule = cssRuleBodyAt(optionsHtml, ".warn-banner {");
const cryptoManualFieldRule = cssRuleBodyAt(optionsHtml, "#cryptoManualField {");
assert(!/transition\s*:/.test(setupWelcomeRule) && !/max-height|padding:\s*0/.test(setupWelcomeRule), "shows setup guidance instantly instead of animating layout properties");
assert(!/transition\s*:/.test(warnBannerRule) && !/max-height|padding:\s*0/.test(warnBannerRule), "shows rate-limit guidance instantly instead of animating layout properties");
assert(!/transition\s*:/.test(cryptoManualFieldRule) && !/max-height|padding-(?:top|bottom)\s*:/.test(cryptoManualFieldRule), "shows the manual crypto selector instantly without clipping or layout animation");
assert(optionsJs.includes("setupWelcomeEl.hidden = !showWelcome") && optionsJs.includes("rateLimitWarnEl.hidden = !status.rateLimitRisk"), "uses native hidden state for instantaneous setup disclosures");
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
assert(/id="openOptions"[\s\S]*?data-icon="phosphor-gear-six"[\s\S]*?viewBox="0 0 256 256"/.test(popupHtml), "popup Settings action uses the Phosphor GearSix regular icon");
const popupCogRule = cssRuleBodyAt(popupHtml, ".icon-btn {");
const popupCogPressedRule = cssRuleBodyAt(popupHtml, ".icon-btn:active {");
const popupReducedMotionCogRule = mediaRuleBody(popupHtml, "prefers-reduced-motion: reduce", ".icon-btn:active");
assert(/transition:[\s\S]*?transform/.test(popupCogRule) && /transform:\s*scale\(0\.96\)/.test(popupCogPressedRule), "popup Settings cog acknowledges press immediately with a compact transform");
assert(/transform:\s*none/.test(popupReducedMotionCogRule), "popup Settings cog keeps press feedback without transform when reduced motion is requested");
assert(/@media \(prefers-contrast: more\)/.test(brandCss) && /--bg-surface:\s*#(?:ffffff|18181a)/.test(brandCss) && /--border:\s*#(?:1d1d1f|f5f5f7)/.test(brandCss), "high-contrast mode uses near-solid MyTicker surfaces with clear borders");
assert(/@media \(prefers-contrast: more\)[\s\S]*?var\(--brand-gold\)/.test(optionsHtml + popupHtml), "high-contrast extension controls preserve gold focus and selection cues");
const settingsTabBaseStart = optionsHtml.indexOf(".settings-tab {", optionsHtml.indexOf("/* Settings tabs"));
const settingsTabContrastStart = optionsHtml.indexOf("@media (prefers-contrast: more)");
const settingsTabContrastRuleStart = optionsHtml.indexOf(".settings-tab {", settingsTabContrastStart);
assert(settingsTabContrastStart > settingsTabBaseStart && settingsTabContrastRuleStart > settingsTabBaseStart && /border:\s*1px solid var\(--border\)/.test(cssRuleBodyAt(optionsHtml, ".settings-tab {", settingsTabContrastRuleStart)), "high-contrast Settings tab borders override the base border reset by source order");
assert(popupHtml.includes('id="panelHoldings" role="tabpanel" aria-labelledby="tabHoldings"') && popupHtml.includes('id="panelWatchlist" role="tabpanel" aria-labelledby="tabWatchlist"'), "popup tabs control stable labelled tabpanels");
assert(popupJs.includes('event.key === "ArrowRight"') && popupJs.includes('event.key === "ArrowLeft"') && popupJs.includes('event.key === "Home"') && popupJs.includes('event.key === "End"'), "popup tabs support roving Arrow, Home, and End keyboard navigation");
assert(popupJs.includes('setAttribute("tabindex", selected ? "0" : "-1")'), "popup tab selection maintains a roving tabindex");
assert(optionsHtml.includes('@media (prefers-reduced-transparency: reduce)') && optionsHtml.includes('backdrop-filter: none') && optionsHtml.includes('background: var(--bg-surface);'), "reduced transparency replaces the settings-nav blur with a solid semantic surface");
const reducedMotionTickerExit = mediaRuleBody(tickerCss, "prefers-reduced-motion: reduce", ".pts-ticker-bar.pts-ticker-exiting");
assert(/\btransition\s*:\s*none\s*;/.test(reducedMotionTickerExit), "reduced-motion ticker exit removes its transition entirely");
assert(popupJs.includes("watch-asset") && popupJs.includes("formatWatchlistAssetLabel"), "popup renders a human-readable asset label for each watchlist item");
assert(popupHtml.includes("grid-template-columns: minmax(0, 1fr) auto auto auto auto"), "watchlist grid reserves a column for asset metadata without wrapping remove");
assert(optionsJs.includes("cryptoManualField.hidden = !open") && optionsJs.includes("cryptoManualField.inert = !open"), "non-manual crypto controls are hidden and inert");
const reducedMotionOptions = mediaRuleBody(optionsHtml, "prefers-reduced-motion: reduce", ".toggle-slider::before");
assert(/transition\s*:\s*none\s*!important\s*;/.test(reducedMotionOptions), "reduced-motion preferences make toggle-thumb position changes immediate");
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
assert(!/grid-template-rows\s*:/.test(optionsHtml) && !/details\.crypto-details\s*>\s*div\s*\{[\s\S]*?transition:/.test(optionsHtml), "opens crypto details immediately instead of animating layout geometry");
assert(/target\.scrollIntoView\(\{ behavior: prefersReducedMotion\(\) \? "auto" : "smooth", block: "start" \}\)/.test(optionsJs), "uses an instant wizard scroll for reduced-motion users");
assert(/\.btn-copy-entry\s*\{[\s\S]*?transition:\s*color var\(--motion-fast\) var\(--ease-out\), border-color var\(--motion-fast\) var\(--ease-out\);/.test(optionsHtml), "limits copy affordance motion to its color and border changes");
assert(!/fadeOutView\(/.test(popupJs) && !/waitMs\(/.test(popupJs), "does not make popup state changes wait for a symmetric fade-out");
assert(/function mountView\(container, viewEl, viewName, \{ animate = false \} = \{\}\)/.test(popupJs), "keeps popup view mounting immediate unless a deliberate transition is requested");
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
assert(optionsJs.includes('function setSettingsSaveFeedback(scope, saved, message = "")') && optionsJs.includes('"Saved ✓"') && optionsJs.includes('scope === "appearance" ? "Save changes" : "Save"'), "Crypto and Appearance Save controls provide persistent saved feedback");
assert(optionsHtml.includes('id="saveAppearanceButton">Save changes</button>') && optionsHtml.includes('id="saveCryptoButton">Save</button>'), "Appearance uses Save changes; Crypto keeps Save");
assert(optionsHtml.includes('id="tickerSpeedRange"') && optionsHtml.includes('id="tickerSpeed"') && /id="tickerSpeedRange"[^>]*min="5"[^>]*max="300"/.test(optionsHtml) && /id="tickerSpeed"[^>]*min="5"[^>]*max="300"/.test(optionsHtml), "ticker speed exposes linked range and number controls from 5 to 300");
assert(optionsJs.includes("setTickerSpeedControls") && optionsJs.includes("tickerSpeedRangeEl"), "options.js keeps range and number ticker speed controls in sync");
assert(optionsHtml.includes('name="theme"') && optionsHtml.includes('--brand-gold-muted') && /tape-size-options label:has\(input:checked\)[\s\S]*?border-color:\s*var\(--brand-gold\)/.test(optionsHtml), "selected theme/tape-size options use gold outline selection styling");
assert(optionsJs.includes('if (!storageSaveSucceeded())') && optionsJs.includes('setSettingsSaveFeedback("appearance", true)') && optionsJs.includes('setSettingsSaveFeedback("crypto", true)'), "only marks settings saved after each storage write succeeds");
assert(optionsJs.includes('markSettingsSaveDirty("appearance")') && optionsJs.includes('markSettingsSaveDirty("crypto")'), "returns saved controls to Save when their relevant settings change");
assert(optionsJs.includes('selectedCrypto.push({ symbol: coin.id, quantity: 1 });\n        markSettingsSaveDirty("crypto")') && optionsJs.includes('selectedCrypto = selectedCrypto.filter((entry) => entry.symbol !== item.symbol);\n      markSettingsSaveDirty("crypto")'), "manual crypto additions and removals reset the saved acknowledgement");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
