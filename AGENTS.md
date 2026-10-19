# SubTrackr Development Commands

## Lint and Type Check

```bash
npm run lint          # ESLint for TypeScript files
npm run lint:fix      # ESLint with --fix
npm run typecheck     # TypeScript type checking
npm run format        # Format code with Prettier
npm run format:check  # Check formatting
```

`npm run typecheck` currently reports a large number of **pre-existing** errors
(624 as of `d509da8`). Compare against a clean tree (`git stash`) before
assuming a new error is yours.

## Testing

```bash
npm run test           # Frontend/React Native tests (see Known Issues)
npm run test:backend   # Backend tests
npm run test:shard     # One CI shard; honours $SHARD/$SHARD_COUNT
npm run test:coverage  # Run tests with coverage
npm run performance:ci # Check performance budget
```

### Known Issues

**The React Native test suite cannot run.** `jest-expo@53` resolves
`require('react-native/jest-preset')`, but the pinned `react-native@0.87.1` no
longer ships that file and does not expose the subpath via its `exports` map, so
every run fails during config resolution with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
Fixing it requires realigning `expo` / `jest-expo` / `react-native` (they are
currently mutually inconsistent), not a config tweak.

Pure-TypeScript frontend modules can still be exercised with the backend
config, which uses `ts-jest` and does not need the broken preset:

```bash
npx jest --config jest.backend.config.js --testMatch '**/src/store/__tests__/fraudStore.test.ts'
```

## Backend Testing

`jest.backend.config.js` only matches tests under
`backend/**/__tests__/**` and `backend/{tests,billing/tests}/**`. Test files in
other backend directories (for example `backend/graphql/tests/`) are **not**
picked up by any config and silently never run.

## Mutation Testing

```bash
npm run mutation:test         # Stryker score for critical frontend paths (>= 80%)
npm run mutation:test:backend # Stryker score for critical backend paths (>= 80%)
npm run mutation:test:all     # Both configurations
npm run mutation:report       # Summarise the reports; fails if one is missing
```

See `docs/mutation-testing.md`.

## Commands that need no `node_modules`

These are plain Node scripts and run in a bare checkout, which makes them the
fastest smoke test available:

```bash
node scripts/db-schema-drift.js
node scripts/validate-autoscaling.js
node scripts/anonymize-test-data.js --check
node scripts/queue-backoff-tune.js --input config/queue-snapshot.sample.json
node scripts/db-migrate-dryrun.js --migrations-dir backend/migrations
node scripts/check-mutation-score.js --allow-missing
node bin/subtrackr.js --help
```

`npm run ops:check` chains several of these.

## Commit Hooks

Husky hooks are installed by `prepare` and run `lint-staged` and `commitlint`
locally, matching what CI enforces. Bypass with `git commit --no-verify`.

## Build

```bash
npm run build:android # Android release build
npm run android      # Run on Android
npm run android:device # Run on Android device
```

## Performance Budget Thresholds (Android)

- Render time: 250ms (p95)
- API latency: 1200ms (p95)
- Memory usage: 262MB
- Startup time: 2000ms (target: <2s)
- Frame rate: 60fps (target for mid-range devices)
