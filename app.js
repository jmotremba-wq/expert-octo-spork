// app.js — UI shell: input form, localStorage persistence, results pane.
// All math lives in calc.js; all chart drawing in chart.js.

import {
  defaultInputs, simulate, phases,
  maxSustainableSpending, earliestSustainableRetireAge,
  PRETAX_ACCESS_AGE,
} from "./calc.js";
import { renderChart } from "./chart.js";

const STORAGE_KEY = "retcalc_v1";

/* ---------------------------- state ------------------------------ */

function hydrate(saved, defaults) {
  if (!saved || typeof saved !== "object") return defaults;
  const out = structuredClone(defaults);
  for (const [k, v] of Object.entries(saved)) {
    if (k === "hardAssets" && Array.isArray(v)) {
      out.hardAssets = out.hardAssets.map((d) => ({ ...d, ...(v.find((s) => s.key === d.key) || {}) }));
    } else if (v && typeof v === "object" && out[k] && typeof out[k] === "object") {
      out[k] = { ...out[k], ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return hydrate(raw ? JSON.parse(raw) : null, defaultInputs());
  } catch {
    return defaultInputs();
  }
}

const state = load();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), 250,
  );
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

/* ------------------------- formatting ---------------------------- */

const fmt$ = (v) => "$" + Math.round(v).toLocaleString("en-US");
const fmtCompact = (v) =>
  "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);

/* --------------------------- form -------------------------------- */

const FORM_SECTIONS = [
  {
    title: "Profile & timing",
    fields: [
      { label: "Current age", path: "profile.currentAge" },
      { label: "Retirement age", path: "profile.retireAge" },
      { label: "Plan through age", path: "profile.lifeExpectancy" },
    ],
  },
  {
    title: "Market assumptions",
    fields: [
      { label: "Nominal return %", path: "market.nominalReturnPct", step: 0.1 },
      { label: "Inflation %", path: "market.inflationPct", step: 0.1 },
    ],
  },
  {
    title: "Portfolio buckets (today's $)",
    fields: [
      { label: "Cash / banking", path: "buckets.cash" },
      { label: "Taxable brokerage", path: "buckets.taxable" },
      { label: "Pre-tax 401(k)/IRA", path: "buckets.pretax" },
      { label: "HSA", path: "buckets.hsa", note: "modeled with the pre-tax bucket" },
      { label: "Roth", path: "buckets.roth" },
      { label: "Roth contributions (basis)", path: "buckets.rothBasis", note: "withdrawable any age, tax-free" },
    ],
  },
  {
    title: "Hard assets (own growth rates)",
    fields: [
      { label: "Gold value", path: "hardAssets.0.value" },
      { label: "Gold growth %", path: "hardAssets.0.growthPct", step: 0.1 },
      { label: "Silver value", path: "hardAssets.1.value" },
      { label: "Silver growth %", path: "hardAssets.1.growthPct", step: 0.1 },
      { label: "Bitcoin value", path: "hardAssets.2.value" },
      { label: "Bitcoin growth %", path: "hardAssets.2.growthPct", step: 0.1 },
    ],
  },
  {
    title: "Savings until retirement",
    fields: [
      { label: "Annual contribution", path: "contributions.annual" },
      { label: "→ taxable %", path: "contributions.splitTaxablePct" },
      { label: "→ pre-tax %", path: "contributions.splitPretaxPct" },
      { label: "→ Roth %", path: "contributions.splitRothPct" },
    ],
  },
  {
    title: "Spending (after-tax, today's $)",
    fields: [
      { label: "Base annual spending", path: "spending.baseAnnual" },
      { label: "Extra healthcare / yr", path: "spending.extraHealthcareAnnual", note: "pre-TRICARE bridge premiums" },
      { label: "…until age", path: "spending.healthcareUntilAge" },
    ],
  },
  {
    title: "Effective tax rates %",
    fields: [
      { label: "On taxable income (pension/SS/rent)", path: "taxes.incomeRatePct", step: 0.5 },
      { label: "On taxable-account sales", path: "taxes.taxableDrawRatePct", step: 0.5 },
      { label: "On pre-tax withdrawals", path: "taxes.pretaxDrawRatePct", step: 0.5 },
      { label: "Early-withdrawal penalty", path: "taxes.earlyPenaltyPct", step: 0.5 },
    ],
  },
  {
    title: "Military pension & VA",
    fields: [
      { label: "High-3 average pay", path: "pension.high3" },
      { label: "Pension multiplier %", path: "pension.multiplierPct", step: 0.1, note: "Guard/Reserve points-based" },
      { label: "Pension start age", path: "pension.startAge" },
      { label: "VA disability / yr (tax-free)", path: "va.annual" },
    ],
  },
  {
    title: "Social Security (monthly PIA at 67)",
    fields: [
      { label: "Earner A monthly PIA", path: "ss.aMonthlyPIA" },
      { label: "Earner A claim age (62–70)", path: "ss.aClaimAge" },
      { label: "Earner B monthly PIA", path: "ss.bMonthlyPIA" },
      { label: "Earner B claim age (62–70)", path: "ss.bClaimAge" },
    ],
  },
  {
    title: "Rental & farm (net $/yr)",
    fields: [
      { label: "Rental net income", path: "passive.rentalNetAnnual" },
      { label: "Rental start age (0 = now)", path: "passive.rentalStartAge" },
      { label: "Farm net income", path: "passive.farmNetAnnual" },
      { label: "Farm start age (0 = now)", path: "passive.farmStartAge" },
    ],
  },
];

function buildForm(root) {
  root.innerHTML = FORM_SECTIONS.map((sec) => `
    <details class="form-card" open>
      <summary>${sec.title}</summary>
      <div class="form-grid">
        ${sec.fields.map((f) => `
          <label class="field">
            <span>${f.label}</span>
            <input type="number" step="${f.step ?? "any"}"
                   data-path="${f.path}" value="${getPath(state, f.path)}"/>
            ${f.note ? `<small>${f.note}</small>` : ""}
          </label>`).join("")}
      </div>
    </details>`).join("") + `
    <button type="button" class="reset-btn" id="reset-btn">Reset to placeholder defaults</button>`;

  root.addEventListener("change", (e) => {
    const path = e.target.dataset?.path;
    if (!path) return;
    const v = Number(e.target.value);
    setPath(state, path, Number.isFinite(v) ? v : 0);
    save();
    renderResults();
  });

  root.querySelector("#reset-btn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

/* -------------------------- results ------------------------------ */

function verdictAlerts(sim, inp) {
  const alerts = [];
  if (sim.sustainable) {
    alerts.push(`<div class="alert alert--good"><span class="alert-icon">✓</span>
      <div><strong>Sustainable through age ${inp.profile.lifeExpectancy}</strong>
      Ends with ${fmt$(sim.ending)} (today's $).</div></div>`);
  } else {
    alerts.push(`<div class="alert alert--critical"><span class="alert-icon">✕</span>
      <div><strong>Portfolio depletes at age ${sim.depletionAge}</strong>
      Trim spending, delay retirement, or shift the plan — see the max-sustainable
      spending figure above.</div></div>`);
  }
  if (sim.earlyGapAges.length) {
    const first = sim.earlyGapAges[0], last = sim.earlyGapAges[sim.earlyGapAges.length - 1];
    alerts.push(`<div class="alert alert--warning"><span class="alert-icon">⚠</span>
      <div><strong>Pre-59½ access gap (ages ${first}–${last})</strong>
      Accessible money (cash, taxable, hard assets, Roth basis) runs out before
      age ${PRETAX_ACCESS_AGE}, forcing penalized retirement-account draws
      (${fmt$(sim.totalPenalties)} in penalties). Consider a Roth conversion
      ladder or 72(t)/SEPP payments during the bridge years.</div></div>`);
  }
  return alerts.join("");
}

function kpiBar(sim, inp, maxSpend, earliestAge) {
  const lastsVal = sim.depletionAge != null
    ? `<span class="neg">age ${sim.depletionAge}</span>`
    : `age ${inp.profile.lifeExpectancy}+`;
  const kpi = (label, val, hero = false) => `
    <div class="kpi${hero ? " kpi-hero" : ""}">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${val}</span>
    </div>`;
  return `<div class="kpi-bar">
    ${kpi(`At retirement (age ${inp.profile.retireAge})`, fmtCompact(sim.atRetirement), true)}
    ${kpi("Portfolio lasts until", lastsVal)}
    ${kpi("Max sustainable spending", fmtCompact(maxSpend) + "/yr")}
    ${kpi("Earliest sustainable retire age", earliestAge != null ? String(earliestAge) : "—")}
    ${kpi("Real return", (sim.realReturn * 100).toFixed(2) + "%")}
  </div>`;
}

function phaseTable(inp) {
  const rows = phases(inp).map((p) => `
    <tr>
      <td>${p.from}–${p.to}</td>
      <td>${p.years} yr${p.years !== 1 ? "s" : ""}</td>
      <td>${p.starts.length ? p.starts.join("; ") : (p.from === inp.profile.retireAge ? "Retire" : "Healthcare bridge ends")}</td>
      <td class="num">${fmt$(p.income)}</td>
      <td class="num">${fmt$(p.spend)}</td>
      <td class="num${p.draw > 0 ? " warn-text" : ""}">${fmt$(p.draw)}</td>
    </tr>`).join("");
  return `<div class="card">
    <h3>The bridge, phase by phase</h3>
    <p class="card-sub">What the portfolio must cover each year until every income source is online.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Ages</th><th>Span</th><th>What changes</th>
        <th class="num">Net income/yr</th><th class="num">Spending/yr</th><th class="num">Portfolio draw/yr</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function sourcesTable(sim) {
  const rows = sim.sources.map((s) => `
    <tr>
      <td>${s.label}</td>
      <td class="num">${fmt$(s.annual)}</td>
      <td class="num">${s.startAge === 0 ? "now" : "age " + s.startAge}</td>
      <td>${s.taxFree ? "tax-free" : "taxable"}</td>
    </tr>`).join("");
  return `<div class="card">
    <h3>Guaranteed income sources</h3>
    <div class="table-scroll"><table>
      <thead><tr><th>Source</th><th class="num">Annual (today's $)</th><th class="num">Starts</th><th>Tax</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4">None entered</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

function yearTable(sim) {
  const rows = sim.years.map((y) => `
    <tr${y.shortfall > 0 ? ' class="depleted"' : ""}>
      <td>${y.age}</td>
      <td class="num">${fmt$(y.income)}</td>
      <td class="num">${y.spend ? fmt$(y.spend) : "—"}</td>
      <td class="num">${y.drawGross ? fmt$(y.drawGross) : "—"}</td>
      <td class="num">${y.penaltyPaid ? fmt$(y.penaltyPaid) : "—"}</td>
      <td class="num">${fmt$(y.total)}</td>
    </tr>`).join("");
  return `<details class="card">
    <summary><h3>Year-by-year table</h3></summary>
    <div class="table-scroll"><table>
      <thead><tr><th>Age</th><th class="num">Net income</th><th class="num">Spending</th>
        <th class="num">Gross draw</th><th class="num">Penalty</th><th class="num">End balance</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </details>`;
}

function renderResults() {
  const out = document.getElementById("results");
  const sim = simulate(state);
  const maxSpend = maxSustainableSpending(state);
  const earliestAge = earliestSustainableRetireAge(state);

  out.innerHTML = `
    ${kpiBar(sim, state, maxSpend, earliestAge)}
    ${verdictAlerts(sim, state)}
    <div class="card">
      <h3>Portfolio projection (today's $)</h3>
      <div id="chart"></div>
    </div>
    ${phaseTable(state)}
    ${sourcesTable(sim)}
    ${yearTable(sim)}`;

  const markers = [{ age: state.profile.retireAge, label: "retire" }];
  const pensionSrc = sim.sources.find((s) => s.key === "pension");
  if (pensionSrc) markers.push({ age: pensionSrc.startAge, label: "pension" });
  const ssAges = sim.sources.filter((s) => s.key.startsWith("ss")).map((s) => s.startAge);
  if (ssAges.length) markers.push({ age: Math.min(...ssAges), label: "SS" });

  renderChart(document.getElementById("chart"), sim.years, markers);
}

/* --------------------------- boot -------------------------------- */

buildForm(document.getElementById("inputs"));
renderResults();
