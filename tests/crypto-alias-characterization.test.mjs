import assert from "node:assert/strict";
import test from "node:test";
import { resolveCryptoCatalogEntry } from "../shared.js";

/** Pre-refactor table from origin/main background.js CRYPTO_ID_BY_SYMBOL. */
const CRYPTO_ID_BY_SYMBOL = {
  bitcoin: "bitcoin",
  btc: "bitcoin",
  btcusdt: "bitcoin",
  ethereum: "ethereum",
  eth: "ethereum",
  ethusdt: "ethereum",
  binancecoin: "binancecoin",
  bnb: "binancecoin",
  bnbusdt: "binancecoin",
  ripple: "ripple",
  xrp: "ripple",
  xrpusdt: "ripple",
  solana: "solana",
  sol: "solana",
  solusdt: "solana"
};

test("resolveCryptoCatalogEntry matches every old CRYPTO_ID_BY_SYMBOL alias", () => {
  const diffs = [];
  for (const [alias, oldId] of Object.entries(CRYPTO_ID_BY_SYMBOL)) {
    const got = resolveCryptoCatalogEntry(alias)?.id ?? null;
    if (got !== oldId) diffs.push({ alias, oldId, got });
  }
  assert.deepEqual(diffs, [], "alias resolution changed vs pre-refactor table");
});
