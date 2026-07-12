// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultInputs, runAllScenarios } from "../calc.js";
import { advise } from "../advisor.js";

function inputsWith(mutate) {
  const inp = defaultInputs();
  mutate?.(inp);
  return inp;
}

function adviceFor(inp) {
  return { inp, items: advise(runAllScenarios(inp, {}), inp) };
}

test("verdict comes first and matches sustainability", () => {
  const ok = adviceFor(inputsWith((i) => { i.spending.baseAnnual = 100000; }));
  assert.equal(ok.items[0].tone, "good");
  assert.match(ok.items[0].title, /on track/i);

  const bad = adviceFor(inputsWith((i) => { i.spending.baseAnnual = 400000; }));
  assert.equal(bad.items[0].tone, "action");
  assert.match(bad.items[0].title, /runs out of money at age \d+/i);
});

test("gap verdict names a fixing preset when one exists", () => {
  // Find a spending level that is unsustainable but fixable by trimming 15%.
  const inp = inputsWith((i) => { i.spending.baseAnnual = 220000; });
  const results = runAllScenarios(inp, {});
  if (!results.baseline.sim.sustainable) {
    const anyFix = ["delaySS", "trimSpending", "retireLater", "ssCut"]
      .some((k) => results[k].sim.sustainable);
    const items = advise(results, inp);
    if (anyFix) {
      assert.match(items[0].body, /easiest fix/i);
    } else {
      assert.match(items[0].body, /combine levers/i);
    }
  }
});

test("bridge rule fires when accessible money runs out before 59½", () => {
  const inp = inputsWith((i) => {
    i.profile = { currentAge: 49, retireAge: 50, lifeExpectancy: 75 };
    i.buckets = { cash: 0, taxable: 0, pretax: 2_000_000, hsa: 0, roth: 0, rothBasis: 0 };
    i.hardAssets.forEach((a) => { a.value = 0; });
    i.contributions.annual = 0;
    i.va.annual = 0;
    i.spending = { baseAnnual: 60000, extraHealthcareAnnual: 0, healthcareUntilAge: 60 };
  });
  const { items } = adviceFor(inp);
  const bridge = items.find((a) => /59½/.test(a.title));
  assert.ok(bridge, "expected a pre-59½ access note");
  assert.equal(bridge.tone, "action");
  assert.match(bridge.body, /Roth conversion ladder|72\(t\)/);
});

test("headroom note quantifies room to spend more", () => {
  const inp = inputsWith((i) => { i.spending.baseAnnual = 90000; });
  const { items } = adviceFor(inp);
  const head = items.find((a) => /room to spend/i.test(a.title));
  assert.ok(head, "expected a headroom note");
  assert.equal(head.tone, "good");
  assert.match(head.body, /\$\d/);
});

test("sensitivity rule reacts to the market-stress scenario", () => {
  const inp = defaultInputs();
  const results = runAllScenarios(inp, {});
  const items = advise(results, inp);
  if (results.baseline.sim.sustainable && !results.marketStress.sim.sustainable) {
    assert.ok(items.some((a) => /sensitive to market returns/i.test(a.title)));
  } else if (results.baseline.sim.sustainable && results.marketStress.sim.sustainable) {
    assert.ok(items.some((a) => /survives weak markets/i.test(a.title)));
  }
});

test("timing note fires when retirement could come earlier", () => {
  const inp = inputsWith((i) => { i.spending.baseAnnual = 80000; });
  const results = runAllScenarios(inp, {});
  const items = advise(results, inp);
  if (results.baseline.earliestAge != null &&
      results.baseline.earliestAge < inp.profile.retireAge) {
    const t = items.find((a) => /earlier than planned/i.test(a.title));
    assert.ok(t, "expected an earlier-retirement note");
    assert.equal(t.tone, "good");
  }
});
