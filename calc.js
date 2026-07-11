// calc.js — pure retirement model. No DOM, no storage, no formatting.
//
// Every dollar figure is in TODAY'S (real) dollars. Returns are converted to
// real terms via the Fisher relation, so COLA-adjusted income (military
// pension, VA disability, Social Security) stays flat across the projection
// and reads at face value.
//
// The model is built around one household's shape:
//   * early retirement well before pension/SS ages → a multi-year "bridge"
//   * Guard/Reserve pension that starts at 60 (CRDP: not offset by VA)
//   * tax-free VA disability that is already being paid
//   * two Social Security benefits with independent claim ages
//   * account buckets with different tax + access rules (pre-59½ matters)
//   * hard assets (metals, bitcoin) projected at their own growth rates

export const SS_FACTORS = {
  62: 0.70, 63: 0.75, 64: 0.80, 65: 0.8667, 66: 0.9333,
  67: 1.00, 68: 1.08, 69: 1.16, 70: 1.24,
};

// First integer age at which pre-tax accounts can be tapped without the early
// withdrawal penalty (59½ rounded up — one conservative half-year).
export const PRETAX_ACCESS_AGE = 60;

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function realRate(nominalPct, inflationPct) {
  return (1 + n(nominalPct) / 100) / (1 + n(inflationPct) / 100) - 1;
}

/* ------------------------------------------------------------------ *
 * Default inputs — GENERIC PLACEHOLDER values only, no real data.
 * Edited values persist in the browser's localStorage, never the repo.
 * ------------------------------------------------------------------ */

export function defaultInputs() {
  return {
    profile: { currentAge: 41, retireAge: 53, lifeExpectancy: 92 },
    market: { nominalReturnPct: 6.5, inflationPct: 2.5 },
    buckets: {
      cash: 37000,
      taxable: 770000,
      pretax: 300000,   // traditional 401(k)/IRA
      hsa: 25000,       // modeled with the pre-tax bucket
      roth: 290000,
      rothBasis: 150000, // contributions — withdrawable any age, tax/penalty-free
    },
    hardAssets: [
      { key: "gold",    label: "Gold",    value: 26400, growthPct: 4 },
      { key: "silver",  label: "Silver",  value: 1500,  growthPct: 5 },
      { key: "bitcoin", label: "Bitcoin", value: 14000, growthPct: 15 },
    ],
    contributions: {
      annual: 60000,
      splitTaxablePct: 50,
      splitPretaxPct: 40,
      splitRothPct: 10,
    },
    spending: {
      baseAnnual: 180000,          // after-tax target
      extraHealthcareAnnual: 12000, // gray-area premiums before TRICARE kicks in
      healthcareUntilAge: 60,
    },
    taxes: {
      incomeRatePct: 12,      // effective rate on taxable income sources
      taxableDrawRatePct: 10, // effective rate on taxable-account / hard-asset sales
      pretaxDrawRatePct: 18,  // effective rate on traditional withdrawals
      earlyPenaltyPct: 10,    // added to pre-59½ retirement-account draws
    },
    pension: { high3: 90000, multiplierPct: 36, startAge: 60, crdp: true },
    va: { annual: 24000 },
    ss: {
      aLabel: "Earner A", aMonthlyPIA: 3200, aClaimAge: 67,
      bLabel: "Earner B", bMonthlyPIA: 2400, bClaimAge: 67,
    },
    passive: {
      rentalNetAnnual: 0, rentalStartAge: 0,
      farmNetAnnual: 0,   farmStartAge: 0,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Income sources (today's $/yr with start ages and tax treatment)
 * ------------------------------------------------------------------ */

export function incomeSources(inp) {
  const p = inp.pension, ss = inp.ss, pv = inp.passive;
  const pension = n(p.high3) * n(p.multiplierPct) / 100;
  const ssA = n(ss.aMonthlyPIA) * 12 * (SS_FACTORS[n(ss.aClaimAge)] ?? 1);
  const ssB = n(ss.bMonthlyPIA) * 12 * (SS_FACTORS[n(ss.bClaimAge)] ?? 1);
  return [
    { key: "va",      label: "VA Disability (tax-free)", annual: n(inp.va.annual), startAge: 0, taxFree: true },
    { key: "pension", label: p.crdp ? "Military Pension (CRDP — no VA offset)" : "Military Pension",
      annual: pension, startAge: n(p.startAge), taxFree: false },
    { key: "rental",  label: "Rental Net Income", annual: n(pv.rentalNetAnnual), startAge: n(pv.rentalStartAge), taxFree: false },
    { key: "farm",    label: "Farm Net Income",   annual: n(pv.farmNetAnnual),   startAge: n(pv.farmStartAge),   taxFree: false },
    { key: "ssA", label: `Social Security — ${ss.aLabel || "A"} (age ${n(ss.aClaimAge)})`, annual: ssA, startAge: n(ss.aClaimAge), taxFree: false },
    { key: "ssB", label: `Social Security — ${ss.bLabel || "B"} (age ${n(ss.bClaimAge)})`, annual: ssB, startAge: n(ss.bClaimAge), taxFree: false },
  ].filter((s) => s.annual > 0);
}

export function spendingAt(inp, age) {
  const s = inp.spending;
  return n(s.baseAnnual) +
    (age < n(s.healthcareUntilAge) ? n(s.extraHealthcareAnnual) : 0);
}

// After-tax guaranteed income in force at a given age.
export function netIncomeAt(inp, age, sources = incomeSources(inp)) {
  const incRate = n(inp.taxes.incomeRatePct) / 100;
  return sources.reduce(
    (sum, s) => sum + (age >= s.startAge ? s.annual * (s.taxFree ? 1 : 1 - incRate) : 0),
    0,
  );
}

/* ------------------------------------------------------------------ *
 * Year-by-year simulation
 * ------------------------------------------------------------------ */

export function simulate(inp) {
  const { currentAge, retireAge, lifeExpectancy } = {
    currentAge: n(inp.profile.currentAge),
    retireAge: n(inp.profile.retireAge),
    lifeExpectancy: Math.max(n(inp.profile.retireAge) + 1, n(inp.profile.lifeExpectancy)),
  };
  const infl = inp.market.inflationPct;
  const r = realRate(inp.market.nominalReturnPct, infl);
  const sources = incomeSources(inp);
  const t = inp.taxes;
  const taxableRate = n(t.taxableDrawRatePct) / 100;
  const pretaxRate  = n(t.pretaxDrawRatePct) / 100;
  const penalty     = n(t.earlyPenaltyPct) / 100;

  let cash = n(inp.buckets.cash);
  let taxable = n(inp.buckets.taxable);
  let pretax = n(inp.buckets.pretax) + n(inp.buckets.hsa);
  let roth = n(inp.buckets.roth);
  let rothBasis = Math.min(n(inp.buckets.rothBasis), roth);
  const hard = inp.hardAssets.map((a) => ({
    label: a.label, value: n(a.value), r: realRate(a.growthPct, infl),
  }));

  const c = inp.contributions;
  const split = {
    taxable: n(c.splitTaxablePct) / 100,
    pretax: n(c.splitPretaxPct) / 100,
    roth: n(c.splitRothPct) / 100,
  };

  const initialTotal = cash + taxable + pretax + roth + hard.reduce((s, a) => s + a.value, 0);
  const years = [];
  const earlyGapAges = [];
  let depletionAge = null;
  let totalPenalties = 0;

  for (let age = currentAge; age <= lifeExpectancy; age++) {
    const rec = {
      age,
      income: netIncomeAt(inp, age, sources),
      spend: 0, drawGross: 0, penaltyPaid: 0, shortfall: 0,
    };

    if (age < retireAge) {
      // Accumulation: grow, then contribute at year end.
      const g = 1 + r;
      cash *= g; taxable *= g; pretax *= g; roth *= g;
      hard.forEach((a) => { a.value *= 1 + a.r; });
      const amt = n(c.annual);
      taxable += amt * split.taxable;
      pretax  += amt * split.pretax;
      roth    += amt * split.roth;
      rothBasis += amt * split.roth;
    } else {
      // Drawdown: withdraw at the start of the year, grow the remainder.
      rec.spend = spendingAt(inp, age);
      let need = Math.max(0, rec.spend - rec.income); // after-tax dollars still required

      // Draw up to `avail` gross from a bucket taxed at `rate`; returns the
      // gross amount taken and reduces the remaining after-tax need.
      const draw = (avail, rate) => {
        if (need <= 1e-9 || avail <= 0 || rate >= 1) return 0;
        const gross = Math.min(avail, need / (1 - rate));
        need -= gross * (1 - rate);
        rec.drawGross += gross;
        return gross;
      };

      cash -= draw(cash, 0);
      taxable -= draw(taxable, taxableRate);
      hard.forEach((a) => { a.value -= draw(a.value, taxableRate); });

      if (age >= PRETAX_ACCESS_AGE) {
        pretax -= draw(pretax, pretaxRate);
        const g = draw(roth, 0);
        roth -= g;
        rothBasis = Math.max(0, rothBasis - g);
      } else {
        // Pre-59½: Roth contributions come out tax/penalty-free…
        const gB = draw(Math.min(rothBasis, roth), 0);
        roth -= gB; rothBasis -= gB;
        // …anything beyond that forces penalized retirement-account draws.
        if (need > 1e-9) {
          earlyGapAges.push(age);
          const gP = draw(pretax, pretaxRate + penalty);
          pretax -= gP;
          // Roth earnings pre-59½ (approximated as penalty-only).
          const gR = draw(roth, penalty);
          roth -= gR;
          rec.penaltyPaid = gP * penalty + gR * penalty;
          totalPenalties += rec.penaltyPaid;
        }
      }

      if (need > 1e-9) {
        rec.shortfall = need;
        if (depletionAge == null) depletionAge = age;
      }

      const g = 1 + r;
      cash *= g; taxable *= g; pretax *= g; roth *= g;
      hard.forEach((a) => { a.value *= 1 + a.r; });
    }

    const hardTotal = hard.reduce((s, a) => s + a.value, 0);
    rec.buckets = { pretax, roth, taxable, hard: hardTotal, cash };
    rec.total = pretax + roth + taxable + hardTotal + cash;
    years.push(rec);
  }

  const atRetirement = retireAge <= currentAge
    ? initialTotal
    : (years.find((y) => y.age === retireAge - 1)?.total ?? initialTotal);

  return {
    years, sources, realReturn: r,
    initialTotal, atRetirement,
    ending: years[years.length - 1].total,
    depletionAge, earlyGapAges, totalPenalties,
    sustainable: depletionAge == null,
  };
}

/* ------------------------------------------------------------------ *
 * Bridge phases — segments between income "steps" after retirement
 * ------------------------------------------------------------------ */

export function phases(inp) {
  const retireAge = n(inp.profile.retireAge);
  const life = Math.max(retireAge + 1, n(inp.profile.lifeExpectancy));
  const sources = incomeSources(inp);

  const breaks = new Set([retireAge]);
  sources.forEach((s) => {
    if (s.startAge > retireAge && s.startAge < life) breaks.add(s.startAge);
  });
  const hc = n(inp.spending.healthcareUntilAge);
  if (hc > retireAge && hc < life && n(inp.spending.extraHealthcareAnnual) > 0) breaks.add(hc);

  const pts = [...breaks].sort((a, b) => a - b);
  return pts.map((from, i) => {
    const to = i + 1 < pts.length ? pts[i + 1] : life;
    const income = netIncomeAt(inp, from, sources);
    const spend = spendingAt(inp, from);
    return {
      from, to, years: to - from,
      income, spend,
      draw: Math.max(0, spend - income),
      starts: sources.filter((s) => s.startAge === from).map((s) => s.label),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Solvers
 * ------------------------------------------------------------------ */

export function maxSustainableSpending(inp) {
  const test = (spend) => {
    const trial = structuredClone(inp);
    trial.spending.baseAnnual = spend;
    return simulate(trial).sustainable;
  };
  let lo = 0, hi = 5_000_000;
  if (!test(lo)) return 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (test(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

export function earliestSustainableRetireAge(inp) {
  const currentAge = n(inp.profile.currentAge);
  const life = n(inp.profile.lifeExpectancy);
  for (let a = currentAge; a < life; a++) {
    const trial = structuredClone(inp);
    trial.profile.retireAge = a;
    if (simulate(trial).sustainable) return a;
  }
  return null;
}
