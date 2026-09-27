import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createChromeFake, loadBackground, send, jsonResponse } from "./helpers.mjs";

const yahoo = JSON.parse(await readFile(new URL("../test_fixtures/providers/yahoo_chart_tcs_5d.json", import.meta.url), "utf8"));
const holdings = [
  { symbol: "TCS.NS", quantity: 50, currency: "INR", brokerId: "zerodha" },
  { symbol: "INFY.NS", quantity: 10, currency: "INR", brokerId: "zerodha" }
];

function setup(fetchImpl, extra = {}) {
  const fake = createChromeFake({
    sync: { pts_settings: { enabled: true } },
    local: { pts_holdings: holdings, ...extra }
  });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return fetchImpl(String(url), init);
  };
  return { fake, calls };
}

test("service worker schedules polling with chrome.alarms on startup, never setInterval", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval\(/);
  const { fake } = setup(() => jsonResponse(yahoo));
  await loadBackground(fake, "alarms");
  assert.ok(fake.alarms.has("price-poll"), "alarm re-created when a restarted worker finds none");
  assert.equal(fake.alarms.get("price-poll").periodInMinutes, 1);
});

test("a full poll writes P&L from the prior session close and a live state", async () => {
  const { fake } = setup(() => jsonResponse(yahoo));
  await loadBackground(fake, "full");
  assert.deepEqual(await send(fake.listeners, { type: "poll-now", payload: {} }), { ok: true });
  const state = fake.local.get("pts_positions_state");
  const tcs = state.positions.find((p) => p.symbol === "TCS.NS");
  assert.ok(Math.abs(tcs.dayPnl - (3556.8 - 3520) * 50) < 1e-6);
  assert.equal(state.displayCurrency, "INR");
  assert.equal(state.staleWarning, undefined);
  assert.equal(state.refreshMinutes, 1);
});

test("partial outage: the missing holding is stale and the state is flagged stale", async () => {
  const { fake } = setup((url) => (url.includes("INFY") ? new Response("", { status: 500 }) : jsonResponse(yahoo)));
  await loadBackground(fake, "partial");
  await send(fake.listeners, { type: "poll-now", payload: {} });
  const state = fake.local.get("pts_positions_state");
  assert.equal(state.staleWarning, true);
  assert.equal(state.positions.find((p) => p.symbol === "INFY.NS").stale, true);
  assert.equal(state.aggregate.partial, true);
  assert.ok(fake.local.get("pts_provider_backoff").yahoo, "5xx persisted as backoff for the next worker");
});

test("total failure keeps the previous prices but never presents them as live", async () => {
  const history = { "TCS.NS": [{ t: Date.now() - 60_000, p: 3500, prevClose: 3400 }] };
  const { fake } = setup(() => { throw new TypeError("Failed to fetch"); }, { pts_price_history: history });
  await loadBackground(fake, "total");
  await send(fake.listeners, { type: "poll-now", payload: {} });
  const state = fake.local.get("pts_positions_state");
  assert.equal(state.staleWarning, true);
  assert.equal(state.positions.find((p) => p.symbol === "TCS.NS").lastPrice, 3500);
  assert.deepEqual(fake.local.get("pts_price_history")["TCS.NS"], history["TCS.NS"], "history not corrupted");
});

test("a persisted backoff is honoured by a restarted worker: no requests while paused", async () => {
  const { fake, calls } = setup(() => jsonResponse(yahoo), { pts_provider_backoff: { yahoo: { failures: 1, until: Date.now() + 60_000 } } });
  await loadBackground(fake, "backoff");
  await send(fake.listeners, { type: "poll-now", payload: {} });
  assert.equal(calls.filter((u) => u.includes("yahoo")).length, 0);
  assert.equal(fake.local.get("pts_positions_state").staleWarning, true);
});

test("holdings cleared mid-poll are not resurrected by the in-flight write", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { fake } = setup(async () => { await gate; return jsonResponse(yahoo); });
  await loadBackground(fake, "race");
  const pending = send(fake.listeners, { type: "poll-now", payload: {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  fake.local.delete("pts_holdings");
  fake.local.delete("pts_positions_state");
  release();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const state = fake.local.get("pts_positions_state");
  assert.ok(state === undefined || state === null, "stale positions were not written back");
});

test("a storage failure during the write leaves the previous state intact", async () => {
  const previous = { positions: [], aggregate: {}, updatedAt: 1 };
  const { fake } = setup(() => jsonResponse(yahoo), { pts_positions_state: previous });
  fake.hooks.beforeSet = async (values) => {
    if ("pts_positions_state" in values) throw new Error("QUOTA_BYTES quota exceeded");
  };
  await loadBackground(fake, "quota");
  assert.deepEqual(await send(fake.listeners, { type: "poll-now", payload: {} }), { ok: true });
  assert.deepEqual(fake.local.get("pts_positions_state"), previous);
});

test("messages: unknown types and non-extension senders get no response and no side effects", async () => {
  const { fake, calls } = setup(() => jsonResponse(yahoo));
  await loadBackground(fake, "messages");
  const page = { id: "test-extension-id", tab: { id: 1 }, frameId: 0, url: "https://evil.example/" };
  for (const message of [
    { type: "poll-now", payload: {} },
    { type: "vault-status", payload: {} },
    { type: "vault-unlock", payload: { unlockCode: "123456" } },
    { type: "vault-test-connection", payload: {} },
    { type: "get-holdings", payload: {} },
    { type: "vault-create", payload: { apiKey: "x", unlockCode: "123456" } }
  ]) {
    assert.equal(await send(fake.listeners, message, page), undefined, message.type);
  }
  assert.equal(await send(fake.listeners, { type: "get-holdings", payload: {} }), undefined, "unknown type from a trusted page");
  assert.equal(await send(fake.listeners, { type: "poll-now" }), undefined, "missing payload");
  assert.equal(await send(fake.listeners, "poll-now"), undefined, "non-object message");
  assert.equal(calls.length, 0);
  assert.equal(fake.local.has("pts_finnhub_vault"), false);
});
