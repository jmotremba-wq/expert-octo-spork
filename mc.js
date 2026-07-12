// mc.js — seeded Monte Carlo over the simulation in calc.js. Pure and
// deterministic for a given seed, so results are testable and stable across
// re-renders. Each trial draws one standard-normal market factor per year
// (shared by the portfolio and every hard asset — fully correlated).

import { simulate } from "./calc.js";

/* ------------------------- randomness ---------------------------- */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller: two uniforms → one standard normal.
export function randn(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ------------------------- Monte Carlo --------------------------- */

function percentile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function monteCarlo(inputs, { trials = 1000, seed = 42 } = {}) {
  const rng = mulberry32(seed);
  const nYears =
    Math.max(inputs.profile.retireAge + 1, inputs.profile.lifeExpectancy) -
    inputs.profile.currentAge + 1;

  const balancesByYear = Array.from({ length: nYears }, () => new Array(trials));
  const endings = new Array(trials);
  let successes = 0;
  let ages = null;

  for (let t = 0; t < trials; t++) {
    // Pre-draw this trial's shocks so the draw order is independent of how
    // simulate() consumes them.
    const zs = new Array(nYears);
    for (let y = 0; y < nYears; y++) zs[y] = randn(rng);

    const sim = simulate(inputs, { shock: (y) => zs[y] ?? 0 });
    if (sim.sustainable) successes++;
    endings[t] = sim.ending;
    if (!ages) ages = sim.years.map((yr) => yr.age);
    for (let y = 0; y < sim.years.length; y++) {
      balancesByYear[y][t] = sim.years[y].total;
    }
  }

  const percentiles = ages.map((age, y) => {
    const sorted = balancesByYear[y].slice().sort((a, b) => a - b);
    return {
      age,
      p10: percentile(sorted, 0.10),
      p25: percentile(sorted, 0.25),
      p50: percentile(sorted, 0.50),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.90),
    };
  });

  return {
    trials,
    successRate: successes / trials,
    percentiles,
    medianEnding: percentile(endings.slice().sort((a, b) => a - b), 0.5),
  };
}

/* ---------------------------- cache ------------------------------ */

// Results keyed by scenario key + its exact inputs, so chip toggles and
// re-renders reuse work and only real input changes recompute.
const cache = new Map();

export function monteCarloCached(key, inputs, opts) {
  const cacheKey = key + "::" + JSON.stringify(inputs);
  if (!cache.has(cacheKey)) {
    if (cache.size > 40) cache.clear(); // bound memory across many edits
    cache.set(cacheKey, monteCarlo(inputs, opts));
  }
  return cache.get(cacheKey);
}
