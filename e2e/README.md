# SubTrackr E2E Suite

## Coverage

- Subscription creation flow
- Subscription charging simulation flow
- Subscription cancellation flow
- Subscription plan change flow
- Visual regression snapshots (home + detail screens)

## Parallel execution

- iOS: `npm run e2e:test-ios:parallel`
- Android: `npm run e2e:test-android:parallel`

## Visual baselines

Visual hashes are stored in `e2e/fixtures/visual-baselines.json`.

- Run in strict comparison mode (default): screenshots are compared to stored hashes.
- Update baselines intentionally:

```bash
UPDATE_VISUAL_BASELINE=true npm run e2e:test-ios -- --testNamePattern "Subscription Visual Regression"
```
