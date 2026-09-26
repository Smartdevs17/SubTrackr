# Mutation Testing with Stryker

SubTrackr uses **Stryker Mutator** to measure the effectiveness of our test suite. Mutation testing introduces small changes (mutants) into the source code and checks whether the existing tests detect (kill) those mutants. This helps identify weak or missing tests.

## Overview

- **Frontend (React Native):** Configured in `stryker.conf.json`
- **Backend (Node.js/Express):** Configured in `stryker.backend.conf.json`
- **Runner:** Jest (via `@stryker-mutator/jest-runner`)
- **Checker:** TypeScript (via `@stryker-mutator/typescript-checker`)
- **Thresholds:**
  - High (target): 80%
  - Low (warning): 60%
  - Break (fail): 50%

## Running Mutation Tests

### All Modules

```bash
npm run mutation:all
```

### Frontend Only

```bash
npm run mutation:frontend
```

### Backend Only

```bash
npm run mutation:backend
```

### Default (uses `stryker.conf.json`)

```bash
npm run mutation:test
```

## Reports

### HTML Report

After running mutation tests, open the HTML report in your browser:

- **Frontend:** `reports/mutation/frontend/mutation.html`
- **Backend:** `reports/mutation/backend/mutation.html`

### Dashboard

A web-based dashboard is available at `reports/mutation-dashboard/index.html`. It:
- Displays mutation scores for frontend and backend
- Highlights weak tests (files with scores below 60%)
- Shows killed/survived mutant counts
- Indicates pass/fail status against thresholds

To update the dashboard after running mutation tests:

```bash
npm run mutation:report
```

### Score Checking

The `scripts/check-mutation-score.js` script:

```bash
# Check frontend only
node scripts/check-mutation-score.js --module=frontend

# Check backend only
node scripts/check-mutation-score.js --module=backend

# Print combined summary
node scripts/check-mutation-score.js --summary
```

The script exits with a non-zero code if any module's score falls below the break threshold (50%).

## CI Integration

Mutation testing is available as CI-ready npm scripts (`mutation:test:ci` /
`mutation:test:backend:ci`) which produce machine-readable JSON reports. They
are intentionally not part of the default `ci.yml` merge gate because a full
mutation run is very expensive; wire them into a dedicated, non-blocking
workflow when the test suite is stable enough to sustain the break threshold
(50%). Both Stryker configs already point at the correct Jest project
(`jest.config.js` / `jest.backend.config.js`) and upload-ready reporters.

## Weak Test Detection

Files with a mutation score below **60%** are flagged as weak tests. The dashboard and CI summary both highlight these files for attention.

To address weak tests:
1. Open the HTML report to see which mutants survived
2. Add or update tests for the uncovered logic
3. Re-run mutation tests to verify improvement

## Configuration

### Frontend (`stryker.conf.json`)

| Setting | Value |
|---------|-------|
| Mutate pattern | `src/**/*.{ts,tsx}` (excludes tests, mocks, fixtures, declarations) |
| Test runner | Jest with `jest.config.js` |
| TypeScript checker | `tsconfig.json` |
| Reporters | `progress`, `clear-text`, `html`, `dashboard` |
| Coverage analysis | `perTest` |
| Timeout | 60s |

### Backend (`stryker.backend.conf.json`)

| Setting | Value |
|---------|-------|
| Mutate pattern | `backend/**/*.ts` (excludes tests, mocks, fixtures, declarations) |
| Test runner | Jest with `jest.backend.config.js` |
| TypeScript checker | `backend/tsconfig.json` |
| Reporters | `progress`, `clear-text`, `html`, `dashboard` |
| Coverage analysis | `perTest` |
| Timeout | 60s |

## Best Practices

1. **Run mutation tests before merging** — ensures new code has adequate test coverage
2. **Keep the score above 80%** — the high threshold is the target for all modules
3. **Review survived mutants** — not all survivors are bad; some may be equivalent mutants (functionally identical code)
4. **Incrementally improve** — if a module has a low score, focus on the weakest files first
5. **Use the HTML report** — it shows exactly which lines survived and why

## Troubleshooting

### "No tests matched" error

Ensure your test files match the patterns in the Jest config. For backend tests, they must be in `backend/**/__tests__/**/*.test.ts` or `backend/tests/**/*.test.ts`.

### High memory usage

Stryker can be memory-intensive. If you experience out-of-memory errors:

```bash
# Reduce concurrency
npx stryker run --concurrency 2
```

### Slow execution

Mutation testing is inherently slower than regular tests. To speed things up:

- Run only the module you're working on (`npm run mutation:frontend` or `npm run mutation:backend`)
- Increase concurrency if you have sufficient CPU cores
- Use `--incremental` to reuse results from previous runs (Stryker 9.x+)

### Compile errors

If the TypeScript checker reports compilation errors:
- Ensure `skipLibCheck: true` is set in your tsconfig
- Check that all imported modules are properly resolved
- Verify the tsconfig path in the Stryker config matches your project structure
