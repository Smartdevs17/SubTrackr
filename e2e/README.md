# SubTrackr E2E Suite

Deterministic Detox suite — see [docs/e2e-deterministic-testing.md](../docs/e2e-deterministic-testing.md)
for the full guide on writing reliable tests.

## Coverage

- Subscription creation flow
- Subscription charging simulation flow (mocked network)
- Subscription cancellation flow
- Subscription plan change flow
- Visual regression snapshots (home + detail screens)

## Determinism

Every test is hermetic and isolated:

- **State** — storage is wiped per test; data is seeded via fixed fixtures
  (`helpers/testData.ts`). Clock, locale and timezone are pinned.
- **Waits** — `helpers/waits.ts` only; no `sleep`/fixed timers.
- **Network** — mocked via named scenarios (`helpers/mockServer.ts`); the app
  never hits the wire during E2E.
- **Visuals** — tolerance-based pixel diff (`helpers/visualRegression.ts`), not
  exact hashing.

## Running

```bash
npm run e2e:test-ios            # iOS simulator
npm run e2e:test-android        # Android emulator
npm run e2e:test-ios:parallel   # parallel workers
```

### Stability (zero-flaky gate)

```bash
npm run e2e:stability-android   # fails if any test only passes on retry
```

Retries are configurable via `E2E_RETRIES` (default 2). Set
`E2E_FAIL_ON_FLAKY=true` to fail the build on any detected flake. The CI
`stability` job runs the suite 5 consecutive times with this gate enabled.

## Visual baselines

PNG baselines live in `e2e/fixtures/baselines/`; per-snapshot tolerances are in
`e2e/fixtures/visual-baselines.json`.

```bash
UPDATE_VISUAL_BASELINE=true npm run e2e:visual:update-ios
```

Tolerances are tunable per call or via env (`VISUAL_PIXEL_THRESHOLD`,
`VISUAL_MAX_DIFF_RATIO`).

## Artifacts

After a run, `artifacts/` contains Detox logs/screenshots/video, plus:

- `flaky-report.json` — tests that only passed after a retry
- `visual-diffs/*.diff.png` — diff images for failed visual comparisons
