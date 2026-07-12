// app.js — UI shell: advisor-first page flow, scenario chips, comparison
// table, balance updates (quick panel + CSV import), Monte Carlo wiring,
// snapshots, backup/restore, and print. All math lives in calc.js /
// advisor.js / mc.js; parsing in import.js; drawing in chart.js.

import {
  defaultInputs, phases, runAllScenarios,
  SCENARIOS, CUSTOM_SCENARIO, PRETAX_ACCESS_AGE,
} from "./calc.js";
import { advise } from "./advisor.js";
import { renderChart, renderSparkline } from "./chart.js";
import { monteCarloCached } from "./mc.js";
import {
  parseBalancesCSV, applyBalances, IMPORT_TARGETS,
  serializeBackup, parseBackup,
} from "./import.js";

const STORAGE_KEY = "retcalc_v2";
const LEGACY_KEY = "retcalc_v1";
const MC_TRIALS = 1000;

/* ---------------------------- state ------------------------------ */

function hydrateInputs(saved, defaults) {
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

function defaultUI(inputs) {
  return {
    active: ["baseline", "retireLater", "trimSpending", "marketStress"],
    detailKey: "baseline",
    custom: {
      retireAge: inputs.profile.retireAge,
      spendingBase: inputs.spending.baseAnnual,
      nominalReturnPct: inputs.market.nominalReturnPct,
      ssClaimAgeBoth: inputs.ss.aClaimAge,
    },
  };
}

function freshState(inputs) {
  return {
    inputs,
    ui: defaultUI(inputs),
    snapshots: [],
    mappings: {},
    meta: { lastBalanceUpdate: null },
  };
}

function load() {
  const defaults = defaultInputs();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      const inputs = hydrateInputs(saved.inputs, defaults);
      return {
        ...freshState(inputs),
        ui: { ...defaultUI(inputs), ...(saved.ui || {}) },
        snapshots: Array.isArray(saved.snapshots) ? saved.snapshots : [],
        mappings: saved.mappings || {},
        meta: { lastBalanceUpdate: null, ...(saved.meta || {}) },
      };
    }
    // Migrate v1 (which stored the inputs object directly).
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return freshState(hydrateInputs(JSON.parse(legacy), defaults));
  } catch { /* fall through to defaults */ }
  return freshState(defaults);
}

let state = load();

// Transient UI state (not persisted).
let panelOpen = false;
let pendingRows = null;   // parsed CSV rows awaiting bucket mapping
let importError = null;

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
const fmtK = (v) =>
  "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
const today = () => new Date().toISOString().slice(0, 10);

const ALL_SCENARIOS = [...SCENARIOS, CUSTOM_SCENARIO];
const scenarioByKey = (key) => ALL_SCENARIOS.find((s) => s.key === key);

/* ------------------------- balances/snapshots -------------------- */

const BALANCE_FIELDS = [
  { label: "Cash / banking", path: "buckets.cash" },
  { label: "Taxable brokerage", path: "buckets.taxable" },
  { label: "Pre-tax 401(k)/IRA", path: "buckets.pretax" },
  { label: "HSA", path: "buckets.hsa" },
  { label: "Roth", path: "buckets.roth" },
  { label: "Roth basis", path: "buckets.rothBasis" },
  { label: "Gold", path: "hardAssets.0.value" },
  { label: "Silver", path: "hardAssets.1.value" },
  { label: "Bitcoin", path: "hardAssets.2.value" },
];

function investableTotal() {
  const b = state.inputs.buckets;
  return b.cash + b.taxable + b.pretax + b.hsa + b.roth +
    state.inputs.hardAssets.reduce((s, a) => s + a.value, 0);
}

function recordSnapshot() {
  const snap = { date: today(), total: Math.round(investableTotal()) };
  const i = state.snapshots.findIndex((s) => s.date === snap.date);
  if (i >= 0) state.snapshots[i] = snap; else state.snapshots.push(snap);
  state.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  state.meta.lastBalanceUpdate = snap.date;
}

// Suggest a bucket for an unseen account name.
function guessTarget(name) {
  const s = name.toLowerCase();
  if (/roth/.test(s)) return "roth";
  if (/hsa/.test(s)) return "hsa";
  if (/401|403|ira|tsp|retire/.test(s)) return "pretax";
  if (/gold/.test(s)) return "gold";
  if (/silver/.test(s)) return "silver";
  if (/bitcoin|btc|crypto|coin/.test(s)) return "bitcoin";
  if (/check|saving|cash|bank/.test(s)) return "cash";
  if (/broker|taxable|invest/.test(s)) return "taxable";
  return "ignore";
}

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
      { label: "Volatility % (simulations)", path: "market.volatilityPct", step: 0.5, note: "yearly swing size for Monte Carlo" },
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
      { label: "Gold volatility %", path: "hardAssets.0.volatilityPct", step: 0.5 },
      { label: "Silver value", path: "hardAssets.1.value" },
      { label: "Silver growth %", path: "hardAssets.1.growthPct", step: 0.1 },
      { label: "Silver volatility %", path: "hardAssets.1.volatilityPct", step: 0.5 },
      { label: "Bitcoin value", path: "hardAssets.2.value" },
      { label: "Bitcoin growth %", path: "hardAssets.2.growthPct", step: 0.1 },
      { label: "Bitcoin volatility %", path: "hardAssets.2.volatilityPct", step: 0.5 },
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

function renderForm() {
  const root = document.getElementById("inputs");
  root.innerHTML = FORM_SECTIONS.map((sec) => `
    <details class="form-card">
      <summary>${sec.title}</summary>
      <div class="form-grid">
        ${sec.fields.map((f) => `
          <label class="field">
            <span>${f.label}</span>
            <input type="number" inputmode="decimal" step="${f.step ?? "any"}"
                   data-path="${f.path}" value="${getPath(state.inputs, f.path)}"/>
            ${f.note ? `<small>${f.note}</small>` : ""}
          </label>`).join("")}
      </div>
    </details>`).join("") + `
    <div class="numbers-actions">
      <button type="button" class="ghost-btn" id="backup-btn">Download backup</button>
      <button type="button" class="ghost-btn" id="restore-btn">Restore from backup</button>
      <button type="button" class="reset-btn" id="reset-btn">Reset to placeholder defaults</button>
      <input type="file" id="restore-file" accept=".json,application/json" hidden/>
    </div>`;
}

function initForm() {
  const root = document.getElementById("inputs");
  renderForm();

  root.addEventListener("change", (e) => {
    const path = e.target.dataset?.path;
    if (!path) return;
    const v = Number(e.target.value);
    setPath(state.inputs, path, Number.isFinite(v) ? v : 0);
    save();
    renderResults();
  });

  root.addEventListener("click", (e) => {
    if (e.target.id === "reset-btn") {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_KEY);
      location.reload();
    } else if (e.target.id === "backup-btn") {
      const blob = new Blob([serializeBackup(state)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `retirement-backup-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } else if (e.target.id === "restore-btn") {
      root.querySelector("#restore-file").click();
    }
  });

  root.addEventListener("change", async (e) => {
    if (e.target.id !== "restore-file" || !e.target.files?.[0]) return;
    try {
      const restored = parseBackup(await e.target.files[0].text());
      const inputs = hydrateInputs(restored.inputs, defaultInputs());
      state = {
        inputs,
        ui: { ...defaultUI(inputs), ...(restored.ui || {}) },
        snapshots: restored.snapshots,
        mappings: restored.mappings,
        meta: { lastBalanceUpdate: null, ...(restored.meta || {}) },
      };
      save();
      renderForm();
      renderResults();
    } catch (err) {
      alert(err.message);
    } finally {
      e.target.value = "";
    }
  });
}

/* -------------------------- sections ----------------------------- */

const TONE_META = {
  good:   { icon: "✓", word: "On track" },
  watch:  { icon: "◔", word: "Watch" },
  action: { icon: "!", word: "Act" },
};

function heroSection(verdict, results) {
  const base = results.baseline;
  const lasts = base.sim.depletionAge != null
    ? `age ${base.sim.depletionAge}` : `age ${state.inputs.profile.lifeExpectancy}+`;
  const stat = (label, val) => `
    <div class="hero-stat"><span class="hs-val">${val}</span><span class="hs-label">${label}</span></div>`;
  return `<section class="hero hero--${verdict.tone}">
    <div class="hero-top">
      <div class="hero-badge"><span class="tone-icon tone-${verdict.tone}">${TONE_META[verdict.tone].icon}</span> ${TONE_META[verdict.tone].word}</div>
      <div class="hero-actions no-print">
        <button type="button" class="ghost-btn" id="update-balances-btn">Update balances</button>
        <button type="button" class="ghost-btn" id="print-btn">Print report</button>
      </div>
    </div>
    <h2>${verdict.title}</h2>
    <p>${verdict.body}</p>
    <div class="hero-stats">
      ${stat("money lasts until", lasts)}
      ${stat(`at retirement (${state.inputs.profile.retireAge})`, fmtK(base.sim.atRetirement))}
      ${stat("max sustainable spend", fmtK(base.maxSpend) + "/yr")}
    </div>
  </section>`;
}

function updatePanelSection() {
  if (!panelOpen) return "";
  const stamp = state.meta.lastBalanceUpdate
    ? `Balances last updated <strong>${state.meta.lastBalanceUpdate}</strong>`
    : "No balance update recorded yet";

  const fields = BALANCE_FIELDS.map((f) => `
    <label class="field">
      <span>${f.label}</span>
      <input type="number" inputmode="decimal" step="any"
             data-qpath="${f.path}" value="${getPath(state.inputs, f.path)}"/>
    </label>`).join("");

  let importBlock;
  if (pendingRows) {
    const options = (selected) => IMPORT_TARGETS.map((t) =>
      `<option value="${t.key}"${t.key === selected ? " selected" : ""}>${t.label}</option>`).join("");
    const rows = pendingRows.map((r, i) => {
      const name = r.account ?? "(this file)";
      const preset = r.account == null
        ? "ignore"
        : (state.mappings[r.account.toLowerCase()] ?? guessTarget(r.account));
      return `<tr>
        <td>${name}</td>
        <td class="num">${fmt$(r.balance)}</td>
        <td><select data-map-idx="${i}">${options(preset)}</select></td>
      </tr>`;
    }).join("");
    importBlock = `
      <p class="panel-hint">Found ${pendingRows.length} account${pendingRows.length !== 1 ? "s" : ""} — choose where each lands:</p>
      <div class="table-scroll"><table class="map-table">
        <thead><tr><th>Account</th><th class="num">Balance</th><th>Goes to</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="import-actions">
        <button type="button" class="primary-btn" id="apply-import-btn">Apply to plan</button>
        <button type="button" class="ghost-btn" id="cancel-import-btn">Cancel</button>
      </div>`;
  } else {
    importBlock = `
      <div class="drop-zone" id="drop-zone">
        <p><strong>Import from Monarch or a spreadsheet</strong></p>
        <p class="muted">Drop a CSV here, choose a file, or paste rows below —
        any columns with an account name and a balance work. Mappings are remembered.</p>
        <input type="file" id="csv-file" accept=".csv,.txt,text/csv" />
        <textarea id="csv-paste" rows="3" placeholder="Paste rows… e.g.  Vanguard Brokerage, $812,345"></textarea>
        <button type="button" class="ghost-btn" id="parse-paste-btn">Read pasted rows</button>
        ${importError ? `<p class="import-error">${importError}</p>` : ""}
      </div>`;
  }

  return `<section class="card update-panel no-print">
    <div class="details-head">
      <h3>Update balances</h3>
      <span class="stamp">${stamp}</span>
    </div>
    <div class="form-grid qp-grid">${fields}</div>
    <div id="sparkline"></div>
    ${importBlock}
  </section>`;
}

function chipsSection() {
  const chips = ALL_SCENARIOS.map((s) => {
    const on = state.ui.active.includes(s.key);
    const locked = s.key === "baseline";
    return `<button type="button" class="chip${on ? " chip--on" : ""}" data-chip="${s.key}"
      ${locked ? 'data-locked="1"' : ""} aria-pressed="${on}">
      <span class="swatch" style="background:${s.color}"></span>${s.label}</button>`;
  }).join("");

  const c = state.ui.custom;
  const customOpen = state.ui.active.includes("custom");
  const panel = customOpen ? `
    <div class="custom-panel">
      <p class="panel-hint">My scenario — your plan with these tweaks:</p>
      <div class="custom-grid">
        <label class="field"><span>Retire at</span>
          <input type="number" inputmode="numeric" data-custom="retireAge" value="${c.retireAge}"/></label>
        <label class="field"><span>Spending $/yr</span>
          <input type="number" inputmode="decimal" data-custom="spendingBase" value="${c.spendingBase}"/></label>
        <label class="field"><span>Return %</span>
          <input type="number" inputmode="decimal" step="0.1" data-custom="nominalReturnPct" value="${c.nominalReturnPct}"/></label>
        <label class="field"><span>Both claim SS at</span>
          <input type="number" inputmode="numeric" min="62" max="70" data-custom="ssClaimAgeBoth" value="${c.ssClaimAgeBoth}"/></label>
      </div>
    </div>` : "";

  return `<section class="card chips-card">
    <h3>What-if scenarios</h3>
    <p class="card-sub no-print">Tap to compare against your plan.</p>
    <div class="chip-row">${chips}</div>
    ${panel}
  </section>`;
}

function comparisonSection(results, mcByKey) {
  const rows = state.ui.active.map((key) => {
    const r = results[key];
    if (!r) return "";
    const s = r.scenario;
    const lasts = r.sim.depletionAge != null
      ? `<span class="neg">age ${r.sim.depletionAge}</span>`
      : `age ${r.inputs.profile.lifeExpectancy}+`;
    const bridgeDraw = phases(r.inputs)[0]?.draw ?? 0;
    const mc = mcByKey[key];
    const successTxt = mc ? Math.round(mc.successRate * 100) + "%" : "—";
    return `<tr>
      <td><span class="swatch" style="background:${s.color}"></span> ${s.label}</td>
      <td class="num">${successTxt}</td>
      <td class="num">${lasts}</td>
      <td class="num">${fmtK(r.sim.atRetirement)}</td>
      <td class="num">${fmtK(r.maxSpend)}</td>
      <td class="num">${fmt$(bridgeDraw)}</td>
    </tr>`;
  }).join("");

  return `<section class="card">
    <h3>Side by side</h3>
    <div class="table-scroll"><table>
      <thead><tr><th>Scenario</th><th class="num">Success odds</th><th class="num">Lasts until</th>
        <th class="num">At retirement</th><th class="num">Max spend/yr</th><th class="num">Bridge draw/yr</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="muted-note">Success odds: share of ${MC_TRIALS.toLocaleString("en-US")} simulated market histories where the money lasts.</p>
  </section>`;
}

function advisorSection(items) {
  if (!items.length) return "";
  const cards = items.map((a) => `
    <div class="note note--${a.tone}">
      <span class="tone-icon tone-${a.tone}" aria-hidden="true">${TONE_META[a.tone].icon}</span>
      <div><strong>${a.title}</strong><p>${a.body}</p></div>
    </div>`).join("");
  return `<section class="card">
    <h3>Advisor's notes</h3>
    ${cards}
  </section>`;
}

function chartSection() {
  return `<section class="card">
    <h3>Portfolio over time (today's $)</h3>
    <div class="chart-legend">${state.ui.active.map((key) => {
      const s = scenarioByKey(key);
      return `<span class="legend-item"><span class="swatch" style="background:${s.color}"></span>${s.label}</span>`;
    }).join("")}</div>
    <div id="chart"></div>
    <p class="muted-note">Shaded band: 10th–90th percentile (darker: 25th–75th) of
      ${MC_TRIALS.toLocaleString("en-US")} simulated markets for your plan at
      ±${state.inputs.market.volatilityPct}% volatility.</p>
  </section>`;
}

/* ---- detail accordions (for one chosen scenario) ---- */

function phaseTable(r) {
  const rows = phases(r.inputs).map((p) => `
    <tr>
      <td>${p.from}–${p.to}</td>
      <td>${p.years} yr${p.years !== 1 ? "s" : ""}</td>
      <td>${p.starts.length ? p.starts.join("; ") : (p.from === r.inputs.profile.retireAge ? "Retire" : "Healthcare bridge ends")}</td>
      <td class="num">${fmt$(p.income)}</td>
      <td class="num">${fmt$(p.spend)}</td>
      <td class="num${p.draw > 0 ? " warn-text" : ""}">${fmt$(p.draw)}</td>
    </tr>`).join("");
  return `<div class="table-scroll"><table>
    <thead><tr><th>Ages</th><th>Span</th><th>What changes</th>
      <th class="num">Net income/yr</th><th class="num">Spending/yr</th><th class="num">Portfolio draw/yr</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function sourcesTable(r) {
  const rows = r.sim.sources.map((s) => `
    <tr>
      <td>${s.label}</td>
      <td class="num">${fmt$(s.annual)}</td>
      <td class="num">${s.startAge === 0 ? "now" : "age " + s.startAge}</td>
      <td>${s.taxFree ? "tax-free" : "taxable"}</td>
    </tr>`).join("");
  return `<div class="table-scroll"><table>
    <thead><tr><th>Source</th><th class="num">Annual (today's $)</th><th class="num">Starts</th><th>Tax</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4">None entered</td></tr>`}</tbody>
  </table></div>`;
}

function yearTable(r) {
  const rows = r.sim.years.map((y) => `
    <tr${y.shortfall > 0 ? ' class="depleted"' : ""}>
      <td>${y.age}</td>
      <td class="num">${fmt$(y.income)}</td>
      <td class="num">${y.spend ? fmt$(y.spend) : "—"}</td>
      <td class="num">${y.drawGross ? fmt$(y.drawGross) : "—"}</td>
      <td class="num">${fmt$(y.buckets.pretax + y.buckets.roth)}</td>
      <td class="num">${fmt$(y.buckets.taxable + y.buckets.hard + y.buckets.cash)}</td>
      <td class="num">${fmt$(y.total)}</td>
    </tr>`).join("");
  return `<div class="table-scroll"><table>
    <thead><tr><th>Age</th><th class="num">Net income</th><th class="num">Spending</th>
      <th class="num">Gross draw</th><th class="num">Retirement accts</th><th class="num">Accessible</th><th class="num">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function detailsSection(results) {
  const r = results[state.ui.detailKey] || results.baseline;
  const options = state.ui.active.map((key) =>
    `<option value="${key}"${key === state.ui.detailKey ? " selected" : ""}>${scenarioByKey(key).label}</option>`).join("");
  return `<section class="card">
    <div class="details-head">
      <h3>The fine print</h3>
      <label class="detail-pick no-print">for <select id="detail-pick">${options}</select></label>
    </div>
    <details><summary>The bridge, phase by phase</summary>${phaseTable(r)}</details>
    <details><summary>Guaranteed income sources</summary>${sourcesTable(r)}</details>
    <details><summary>Year-by-year table</summary>${yearTable(r)}</details>
  </section>`;
}

/* ------------------------- import events ------------------------- */

function handleParsedText(text) {
  const rows = parseBalancesCSV(text);
  if (!rows.length) {
    importError = "Couldn't find balance rows in that — check it has a balance column (Monarch: Settings → Data → Download account balances).";
    pendingRows = null;
  } else {
    importError = null;
    pendingRows = rows;
  }
  renderResults();
}

function wireUpdatePanel(out) {
  // Quick balance fields.
  out.querySelectorAll("[data-qpath]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const v = Number(e.target.value);
      setPath(state.inputs, e.target.dataset.qpath, Number.isFinite(v) ? v : 0);
      recordSnapshot();
      save();
      renderForm();
      renderResults();
    });
  });

  // File / drop / paste.
  out.querySelector("#csv-file")?.addEventListener("change", async (e) => {
    if (e.target.files?.[0]) handleParsedText(await e.target.files[0].text());
  });
  const zone = out.querySelector("#drop-zone");
  if (zone) {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
      const file = e.dataTransfer?.files?.[0];
      if (file) handleParsedText(await file.text());
    });
  }
  out.querySelector("#parse-paste-btn")?.addEventListener("click", () => {
    const text = out.querySelector("#csv-paste")?.value ?? "";
    if (text.trim()) handleParsedText(text);
  });

  // Mapping apply / cancel.
  out.querySelector("#apply-import-btn")?.addEventListener("click", () => {
    const mapping = {};
    out.querySelectorAll("[data-map-idx]").forEach((sel) => {
      const row = pendingRows[Number(sel.dataset.mapIdx)];
      const key = row.account == null ? " single" : row.account.toLowerCase();
      mapping[key] = sel.value;
      if (row.account != null) state.mappings[key] = sel.value; // remember
    });
    const { inputs } = applyBalances(state.inputs, pendingRows, mapping);
    state.inputs = inputs;
    pendingRows = null;
    recordSnapshot();
    save();
    renderForm();
    renderResults();
  });
  out.querySelector("#cancel-import-btn")?.addEventListener("click", () => {
    pendingRows = null;
    importError = null;
    renderResults();
  });
}

/* -------------------------- results ------------------------------ */

function renderResults() {
  const out = document.getElementById("results");
  const results = runAllScenarios(state.inputs, state.ui.custom);
  // Drop stale active keys, keep baseline always on and first.
  state.ui.active = ["baseline", ...state.ui.active.filter((k) => k !== "baseline" && results[k])];
  if (!results[state.ui.detailKey] || !state.ui.active.includes(state.ui.detailKey)) {
    state.ui.detailKey = "baseline";
  }

  // Monte Carlo for active scenarios only (cached across renders).
  const mcByKey = {};
  for (const key of state.ui.active) {
    mcByKey[key] = monteCarloCached(key, results[key].inputs, { trials: MC_TRIALS, seed: 42 });
  }

  const advice = advise(results, state.inputs, mcByKey.baseline);

  out.innerHTML = `
    ${heroSection(advice[0], results)}
    ${updatePanelSection()}
    ${chipsSection()}
    ${comparisonSection(results, mcByKey)}
    ${advisorSection(advice.slice(1))}
    ${chartSection()}
    ${detailsSection(results)}`;

  // Chart series: active scenarios, baseline emphasized, MC band for baseline.
  const series = state.ui.active.map((key) => {
    const r = results[key];
    return {
      key, label: r.scenario.label, short: r.scenario.short,
      color: r.scenario.color, years: r.sim.years,
      emphasized: key === "baseline",
    };
  });
  const baseInp = results.baseline.inputs;
  const markers = [{ age: baseInp.profile.retireAge, label: "retire" }];
  const pensionSrc = results.baseline.sim.sources.find((s) => s.key === "pension");
  if (pensionSrc) markers.push({ age: pensionSrc.startAge, label: "pension" });
  const ssAges = results.baseline.sim.sources.filter((s) => s.key.startsWith("ss")).map((s) => s.startAge);
  if (ssAges.length) markers.push({ age: Math.min(...ssAges), label: "SS" });
  const band = mcByKey.baseline
    ? { percentiles: mcByKey.baseline.percentiles, color: scenarioByKey("baseline").color }
    : null;
  renderChart(document.getElementById("chart"), series, markers, band);
  lastChart = { series, markers, band };

  // Hero action buttons.
  out.querySelector("#update-balances-btn")?.addEventListener("click", () => {
    panelOpen = !panelOpen;
    renderResults();
  });
  out.querySelector("#print-btn")?.addEventListener("click", () => window.print());

  // Update panel events.
  wireUpdatePanel(out);
  const sparkEl = out.querySelector("#sparkline");
  if (sparkEl) renderSparkline(sparkEl, state.snapshots);

  // Chip toggles.
  out.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.locked) return;
      const key = btn.dataset.chip;
      const i = state.ui.active.indexOf(key);
      if (i >= 0) state.ui.active.splice(i, 1);
      else state.ui.active.push(key);
      save();
      renderResults();
    });
  });

  // Custom scenario fields.
  out.querySelectorAll("[data-custom]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const v = Number(e.target.value);
      state.ui.custom[e.target.dataset.custom] = Number.isFinite(v) ? v : 0;
      save();
      renderResults();
    });
  });

  // Detail scenario picker.
  out.querySelector("#detail-pick")?.addEventListener("change", (e) => {
    state.ui.detailKey = e.target.value;
    save();
    renderResults();
  });
}

/* --------------------------- boot -------------------------------- */

// Re-fit the chart when the viewport changes (e.g. phone rotation).
let lastChart = null;
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const el = document.getElementById("chart");
    if (el && lastChart) renderChart(el, lastChart.series, lastChart.markers, lastChart.band);
  }, 150);
});

// Print: open the fine-print sections so they appear in the report.
let printOpened = [];
window.addEventListener("beforeprint", () => {
  printOpened = [...document.querySelectorAll("#results details:not([open])")];
  printOpened.forEach((d) => { d.open = true; });
});
window.addEventListener("afterprint", () => {
  printOpened.forEach((d) => { d.open = false; });
  printOpened = [];
});

initForm();
renderResults();
