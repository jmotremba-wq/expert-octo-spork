// chart.js — inline-SVG scenario comparison chart: one line of total
// portfolio balance by age per visible scenario, with direct labels at the
// line ends, age markers, and a crosshair + tooltip hover layer.
// Colors are fixed per scenario identity (validated light palette); the
// direct end labels + the comparison table are the required relief for the
// lower-contrast slots.

const INK = "#0b0b0b";
const MUTED = "#898781";
const GRID = "#e1e0d9";
const BASELINE_AXIS = "#c3c2b7";

const fmtCompact = (v) =>
  "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const fmtFull = (v) => "$" + Math.round(v).toLocaleString("en-US");

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

// series: [{ key, label, short, color, years: sim.years, emphasized }]
export function renderChart(container, series, markers = []) {
  // Size the viewBox to the container so SVG text renders ~1:1 (a fixed wide
  // viewBox scaled down to a phone makes labels illegible).
  const W = Math.max(320, Math.min(880, container.clientWidth || 760));
  const narrow = W < 520;
  const H = narrow ? 250 : 300;
  // padR reserves room for the direct end labels — sized from the longest one.
  const labelFont = narrow ? 10 : 11;
  const longest = Math.max(...series.map((s) => s.short.length));
  const padL = narrow ? 42 : 48;
  const padR = Math.min(150, Math.max(70, Math.round(longest * labelFont * 0.62) + 24));
  const padT = 26, padB = 26;
  const innerW = W - padL - padR, innerH = H - padT - padB;

  const allYears = series[0].years;
  const minAge = allYears[0].age, maxAge = allYears[allYears.length - 1].age;
  const yMax = niceCeil(Math.max(1, ...series.flatMap((s) => s.years.map((y) => y.total))));

  const x = (age) => padL + ((age - minAge) / Math.max(1, maxAge - minAge)) * innerW;
  const y = (v) => padT + innerH - (Math.max(0, v) / yMax) * innerH;

  // Grid + axes (recessive).
  let grid = "";
  for (let i = 1; i <= 4; i++) {
    const v = (yMax / 4) * i, yy = y(v).toFixed(1);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>
      <text x="${padL - 6}" y="${(+yy + 3).toFixed(1)}" text-anchor="end" class="ax">${fmtCompact(v)}</text>`;
  }
  const tickStep = narrow ? 10 : 5;
  let xticks = "";
  for (let a = Math.ceil(minAge / tickStep) * tickStep; a <= maxAge; a += tickStep) {
    xticks += `<text x="${x(a).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${a}</text>`;
  }

  const markerSvg = markers
    .filter((m) => m.age > minAge && m.age < maxAge)
    .map((m) => {
      const mx = x(m.age).toFixed(1);
      // On narrow charts the marker labels collide — keep just the lines
      // (the tooltip and fine-print tables carry the ages).
      const label = narrow ? "" :
        `<text x="${mx}" y="${padT - 6}" text-anchor="middle" class="ax">${m.label} ${m.age}</text>`;
      return `<line x1="${mx}" y1="${padT}" x2="${mx}" y2="${padT + innerH}"
          stroke="${MUTED}" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/>${label}`;
    }).join("");

  const lines = series.map((s) => {
    const pts = s.years.map((yr) => `${x(yr.age).toFixed(1)},${y(yr.total).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${s.color}"
      stroke-width="${s.emphasized ? 2.75 : 2}" stroke-linejoin="round" stroke-linecap="round"
      ${s.emphasized ? "" : 'opacity="0.9"'}/>`;
  }).join("");

  // Direct labels at line ends, nudged apart to avoid collisions.
  const ends = series
    .map((s) => ({ s, ey: y(s.years[s.years.length - 1].total) }))
    .sort((a, b) => a.ey - b.ey);
  const MIN_GAP = 13;
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].ey - ends[i - 1].ey < MIN_GAP) ends[i].ey = ends[i - 1].ey + MIN_GAP;
  }
  const endLabels = ends.map(({ s, ey }) => `
    <text x="${W - padR + 6}" y="${Math.min(ey, padT + innerH).toFixed(1)}"
      class="end-label" font-size="${labelFont}" fill="${INK}" dominant-baseline="middle">
      <tspan fill="${s.color}">●</tspan> ${s.short}</text>`).join("");

  container.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img"
           aria-label="Line chart comparing projected total portfolio balance by age for each selected scenario. The same figures appear in the comparison table above.">
        ${grid}
        <line x1="${padL}" y1="${padT + innerH}" x2="${W - padR}" y2="${padT + innerH}" stroke="${BASELINE_AXIS}" stroke-width="1"/>
        ${markerSvg}
        ${lines}
        ${endLabels}
        <line class="crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + innerH}"
              stroke="${INK}" stroke-width="1" opacity="0"/>
        ${xticks}
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>`;

  // ---- Hover layer ----
  const svg = container.querySelector("svg");
  const crosshair = svg.querySelector(".crosshair");
  const tip = container.querySelector(".chart-tooltip");

  const show = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const age = Math.min(maxAge, Math.max(minAge,
      Math.round(minAge + ((px - padL) / innerW) * (maxAge - minAge))));

    const cx = x(age).toFixed(1);
    crosshair.setAttribute("x1", cx);
    crosshair.setAttribute("x2", cx);
    crosshair.setAttribute("opacity", "0.35");

    tip.innerHTML = `<div class="tip-title">Age ${age}</div>` +
      series.map((s) => {
        const yr = s.years.find((v) => v.age === age);
        return `<div class="tip-row"><span class="swatch" style="background:${s.color}"></span>
          <span>${s.short}</span><span class="tip-val">${yr ? fmtFull(yr.total) : "—"}</span></div>`;
      }).join("");
    tip.hidden = false;
    const wrap = container.querySelector(".chart-wrap").getBoundingClientRect();
    const left = clientX - wrap.left + 14;
    tip.style.left = Math.max(0, Math.min(left, wrap.width - tip.offsetWidth - 8)) + "px";
    tip.style.top = Math.max(0, clientY - wrap.top - tip.offsetHeight - 10) + "px";
  };

  svg.addEventListener("pointermove", (e) => show(e.clientX, e.clientY));
  svg.addEventListener("pointerleave", () => {
    crosshair.setAttribute("opacity", "0");
    tip.hidden = true;
  });
}
