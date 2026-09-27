import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseCsv, parseBrokerNumber, mapRowsToHoldings, diagnoseCsvImport, mapRowsToCryptoHoldings,
  BROKER_PRESETS, CSV_LIMITS, CsvLimitError
} from "../csvParser.js";

const fixture = (name) => readFile(new URL(`../test_fixtures/${name}`, import.meta.url), "utf8");
const zerodha = BROKER_PRESETS.zerodha;
const mapZerodha = (rows) => mapRowsToHoldings(rows, zerodha.columns, "zerodha", zerodha.defaults);

test("Zerodha golden path: sample export maps to NSE holdings in INR", async () => {
  const rows = parseCsv(await fixture("sample_holdings_zerodha.csv"));
  assert.equal(diagnoseCsvImport(rows, zerodha), null);
  const holdings = mapZerodha(rows);
  assert.equal(holdings.length, 5);
  assert.deepEqual(holdings[0], { brokerId: "zerodha", symbol: "TCS.NS", exchange: "NSE", quantity: 50, avgPrice: 3485.5, currency: "INR", displayName: "TCS" });
  assert.ok(holdings.every((h) => h.currency === "INR" && h.symbol.endsWith(".NS")));
});

test("generic US CSV keeps USD", async () => {
  const holdings = mapRowsToHoldings(parseCsv(await fixture("sample_holdings_generic.csv")), BROKER_PRESETS.generic.columns, "generic");
  assert.equal(holdings.length, 10);
  assert.ok(holdings.every((h) => h.currency === "USD" && !h.symbol.includes(".NS")));
});

test("a missing or contradictory currency column follows the quote source", () => {
  const rows = parseCsv("symbol,exchange,quantity,avgPrice\nAAPL,NASDAQ,1,100\nTCS,NSE,1,100\n");
  const holdings = mapRowsToHoldings(rows, BROKER_PRESETS.generic.columns, "generic");
  assert.deepEqual(holdings.map((h) => [h.symbol, h.currency]), [["AAPL", "USD"], ["TCS.NS", "INR"]]);
  const wrong = parseCsv("symbol,exchange,quantity,avgPrice,currency\nAAPL,NASDAQ,1,100,INR\nINFY,nse,1,1,usd\n");
  assert.deepEqual(mapRowsToHoldings(wrong, BROKER_PRESETS.generic.columns, "generic").map((h) => [h.symbol, h.currency]), [["AAPL", "USD"], ["INFY.NS", "INR"]]);
});

test("parseBrokerNumber handles Indian and accounting formats and rejects junk", () => {
  assert.equal(parseBrokerNumber("1,23,456.78"), 123456.78);
  assert.equal(parseBrokerNumber("12,34,56,789"), 123456789);
  assert.equal(parseBrokerNumber("₹ 2,650.75"), 2650.75);
  assert.equal(parseBrokerNumber("Rs. 10"), 10);
  assert.equal(parseBrokerNumber("$1,234.5"), 1234.5);
  assert.equal(parseBrokerNumber("(12.5)"), -12.5);
  assert.equal(parseBrokerNumber(" 0.0005 "), 0.0005);
  assert.equal(parseBrokerNumber(".5"), 0.5);
  for (const junk of ["", "-", "abc", "Infinity", "NaN", "1e400", "1e3", "12abc", "0x10", null, undefined, Infinity]) {
    assert.ok(Number.isNaN(parseBrokerNumber(junk)), `rejects ${String(junk)}`);
  }
});

test("rows with zero, negative, NaN, or infinite quantities are skipped", () => {
  const rows = parseCsv('"Instrument","Qty.","Avg. cost"\nA,0,1\nB,-5,1\nC,abc,1\nD,Infinity,1\nE,"1,000",-3\n');
  assert.deepEqual(mapZerodha(rows).map((h) => [h.symbol, h.quantity, h.avgPrice]), [["E.NS", 1000, 0]]);
});

test("implausible symbols are skipped", () => {
  const rows = parseCsv('"Instrument","Qty."\n<img src=x>,1\n=HYPERLINK("x"),1\n../../etc,1\nBAJAJ-AUTO,1\nM&M,2\n');
  assert.deepEqual(mapZerodha(rows).map((h) => h.symbol), ["BAJAJ-AUTO.NS", "M&M.NS"]);
});

test("duplicate symbols merge with a weighted average cost", () => {
  const rows = parseCsv('"Instrument","Qty.","Avg. cost"\nTCS,10,100\ntcs,30,200\n');
  const [holding, ...rest] = mapZerodha(rows);
  assert.equal(rest.length, 0);
  assert.equal(holding.quantity, 40);
  assert.equal(holding.avgPrice, 175);
});

test("quoted fields may contain commas, quotes, and newlines; CRLF and BOM are handled", () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].a, "x, y");
  assert.equal(rows[0].b, 'say "hi"');
  assert.equal(rows[0].c, "line1\nline2");
});

test("prototype-polluting headers are dropped and rows have no prototype", () => {
  const rows = parseCsv("__proto__,constructor,prototype,symbol,quantity\n{\"polluted\":1},x,y,AAPL,1\n");
  assert.equal(Object.getPrototypeOf(rows[0]), null);
  assert.deepEqual(Object.keys(rows[0]), ["symbol", "quantity"]);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  // A mapping that names an inherited property must not read Object.prototype.
  assert.deepEqual(mapRowsToHoldings(rows, { symbol: "toString", quantity: "quantity" }, "x"), []);
  assert.deepEqual(mapRowsToCryptoHoldings(parseCsv("constructor,amount\nBTC,1\n")), []);
});

test("size, row, and column limits throw a user-readable CsvLimitError", () => {
  assert.throws(() => parseCsv("a\n" + "x".repeat(CSV_LIMITS.maxChars)), CsvLimitError);
  assert.throws(() => parseCsv("a\n" + "1\n".repeat(CSV_LIMITS.maxRows + 1)), /too many rows/);
  assert.equal(parseCsv("a\n" + "1\n".repeat(CSV_LIMITS.maxRows)).length, CSV_LIMITS.maxRows);
  assert.throws(() => parseCsv(Array.from({ length: CSV_LIMITS.maxColumns + 1 }, (_, i) => `c${i}`).join(",")), /too many columns/);
  const long = parseCsv(`symbol\n${"A".repeat(10_000)}\n`);
  assert.equal(long[0].symbol.length, CSV_LIMITS.maxCellChars);
});

test("empty and header-only files", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n\n"), []);
  assert.deepEqual(parseCsv("symbol,quantity\n"), []);
  assert.match(diagnoseCsvImport([], zerodha), /empty/);
});

test("crypto exports use the same number parser", () => {
  const draft = mapRowsToCryptoHoldings(parseCsv("Asset,Total\nBTC,\"1,000.5\"\nETH,-1\nUSDT,5\n"), "binance");
  assert.deepEqual(draft, [{ symbol: "BTC", quantity: 1000.5, source: "binance" }]);
});
