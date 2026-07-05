# SubTrackr Load Tests (k6)

Automated load testing for the SubTrackr API and (simulated) contract calls
using [k6](https://k6.io). Covers critical API endpoints, a contract load
simulation, CI-integrated thresholds, performance baselines, and report
generation.

## Layout

```
load-tests/
├── run.js                 # entrypoint; dispatches scenarios + handleSummary
├── baseline.json          # performance baseline for regression detection
├── config/options.js      # load profiles + thresholds (incl. per-endpoint)
├── api/subscription.test.js     # API endpoint requests
├── contracts/contractLoad.test.js # Soroban-simulated contract calls
├── scenarios/             # subscriptionFlow / billingCycle / userLoad
├── utils/helpers.js       # request helpers + per-endpoint metrics
├── utils/baseline.js      # baseline comparison
├── utils/summary.js       # report generation (json/md/html + stdout)
├── reports/               # generated reports (git-ignored)
├── SCALABILITY.md         # bottleneck identification guide
└── README.md
```

## Running

```bash
# Default ramping subscription flow against the default BASE_URL
npm run load:test

# Pick a scenario and target
k6 run load-tests/run.js --env SCENARIO=billing --env BASE_URL=https://staging.api.subtrackr.com

# Convenience scripts
npm run load:test:subscription
npm run load:test:billing
npm run load:test:user
npm run load:test:contract
```

`SCENARIO` ∈ `subscription` (default) | `billing` | `user` | `contract`.
Env: `BASE_URL`, `API_KEY`.

## Reports

Each run writes to `load-tests/reports/`:

- `summary.json` — raw k6 metrics (for trend tracking / tooling)
- `summary.md` — human-readable report with baseline diff
- `summary.html` — rich report uploaded as a CI artifact

## Thresholds & CI

`config/options.js` defines pass/fail thresholds (overall p95 latency, error
rate, and per-endpoint latency budgets). k6 exits non-zero when a threshold is
breached, so the CI `load-test` job fails the build on a regression. The job
also uploads the HTML/MD/JSON report as an artifact.

## Performance baseline

`baseline.json` holds the expected metric values and a `tolerancePct`. After a
run, `utils/baseline.js` compares results and flags any metric that exceeds
baseline by more than the tolerance (shown in the report and stdout).

**Updating the baseline:** only after an intentional, verified performance
change. Run the relevant scenario against a representative environment, confirm
the new numbers are expected, and edit `baseline.json` in the same PR with a
note explaining the change. Never update it just to silence a regression.

See [SCALABILITY.md](./SCALABILITY.md) for bottleneck identification.
