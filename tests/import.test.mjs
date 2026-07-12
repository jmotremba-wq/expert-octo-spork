// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultInputs } from "../calc.js";
import {
  parseMoney, parseBalancesCSV, applyBalances,
  serializeBackup, parseBackup,
} from "../import.js";

test("parseMoney handles currency formats", () => {
  assert.equal(parseMoney("$1,234.56"), 1234.56);
  assert.equal(parseMoney("(500)"), -500);
  assert.equal(parseMoney(" 42 "), 42);
  assert.equal(parseMoney("-$2,000"), -2000);
  assert.ok(Number.isNaN(parseMoney("Vanguard")));
  assert.ok(Number.isNaN(parseMoney("")));
});

test("Monarch-style single-account Date,Balance file: latest date wins, account is null", () => {
  const csv = `Date,Balance
2026-05-01,"$400,000.00"
2026-07-01,"$412,345.67"
2026-06-01,"$405,000.00"`;
  const rows = parseBalancesCSV(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account, null);
  assert.equal(rows[0].balance, 412345.67);
});

test("multi-account Account,Balance file maps one row per account", () => {
  const csv = `Account,Balance
Vanguard Brokerage,"$812,345"
Fidelity 401k,"$310,000"
Ally Savings,"$41,000"`;
  const rows = parseBalancesCSV(csv);
  assert.equal(rows.length, 3);
  const vg = rows.find((r) => r.account === "Vanguard Brokerage");
  assert.equal(vg.balance, 812345);
});

test("tab-delimited paste without headers works", () => {
  const text = "Roth IRA\t$290,500\nChecking\t$12,000";
  const rows = parseBalancesCSV(text);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.account === "Roth IRA").balance, 290500);
  assert.equal(rows.find((r) => r.account === "Checking").balance, 12000);
});

test("summary/blank rows are skipped", () => {
  const csv = `Account,Balance
Brokerage,"$100,000"
Total,
,`;
  const rows = parseBalancesCSV(csv);
  assert.equal(rows.length, 1);
});

test("applyBalances sums multiple accounts into one bucket and leaves the rest untouched", () => {
  const inp = defaultInputs();
  const rows = [
    { account: "Vanguard Brokerage", balance: 500000, date: null },
    { account: "Schwab Brokerage", balance: 250000, date: null },
    { account: "Fidelity 401k", balance: 333000, date: null },
    { account: "Old account", balance: 999, date: null },
  ];
  const mapping = {
    "vanguard brokerage": "taxable",
    "schwab brokerage": "taxable",
    "fidelity 401k": "pretax",
    "old account": "ignore",
  };
  const { inputs, applied, unmapped } = applyBalances(inp, rows, mapping);
  assert.equal(inputs.buckets.taxable, 750000);
  assert.equal(inputs.buckets.pretax, 333000);
  assert.equal(inputs.buckets.roth, inp.buckets.roth);       // untouched
  assert.equal(inputs.buckets.cash, inp.buckets.cash);       // untouched
  assert.equal(applied.taxable, 750000);
  assert.deepEqual(unmapped, []);
  assert.equal(inp.buckets.taxable, defaultInputs().buckets.taxable, "input not mutated");
});

test("applyBalances routes hard assets by key and reports unmapped accounts", () => {
  const inp = defaultInputs();
  const rows = [
    { account: "BTC Wallet", balance: 21000, date: null },
    { account: "Mystery Fund", balance: 5, date: null },
  ];
  const { inputs, unmapped } = applyBalances(inp, rows, { "btc wallet": "bitcoin" });
  assert.equal(inputs.hardAssets.find((a) => a.key === "bitcoin").value, 21000);
  assert.deepEqual(unmapped, ["Mystery Fund"]);
});

test("single-account file applies via the ' single' mapping key", () => {
  const inp = defaultInputs();
  const rows = parseBalancesCSV("Date,Balance\n2026-07-01,$99,000");
  const { inputs } = applyBalances(inp, rows, { " single": "hsa" });
  assert.equal(inputs.buckets.hsa, 99000);
});

test("backup round-trips inputs, snapshots, and mappings", () => {
  const state = {
    inputs: defaultInputs(),
    ui: { active: ["baseline"], detailKey: "baseline", custom: { retireAge: 55 } },
    snapshots: [{ date: "2026-07-12", total: 1464900 }],
    mappings: { "vanguard brokerage": "taxable" },
    meta: { lastBalanceUpdate: "2026-07-12" },
  };
  const restored = parseBackup(serializeBackup(state));
  assert.deepEqual(restored.inputs, state.inputs);
  assert.deepEqual(restored.snapshots, state.snapshots);
  assert.deepEqual(restored.mappings, state.mappings);
  assert.equal(restored.ui.custom.retireAge, 55);
});

test("parseBackup rejects foreign or corrupt files", () => {
  assert.throws(() => parseBackup("not json"), /valid JSON/);
  assert.throws(() => parseBackup('{"app":"something-else"}'), /doesn't look like/);
  assert.throws(() => parseBackup('{"app":"retirement-bridge-calculator"}'), /missing its inputs/);
});
