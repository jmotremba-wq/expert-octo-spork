// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  realRate, defaultInputs, incomeSources, spendingAt, netIncomeAt,
  simulate, phases, maxSustainableSpending, earliestSustainableRetireAge,
  SS_FACTORS, PRETAX_ACCESS_AGE,
} from "../calc.js";

const approx = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

function baseInputs(overrides = {}) {
  const inp = defaultInputs();
  return deepMerge(inp, overrides);
}
function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      target[k] = deepMerge(target[k] ?? {}, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

test("realRate follows the Fisher relation", () => {
  approx(realRate(6.5, 2.5), 1.065 / 1.025 - 1);
  approx(realRate(0, 0), 0);
  approx(realRate(2.5, 2.5), 0);
});

test("pension = high-3 × multiplier, starting at pension start age", () => {
  const inp = baseInputs({ pension: { high3: 100000, multiplierPct: 36, startAge: 60 } });
  const pension = incomeSources(inp).find((s) => s.key === "pension");
  approx(pension.annual, 36000);
  assert.equal(pension.startAge, 60);
  assert.equal(pension.taxFree, false);
});

test("Social Security applies claim-age factors to monthly PIA", () => {
  const inp = baseInputs({ ss: { aMonthlyPIA: 1000, aClaimAge: 62, bMonthlyPIA: 1000, bClaimAge: 70 } });
  const src = incomeSources(inp);
  approx(src.find((s) => s.key === "ssA").annual, 1000 * 12 * SS_FACTORS[62]);
  approx(src.find((s) => s.key === "ssB").annual, 1000 * 12 * SS_FACTORS[70]);
});

test("VA disability is tax-free and already in force; pension is taxed", () => {
  const inp = baseInputs({
    va: { annual: 24000 },
    pension: { high3: 100000, multiplierPct: 36, startAge: 60 },
    ss: { aMonthlyPIA: 0, bMonthlyPIA: 0 },
    passive: { rentalNetAnnual: 0, farmNetAnnual: 0 },
    taxes: { incomeRatePct: 20 },
  });
  approx(netIncomeAt(inp, 55), 24000);                  // VA only, untaxed
  approx(netIncomeAt(inp, 60), 24000 + 36000 * 0.8);    // + pension after tax
});

test("spending includes the healthcare bridge only before its end age", () => {
  const inp = baseInputs({ spending: { baseAnnual: 100000, extraHealthcareAnnual: 12000, healthcareUntilAge: 60 } });
  approx(spendingAt(inp, 55), 112000);
  approx(spendingAt(inp, 60), 100000);
});

test("zero spending never depletes and the portfolio grows", () => {
  const inp = baseInputs({ spending: { baseAnnual: 0, extraHealthcareAnnual: 0 } });
  const sim = simulate(inp);
  assert.equal(sim.sustainable, true);
  assert.equal(sim.depletionAge, null);
  assert.ok(sim.ending > sim.initialTotal);
});

test("absurd spending depletes and reports the depletion age", () => {
  const inp = baseInputs({ spending: { baseAnnual: 2_000_000 } });
  const sim = simulate(inp);
  assert.equal(sim.sustainable, false);
  assert.ok(sim.depletionAge >= inp.profile.retireAge);
  assert.ok(sim.depletionAge <= inp.profile.lifeExpectancy);
});

test("retiring early with only pre-tax money triggers the access-gap warning and penalties", () => {
  const inp = baseInputs({
    profile: { currentAge: 49, retireAge: 50, lifeExpectancy: 70 },
    buckets: { cash: 0, taxable: 0, pretax: 2_000_000, hsa: 0, roth: 0, rothBasis: 0 },
    hardAssets: [
      { key: "gold", label: "Gold", value: 0, growthPct: 0 },
      { key: "silver", label: "Silver", value: 0, growthPct: 0 },
      { key: "bitcoin", label: "Bitcoin", value: 0, growthPct: 0 },
    ],
    contributions: { annual: 0 },
    va: { annual: 0 }, pension: { high3: 0 },
    ss: { aMonthlyPIA: 0, bMonthlyPIA: 0 },
    spending: { baseAnnual: 50000, extraHealthcareAnnual: 0 },
  });
  const sim = simulate(inp);
  assert.ok(sim.earlyGapAges.length > 0, "expected early-access gap ages");
  assert.ok(sim.earlyGapAges.every((a) => a < PRETAX_ACCESS_AGE));
  assert.ok(sim.totalPenalties > 0, "expected penalties on forced pre-59½ draws");
});

test("Roth basis covers the bridge penalty-free when it is large enough", () => {
  const inp = baseInputs({
    profile: { currentAge: 55, retireAge: 56, lifeExpectancy: 70 },
    buckets: { cash: 0, taxable: 0, pretax: 1_000_000, hsa: 0, roth: 500000, rothBasis: 400000 },
    hardAssets: [
      { key: "gold", label: "Gold", value: 0, growthPct: 0 },
      { key: "silver", label: "Silver", value: 0, growthPct: 0 },
      { key: "bitcoin", label: "Bitcoin", value: 0, growthPct: 0 },
    ],
    contributions: { annual: 0 },
    va: { annual: 0 }, pension: { high3: 0 },
    ss: { aMonthlyPIA: 0, bMonthlyPIA: 0 },
    spending: { baseAnnual: 40000, extraHealthcareAnnual: 0 },
  });
  const sim = simulate(inp);
  assert.equal(sim.earlyGapAges.length, 0);
  assert.equal(sim.totalPenalties, 0);
});

test("phases cover retirement through plan end with no gaps", () => {
  const inp = baseInputs();
  const ph = phases(inp);
  assert.equal(ph[0].from, inp.profile.retireAge);
  for (let i = 1; i < ph.length; i++) assert.equal(ph[i].from, ph[i - 1].to);
  assert.equal(ph[ph.length - 1].to, inp.profile.lifeExpectancy);
  // Draw shrinks (or holds) as income sources come online at equal spending.
  const last = ph[ph.length - 1];
  assert.ok(last.income > ph[0].income, "income should grow as sources start");
});

test("maxSustainableSpending is sustainable at, but not above, the solved level", () => {
  const inp = baseInputs();
  const max = maxSustainableSpending(inp);
  assert.ok(max > 0);
  const at = structuredClone(inp);
  at.spending.baseAnnual = max * 0.99;
  assert.equal(simulate(at).sustainable, true);
  const above = structuredClone(inp);
  above.spending.baseAnnual = max * 1.05;
  assert.equal(simulate(above).sustainable, false);
});

test("earliestSustainableRetireAge yields a sustainable plan", () => {
  const inp = baseInputs();
  const age = earliestSustainableRetireAge(inp);
  assert.ok(age === null || age >= inp.profile.currentAge);
  if (age !== null) {
    const trial = structuredClone(inp);
    trial.profile.retireAge = age;
    assert.equal(simulate(trial).sustainable, true);
    if (age > inp.profile.currentAge) {
      trial.profile.retireAge = age - 1;
      assert.equal(simulate(trial).sustainable, false);
    }
  }
});

test("hard assets grow at their own real rates", () => {
  const inp = baseInputs({
    profile: { currentAge: 40, retireAge: 41, lifeExpectancy: 42 },
    market: { nominalReturnPct: 0, inflationPct: 0 },
    buckets: { cash: 0, taxable: 0, pretax: 0, hsa: 0, roth: 0, rothBasis: 0 },
    hardAssets: [
      { key: "gold", label: "Gold", value: 1000, growthPct: 10 },
      { key: "silver", label: "Silver", value: 0, growthPct: 0 },
      { key: "bitcoin", label: "Bitcoin", value: 0, growthPct: 0 },
    ],
    contributions: { annual: 0 },
    va: { annual: 0 }, pension: { high3: 0 },
    ss: { aMonthlyPIA: 0, bMonthlyPIA: 0 },
    spending: { baseAnnual: 0, extraHealthcareAnnual: 0 },
  });
  const sim = simulate(inp);
  approx(sim.years[0].buckets.hard, 1100, 1e-6);
  approx(sim.years[2].buckets.hard, 1331, 1e-6);
});
