# Mutation testing (Stryker)

SubTrackr uses **Stryker** for mutation testing to measure how effective our test suite is at catching bugs.

Two configurations are maintained:

| Config              | Scope                                   | Test runner               |
| ------------------- | --------------------------------------- | ------------------------- |
| `stryker.conf.json` | Critical frontend paths (`src/**`)      | `jest.config.js`          |
| `stryker.backend.conf.json` | Critical backend paths (`backend/**`) | `jest.backend.config.js` |

Both runs target a **mutation score of 80% or higher** (`thresholds.break = 80`), so a
regression in test quality fails the run.

## Run locally

```bash
# Frontend (src/)
npm run mutation:test

# Backend (backend/)
npm run mutation:test:backend

# Both
npm run mutation:test:all
```

The commands resolve `@stryker-mutator/core`, `@stryker-mutator/jest-runner` and
`@stryker-mutator/typescript-checker` through `npx`, so nothing has to be added to
`package.json` dependencies.

## What to expect

- The HTML report is written to `reports/mutation/frontend/mutation.html` (and
  `reports/mutation/backend/mutation.html` for the backend run).
- The run fails if the mutation score drops below the configured thresholds in the
  relevant `stryker*.conf.json`.
- `npm run mutation:report` re-reads the JSON reports, prints per-module scores
  and the weakest files, and writes `reports/mutation-dashboard/dashboard.json`.
  It **reads the report paths and thresholds from the Stryker configs**, so it
  cannot drift from the gate Stryker and CI actually enforce. A missing report is
  a failure by default — run `npm run mutation:test:all` first — or pass
  `--allow-missing` to skip that check.
- `reports/` and `.stryker-tmp/` are git-ignored.

## Critical paths covered

**Frontend** – billing, proration and theming primitives:

- `src/utils/proration.ts`
- `src/utils/invoice.ts`
- `src/utils/billingAlignment.ts`
- `src/utils/subscriptionHelpers.ts`
- `src/store/pauseStore.ts`
- `src/theme/customThemeBuilder.ts`
- `src/theme/cssVariables.ts`

**Backend** – subscription lifecycle and aggregation domain logic:

- `backend/subscription/domain/pauseBilling.ts`
- `backend/subscription/domain/pauseStateStore.ts`
- `backend/subscription/domain/batchAggregation.ts`
- `backend/subscription/domain/portalBranding.ts`
- `backend/subscription/controller/pauseController.ts`
- `backend/subscription/controller/batchController.ts`

## Raising the score

1. Open the HTML report and sort by "mutation score" ascending.
2. Surviving mutants in an `if`/`switch`/comparison usually mean a missing branch test.
3. Add a test in the matching `__tests__` directory, then re-run the command above.

## CI

`.github/workflows/mutation-testing.yml` runs both configurations on demand
(`workflow_dispatch`) and uploads the HTML report as a build artifact.
