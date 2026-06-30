# Writing Deterministic E2E Tests

Detox tests fail in CI for reasons that have nothing to do with real regressions:
timing, live network, and state leaking between cases. This guide describes the
infrastructure that removes those failure modes and the rules for keeping new
tests deterministic.

## The four pillars

| Concern             | Mechanism                                   | Where                                   |
| ------------------- | ------------------------------------------- | --------------------------------------- |
| Isolated state      | wipe storage + hermetic seed per test       | `e2e/helpers/launchArgs.ts`, `testData.ts` |
| Explicit waits      | poll a condition, never sleep               | `e2e/helpers/waits.ts`                  |
| Deterministic network | in-app `fetch` interceptor + scenarios    | `e2e/helpers/mockServer.ts`, `src/utils/e2e/` |
| Stable screenshots  | pixel-diff with tolerance, not hashing      | `e2e/helpers/visualRegression.ts`       |

## 1. Hermetic, isolated state

Every test launches a fresh app with storage wiped (`delete: true`) and a frozen
clock/locale/timezone. Use `launchCleanApp()` for an empty app or
`launchSeededApp(fixture)` to start with known data:

```ts
import { launchSeededApp } from './helpers/subscriptionFlows';
import { fixtures } from './helpers/testData';

beforeEach(async () => {
  await launchSeededApp(fixtures.portfolio);
});
```

Seeds are defined in `e2e/helpers/testData.ts` with **fixed** IDs and **absolute**
ISO dates (relative to the frozen clock `FIXED_NOW_MS = 2024-01-15T12:00:00Z`).
Never use `Date.now()` or random data in a fixture — it reintroduces drift.

The app reads the seed at startup in `src/utils/e2e/e2eBootstrap.ts`, writes it to
the zustand persist key, and rehydrates the store before the first frame. This is
a strict no-op outside E2E (`isE2E()` is false), so production is unaffected.

## 2. Explicit waits — never `sleep`

**Banned:** `device.sleep(ms)`, `setTimeout`-based waits, or `withTimeout` on a
fixed delay. They are simultaneously too slow (wastes CI time) and too short
(flaky on cold machines).

**Required:** wait on the condition you actually care about, via `helpers/waits.ts`:

```ts
import { waitForVisible, tapWhenReady, waitForGone } from './helpers/waits';

await tapWhenReady(by.id('save-subscription-button')); // waits, then taps
await waitForVisible(by.id('subscription-detail-screen'));
await waitForGone(by.text('Deleting…'));
```

Detox already idles on the bridge and animations, so these resolve the instant
the app settles.

## 3. Deterministic network

Live HTTP is the single biggest flake source. When launched with
`e2eMockNetwork=true` (the default), the app installs a `fetch` interceptor that
answers from a **named scenario**. Pick one per test:

```ts
await launchSeededApp(fixtures.empty, { scenario: 'charge-failure' });
```

Scenarios live in `e2e/helpers/mockServer.ts` (test-facing names) and are mirrored
in `src/utils/e2e/mockScenarios.ts` (the in-app responder). Add routes to **both**.
An unmapped request in a mocked run returns `501 unmocked_request` — fail loudly
rather than leak to the network.

Available scenarios: `happy-path` (default), `charge-failure`, `degraded-network`
(fixed latency to exercise loading states without real jitter).

## 4. Visual regression with tolerance

Screenshots are compared pixel-by-pixel with `pixelmatch`, not by exact hash. A
test passes when the fraction of differing pixels is within tolerance:

```ts
assertVisualSnapshot('home-screen', shot, { maxDiffRatio: 0.02 });
```

Defaults are env-overridable:

- `VISUAL_PIXEL_THRESHOLD` — per-pixel color sensitivity (0 strict … 1 loose, default `0.1`)
- `VISUAL_MAX_DIFF_RATIO` — max fraction of differing pixels (default `0.01` = 1%)

Baselines are PNGs in `e2e/fixtures/baselines/`, with per-snapshot tolerances in
`e2e/fixtures/visual-baselines.json`. Record/update them intentionally:

```bash
UPDATE_VISUAL_BASELINE=true npm run e2e:visual:update-ios
```

When a comparison fails, a diff image is written to `artifacts/visual-diffs/`.

## Flaky detection and the zero-flaky gate

- Failed tests auto-retry up to `E2E_RETRIES` (default 2) via `jest.retryTimes`.
- `e2e/helpers/flakyReporter.js` records any test that only passed **after** a
  retry into `artifacts/flaky-report.json`.
- With `E2E_FAIL_ON_FLAKY=true` (used by `npm run e2e:stability-*`) the build
  fails if any flake is detected.
- The `stability` CI job (`workflow_dispatch`) runs the suite **5 consecutive
  times** with the flaky gate on, enforcing "zero flaky failures across 5 runs".

## Checklist for a new test

- [ ] Launches via `launchCleanApp` / `launchSeededApp` (no raw `device.launchApp`).
- [ ] Uses `helpers/waits.ts`; contains no `sleep`/fixed timers.
- [ ] Any network dependency is covered by a mock scenario.
- [ ] Visual assertions pass a sensible `maxDiffRatio`, never an exact hash.
- [ ] Fixtures use fixed IDs and absolute dates.
