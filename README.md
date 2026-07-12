# Retirement Bridge Calculator

A personal retirement calculator built for one specific shape of retirement:
**stop working years before any pension or Social Security starts**, and get
across the gap with the right accounts in the right order.

Vanilla HTML/CSS/JS — **no build step, no frameworks, no dependencies**. Open
`index.html` (or serve statically) and it runs.

## What makes this case unique

Most retirement calculators assume income starts when work stops. This plan
doesn't:

- **Guard/Reserve military pension** — computed as High-3 × points multiplier,
  but it doesn't start until **age 60**, years after the planned retirement.
  CRDP is assumed, so VA pay does not offset it.
- **VA disability** — tax-free and already being paid; it's the only income
  during the early bridge years.
- **Two Social Security benefits** with independent claim ages (62–70 factors
  applied to each earner's monthly PIA).
- **Pre-59½ access rules** — cash, taxable, hard assets, and Roth *basis* are
  spendable immediately; traditional 401(k)/IRA/HSA money is not. The
  simulator withdraws in that order and, if accessible money runs out before
  59½, models the forced penalized draws and flags the gap (the cue to plan a
  Roth conversion ladder or 72(t)/SEPP instead).
- **Hard assets** (gold, silver, bitcoin) projected at their own growth rates,
  separate from the portfolio return.
- **Healthcare bridge cost** — extra annual premiums until TRICARE-age relief.

Everything is modeled in **today's (real) dollars**: returns are deflated via
the Fisher relation, so COLA'd income (pension/VA/SS) reads at face value.

## What it shows

The page reads like a meeting with an advisor, top to bottom:

- **Verdict hero** — one plain-English sentence on whether the plan holds,
  with the three headline numbers (money lasts until / balance at retirement /
  max sustainable spending).
- **What-if scenarios** — curated presets compared side-by-side against the
  baseline (retire 2 years later, spend 15% less, weak markets, a 23% Social
  Security cut, claiming at 70), plus a **"My scenario"** with free tweaks to
  retirement age, spending, returns, and SS claim age.
- **Side-by-side table** — lasts-until, balance at retirement, max spend,
  bridge draw, and penalties for every active scenario.
- **Advisor's notes** — rule-based recommendations generated from the numbers:
  bridge funding (Roth conversion ladder / 72(t) when accessible money runs
  short), sequence-of-returns exposure, spending headroom, earliest viable
  retirement age, and return sensitivity.
- **Comparison chart** — portfolio balance by age, one line per scenario, with
  direct labels and retire/pension/SS markers.
- **The fine print** — bridge phases, income sources, and the year-by-year
  table for any chosen scenario; all inputs live in a collapsed
  **"Your numbers"** section at the bottom.

Light theme, mobile-first (portrait or landscape).

## Data & privacy

All seeded values are **generic placeholders** — no real data lives in this
repo. Edits persist only to your browser's `localStorage` (key `retcalc_v1`);
nothing is uploaded anywhere. "Reset to placeholder defaults" clears the
stored blob.

## Files

| File          | Purpose                                                    |
| ------------- | ---------------------------------------------------------- |
| `index.html`  | Page shell.                                                |
| `styles.css`  | Light, mobile-first theme.                                 |
| `calc.js`     | Pure model: simulation, phases, solvers, scenarios. No DOM.|
| `advisor.js`  | Pure rule engine that writes the advisor's notes.          |
| `chart.js`    | Inline-SVG scenario comparison chart + hover layer.        |
| `app.js`      | Page flow, scenario chips, form, localStorage persistence. |
| `tests/`      | `node --test` suites for model + advisor (`npm test`).     |

## Running

Serve the directory statically and open it — ES modules need HTTP, not
`file://`:

```sh
python3 -m http.server 8080   # or: npm run serve
```

Run the model tests with `npm test` (Node 18+, no installs needed).

## Model simplifications (on purpose)

- Taxes are **effective rates you choose** per source/bucket, not bracket math.
- The HSA is folded into the pre-tax bucket.
- Pre-59½ Roth *earnings* draws are approximated as penalty-only.
- 59½ is rounded up to age 60 (one conservative half-year).
- Social Security taxation nuance (85% inclusion, etc.) is folded into the
  income tax rate you set.
