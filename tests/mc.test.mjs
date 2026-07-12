// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultInputs, simulate } from "../calc.js";
import { mulberry32, randn, monteCarlo } from "../mc.js";

test("mulberry32 is deterministic and uniform-ish", () => {
  const a = mulberry32(123), b = mulberry32(123);
  const seqA = Array.from({ length: 5 }, () => a());
  const seqB = Array.from({ length: 5 }, () => b());
  assert.deepEqual(seqA, seqB);
  seqA.forEach((v) => assert.ok(v >= 0 && v < 1));
});

test("randn produces roughly zero-mean draws", () => {
  const rng = mulberry32(7);
  let sum = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) sum += randn(rng);
  assert.ok(Math.abs(sum / N) < 0.05, `mean ${sum / N} too far from 0`);
});

test("same seed gives identical Monte Carlo results", () => {
  const inp = defaultInputs();
  const a = monteCarlo(inp, { trials: 200, seed: 42 });
  const b = monteCarlo(inp, { trials: 200, seed: 42 });
  assert.equal(a.successRate, b.successRate);
  assert.deepEqual(a.percentiles, b.percentiles);
});

test("zero volatility collapses to the deterministic outcome", () => {
  const inp = defaultInputs();
  inp.market.volatilityPct = 0;
  inp.hardAssets.forEach((a) => { a.volatilityPct = 0; });
  const det = simulate(inp);
  const mc = monteCarlo(inp, { trials: 50, seed: 1 });
  assert.equal(mc.successRate, det.sustainable ? 1 : 0);
  // Every percentile equals the deterministic path.
  const last = mc.percentiles[mc.percentiles.length - 1];
  assert.ok(Math.abs(last.p10 - det.ending) < 1e-6);
  assert.ok(Math.abs(last.p90 - det.ending) < 1e-6);
});

test("percentiles are monotonic at every age", () => {
  const mc = monteCarlo(defaultInputs(), { trials: 300, seed: 9 });
  for (const p of mc.percentiles) {
    assert.ok(p.p10 <= p.p25 && p.p25 <= p.p50 && p.p50 <= p.p75 && p.p75 <= p.p90,
      `non-monotonic at age ${p.age}`);
  }
});

test("higher volatility lowers the success rate", () => {
  const calm = defaultInputs();
  calm.market.volatilityPct = 5;
  const wild = defaultInputs();
  wild.market.volatilityPct = 25;
  const calmMC = monteCarlo(calm, { trials: 400, seed: 42 });
  const wildMC = monteCarlo(wild, { trials: 400, seed: 42 });
  assert.ok(wildMC.successRate < calmMC.successRate,
    `expected ${wildMC.successRate} < ${calmMC.successRate}`);
});
