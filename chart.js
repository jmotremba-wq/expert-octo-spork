// chart.js — inline-SVG stacked area of portfolio buckets by age, with a
// legend, crosshair + tooltip hover layer, and event markers (retire /
// pension / Social Security). Colors are a validated CVD-safe ordering;
// the 2px surface gap between bands is the required secondary encoding.

const SURFACE = "#171b20";

// Stack order bottom→top matches the validated palette adjacency order.
const BANDS = [
  { key: "pretax",  label: "Pre-tax (401k/IRA/HSA)", color: "#3987e5" },
  { key: "roth",    label: "Roth",                   color: "#199e70" },
  { key: "taxable", label: "Taxable",                color: "#c98500" },
  { key: "hard",    label: "Hard assets",            color: "#008300" },
  { key: "cash",    label: "Cash",                   color: "#9085e9" },
];

const fmtCompact = (v) =>
  "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const fmtFull = (v) =>
  "$" + Math.round(v).toLocaleString("en-US");

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

export function renderChart(container, years, markers = []) {
  const W = 760, H = 280;
  const padL = 52, padR = 12, padT = 26, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const minAge = years[0].age, maxAge = years[years.length - 1].age;
  const yMax = niceCeil(Math.max(1, ...years.map((y) => y.total)));

  const x = (age) => padL + ((age - minAge) / Math.max(1, maxAge - minAge)) * innerW;
  const y = (v) => padT + innerH - (Math.max(0, v) / yMax) * innerH;

  // Cumulative stack tops per band.
  const stacks = BANDS.map(() => []);
  years.forEach((yr) => {
    let cum = 0;
    BANDS.forEach((b, bi) => {
      cum += Math.max(0, yr.buckets[b.key]);
      stacks[bi].push(cum);
    });
  });

  const bandPolys = BANDS.map((b, bi) => {
    const top = stacks[bi];
    const bottom = bi === 0 ? years.map(() => 0) : stacks[bi - 1];
    const fwd = years.map((yr, i) => `${x(yr.age).toFixed(1)},${y(top[i]).toFixed(1)}`);
    const back = years.map((yr, i) => `${x(yr.age).toFixed(1)},${y(bottom[i]).toFixed(1)}`).reverse();
    return `<polygon points="${fwd.join(" ")} ${back.join(" ")}"
      fill="${b.color}" stroke="${SURFACE}" stroke-width="2" stroke-linejoin="round"/>`;
  }).join("");

  // Recessive grid: 4 horizontal hairlines with compact $ labels.
  let grid = "";
  for (let i = 1; i <= 4; i++) {
    const v = (yMax / 4) * i, yy = y(v).toFixed(1);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#2c2f35" stroke-width="1"/>
      <text x="${padL - 6}" y="${(+yy + 3).toFixed(1)}" text-anchor="end" class="ax">${fmtCompact(v)}</text>`;
  }
  // X ticks every 5 ages.
  let xticks = "";
  for (let a = Math.ceil(minAge / 5) * 5; a <= maxAge; a += 5) {
    xticks += `<text x="${x(a).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${a}</text>`;
  }

  const markerSvg = markers
    .filter((m) => m.age > minAge && m.age < maxAge)
    .map((m) => {
      const mx = x(m.age).toFixed(1);
      return `<line x1="${mx}" y1="${padT}" x2="${mx}" y2="${padT + innerH}"
          stroke="#b8bcc2" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"/>
        <text x="${mx}" y="${padT - 6}" text-anchor="middle" class="ax marker-label">${m.label} ${m.age}</text>`;
    }).join("");

  const legend = `<div class="chart-legend" role="list">${BANDS.slice().reverse().map((b) =>
    `<span class="legend-item" role="listitem"><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`,
  ).join("")}</div>`;

  container.innerHTML = `
    ${legend}
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img"
           aria-label="Stacked area chart of projected portfolio balance by age, split into pre-tax, Roth, taxable, hard-asset, and cash buckets. The same data appears in the year-by-year table below.">
        ${grid}
        <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="#3a3e45" stroke-width="1"/>
        ${bandPolys}
        ${markerSvg}
        <line class="crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + innerH}"
              stroke="#f5f6f7" stroke-width="1" opacity="0"/>
        ${xticks}
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>`;

  // ---- Hover layer: crosshair + tooltip on nearest age ----
  const svg = container.querySelector("svg");
  const crosshair = svg.querySelector(".crosshair");
  const tip = container.querySelector(".chart-tooltip");

  const show = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const age = Math.round(minAge + ((px - padL) / innerW) * (maxAge - minAge));
    const yr = years.find((v) => v.age === Math.min(maxAge, Math.max(minAge, age)));
    if (!yr) return;

    const cx = x(yr.age).toFixed(1);
    crosshair.setAttribute("x1", cx);
    crosshair.setAttribute("x2", cx);
    crosshair.setAttribute("opacity", "0.5");

    tip.innerHTML = `<div class="tip-title">Age ${yr.age} · ${fmtFull(yr.total)}</div>` +
      BANDS.slice().reverse().map((b) =>
        `<div class="tip-row"><span class="swatch" style="background:${b.color}"></span>
         <span>${b.label}</span><span class="tip-val">${fmtFull(yr.buckets[b.key])}</span></div>`,
      ).join("");
    tip.hidden = false;
    const wrap = container.querySelector(".chart-wrap").getBoundingClientRect();
    const left = clientX - wrap.left + 14;
    tip.style.left = Math.min(left, wrap.width - tip.offsetWidth - 8) + "px";
    tip.style.top = Math.max(0, clientY - wrap.top - tip.offsetHeight - 10) + "px";
  };

  svg.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
  svg.addEventListener("pointerleave", () => {
    crosshair.setAttribute("opacity", "0");
    tip.hidden = true;
  });
}
