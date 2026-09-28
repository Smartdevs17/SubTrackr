# SubTrackr Development Commands

## Lint and Type Check

```bash
npm run lint          # ESLint for TypeScript files
npm run typecheck     # TypeScript type checking
npm run format      # Format code with Prettier
npm run format:check # Check formatting
```

## Testing

```bash
npm run test          # Run Jest tests
npm run test:coverage # Run tests with coverage
npm run performance:ci # Check performance budget
```

## Mutation Testing

```bash
npm run mutation:test         # Stryker score for critical frontend paths (>= 80%)
npm run mutation:test:backend # Stryker score for critical backend paths (>= 80%)
npm run mutation:test:all     # Both configurations
```

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
