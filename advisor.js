// advisor.js — pure rule engine that turns simulation results into
// prioritized plain-English advice. No DOM. Testable with node:test.
//
// advise(results, inputs) → [{ tone, title, body }, …] where results is the
// object from runAllScenarios() and tone ∈ 'good' | 'watch' | 'action'.
// The first item is always the overall verdict (the page hero).

import { phases, PRETAX_ACCESS_AGE } from "./calc.js";

const fmt$ = (v) => "$" + Math.round(v).toLocaleString("en-US");
const fmtK = (v) =>
  "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

// Presets that can rescue an unsustainable baseline, cheapest lever first:
// claiming later costs nothing today, trimming spending is a habit change,
// working longer is the biggest life change.
const FIX_ORDER = ["delaySS", "trimSpending", "retireLater", "ssCut"];

export function advise(results, inputs) {
  const base = results.baseline;
  const items = [];

  /* ---- 1. Verdict (always first) ---- */
  if (base.sim.sustainable) {
    const cushion = base.maxSpend - inputs.spending.baseAnnual;
    items.push({
      tone: "good",
      title: `You're on track through age ${inputs.profile.lifeExpectancy}`,
      body: `Retiring at ${inputs.profile.retireAge}, your plan sustains ` +
        `${fmt$(inputs.spending.baseAnnual)}/yr of spending and ends with about ` +
        `${fmtK(base.sim.ending)} to spare (today's dollars). You could spend up to ` +
        `${fmt$(base.maxSpend)}/yr before the plan breaks.`,
    });
  } else {
    const fixes = FIX_ORDER
      .filter((k) => results[k]?.sim.sustainable)
      .map((k) => results[k].scenario.label);
    const fixTxt = fixes.length
      ? ` The easiest fix on the table: "${fixes[0]}" makes the plan work` +
        (fixes.length > 1 ? ` (so does ${fixes.slice(1).map((f) => `"${f}"`).join(" and ")})` : "") + "."
      : " None of the single-lever scenarios fixes it alone — combine levers or revisit the big numbers.";
    items.push({
      tone: "action",
      title: `Your plan runs out of money at age ${base.sim.depletionAge}`,
      body: `At ${fmt$(inputs.spending.baseAnnual)}/yr of spending from age ` +
        `${inputs.profile.retireAge}, the portfolio depletes ` +
        `${inputs.profile.lifeExpectancy - base.sim.depletionAge} years short of your plan.` + fixTxt,
    });
  }

  /* ---- 2. Pre-59½ bridge funding ---- */
  if (base.sim.earlyGapAges.length > 0) {
    const first = base.sim.earlyGapAges[0];
    const last = base.sim.earlyGapAges[base.sim.earlyGapAges.length - 1];
    items.push({
      tone: "action",
      title: "Your accessible money runs out before 59½",
      body: `From age ${first} to ${last}, cash, taxable accounts, hard assets, and Roth ` +
        `contributions are exhausted, forcing early retirement-account withdrawals — about ` +
        `${fmt$(base.sim.totalPenalties)} in penalties. A Roth conversion ladder (start converting ` +
        `5 years before you need the money) or 72(t)/SEPP payments would get at that money penalty-free.`,
    });
  } else {
    const ph = phases(base.inputs);
    const bridgeDraw = ph[0]?.draw ?? 0;
    if (bridgeDraw > 0.05 * base.sim.atRetirement) {
      items.push({
        tone: "watch",
        title: "The bridge years lean hard on the portfolio",
        body: `Between retiring at ${inputs.profile.retireAge} and age ${PRETAX_ACCESS_AGE}, you'll draw ` +
          `${fmt$(bridgeDraw)}/yr — over 5% of the ${fmtK(base.sim.atRetirement)} you'll have. ` +
          `A bad market early in that window does outsized damage (sequence-of-returns risk); ` +
          `keeping 2–3 years of spending in cash or short bonds blunts it.`,
      });
    }
  }

  /* ---- 3. Spending headroom / shortfall ---- */
  const headroom = base.maxSpend - inputs.spending.baseAnnual;
  if (base.sim.sustainable && headroom > 0.10 * inputs.spending.baseAnnual) {
    items.push({
      tone: "good",
      title: `Room to spend ${fmt$(headroom)}/yr more`,
      body: `Your maximum sustainable spending is ${fmt$(base.maxSpend)}/yr — ` +
        `${Math.round((headroom / inputs.spending.baseAnnual) * 100)}% above your current target. ` +
        `That's margin for travel-heavy early years, or a buffer you can leave invested.`,
    });
  } else if (!base.sim.sustainable) {
    items.push({
      tone: "action",
      title: `Sustainable spending is ${fmt$(base.maxSpend)}/yr`,
      body: `That's ${fmt$(Math.abs(headroom))}/yr below your ${fmt$(inputs.spending.baseAnnual)} target. ` +
        `Closing the gap with spending alone means trimming ` +
        `${Math.round((Math.abs(headroom) / inputs.spending.baseAnnual) * 100)}%.`,
    });
  }

  /* ---- 4. Retirement timing ---- */
  const earliest = base.earliestAge;
  const planned = inputs.profile.retireAge;
  if (earliest != null && earliest < planned) {
    items.push({
      tone: "good",
      title: `You could retire at ${earliest} — ${planned - earliest} year${planned - earliest !== 1 ? "s" : ""} earlier than planned`,
      body: `At your current spending target, the plan already works from age ${earliest}. ` +
        `Working to ${planned} is a choice (and a cushion), not a requirement.`,
    });
  } else if (earliest != null && earliest > planned) {
    items.push({
      tone: "action",
      title: `The numbers say ${earliest}, not ${planned}`,
      body: `At your current spending, the earliest retirement age that holds through ` +
        `${inputs.profile.lifeExpectancy} is ${earliest} — ${earliest - planned} more working ` +
        `year${earliest - planned !== 1 ? "s" : ""} than planned. Or pull one of the other levers instead.`,
    });
  }

  /* ---- 5. Return sensitivity ---- */
  const stress = results.marketStress;
  if (stress && base.sim.sustainable && !stress.sim.sustainable) {
    items.push({
      tone: "watch",
      title: "Your plan is sensitive to market returns",
      body: `It works at ${inputs.market.nominalReturnPct}% nominal returns but runs dry at age ` +
        `${stress.sim.depletionAge} if returns average just 1.5% lower. Don't count the plan safe ` +
        `on the base case alone — the "Weak markets" scenario is worth planning around.`,
    });
  } else if (stress && base.sim.sustainable && stress.sim.sustainable) {
    items.push({
      tone: "good",
      title: "Your plan survives weak markets",
      body: `Even averaging 1.5% lower returns, the money lasts through age ` +
        `${inputs.profile.lifeExpectancy} with ${fmtK(stress.sim.ending)} left. That's a robust plan.`,
    });
  }

  return items;
}
