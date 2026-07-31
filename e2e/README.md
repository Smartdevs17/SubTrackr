# SubTrackr E2E Suite

## Coverage

### Core tests (pre-existing)
- Subscription creation flow
- Subscription charging simulation flow
- Subscription cancellation flow
- Subscription plan change flow
- Visual regression snapshots (home + detail screens)

### Full lifecycle suite — Issue #440
- **Subscription creation**: monthly, yearly, weekly; validation errors for blank name and zero price
- **Payment processing**: successful charge, failed charge, alternating success/failure
- **Plan change with proration**: billing cycle verification for all three cycle types
- **Cancellation and win-back**: full 3-step flow (reason → retention offers → confirm), offer decline, subscription removal
- **Dunning / recovery**: multi-failure escalation, recovery after dunning, full dunning cycle
- **Multi-currency**: EUR, GBP, JPY, CAD subscriptions; mixed-currency home screen

## Test files

| File | Description |
|------|-------------|
| `launch.test.ts` | App launch smoke test |
| `subscription.test.ts` | Basic create / cancel / plan-change |
| `payment.test.ts` | Charge simulation (success + failure) |
| `subscription-lifecycle.test.ts` | Comprehensive lifecycle suite (Issue #440) |
| `visual-regression.test.ts` | SHA-256 hash-based visual snapshots |

## Parallel execution

```bash
# iOS
npm run e2e:test-ios:parallel

# Android
npm run e2e:test-android:parallel
```

## Running a specific suite

```bash
# Full lifecycle suite only
npm run e2e:test-ios -- --testPathPattern="subscription-lifecycle\\.test"

# All tests
npm run e2e:test-ios
```

## Visual baselines

Visual hashes are stored in `e2e/fixtures/visual-baselines.json`.

- Run in strict comparison mode (default): screenshots are compared to stored hashes.
- Update baselines intentionally:

```bash
UPDATE_VISUAL_BASELINE=true npm run e2e:test-ios -- --testNamePattern "Subscription Visual Regression"
```

## Flakiness mitigation

- Every test starts with `launchCleanApp()` which deletes app data and relaunches fresh.
- `waitFor(...).withTimeout(...)` guards are used throughout instead of fixed delays.
- `dismissAnySystemAlert()` handles OS permission prompts that may appear mid-test.
- The CI workflow retries the lifecycle suite once on failure to handle simulator/emulator cold-start issues.
- Blockchain-dependent flows use local simulation buttons — no live network calls required in CI.

## Test data cleanup

Each test calls `device.launchApp({ newInstance: true, delete: true })` in `beforeEach`, which wipes
AsyncStorage and resets all Zustand stores to their initial state. This ensures full isolation between
test cases without requiring manual teardown.
