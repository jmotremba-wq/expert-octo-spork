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

- **KPI bar** — balance at retirement, how long the money lasts, **max
  sustainable spending** (bisection solver), and **earliest sustainable
  retirement age**.
- **Stacked-area projection** of the five buckets (pre-tax, Roth, taxable,
  hard assets, cash) by age, with retire/pension/SS markers and a hover
  tooltip. A year-by-year table carries the same data.
- **"The bridge, phase by phase"** — each segment between income steps
  (retire → pension → SS), with net income, spending, and the portfolio draw
  the segment demands.
- **Alerts** — sustainability verdict and a pre-59½ access-gap warning with
  total penalties incurred.

## Data & privacy

All seeded values are **generic placeholders** — no real data lives in this
repo. Edits persist only to your browser's `localStorage` (key `retcalc_v1`);
nothing is uploaded anywhere. "Reset to placeholder defaults" clears the
stored blob.

## Files

| File          | Purpose                                                    |
| ------------- | ---------------------------------------------------------- |
| `index.html`  | Page shell.                                                |
| `styles.css`  | Dark finance-terminal theme.                               |
| `calc.js`     | Pure model: simulation, phases, solvers. No DOM.           |
| `chart.js`    | Inline-SVG stacked area chart + hover layer.               |
| `app.js`      | Form, localStorage persistence, results rendering.         |
| `tests/`      | `node --test` suite for the model (`npm test`).            |

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
