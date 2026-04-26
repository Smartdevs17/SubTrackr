# Mutation testing (Stryker)

SubTrackr uses **Stryker** for mutation testing to measure how effective our test suite is at catching bugs.

## Run locally

```bash
npm run mutation:test
```

## What to expect

- The HTML report is written to `reports/mutation/html/index.html`.
- The run fails if the mutation score drops below the configured thresholds in `stryker.conf.json`.

