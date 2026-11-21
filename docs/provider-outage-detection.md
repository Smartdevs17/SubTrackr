# Provider outage detection and status banner

Issue #2035 separates two questions that used to be conflated:

1. **What did a provider last tell us?** — the webhook-driven cache in
   `backend/services/providerStatus.ts`.
2. **Are we actually seeing an outage now?** — `backend/src/services/providerStatus.ts`.

A single failed charge is noise. The new monitor requires a pattern before it
changes status:

- three consecutive failures (configurable) → `outage`;
- a rolling failure rate over a five-minute window with at least three samples
  → `degraded`;
- two consecutive successes and a low failure rate → recovery;
- webhook `maintenance`/`degraded` signals mark a provider `degraded` without
  consuming outcome samples.

Transitions are debounced, emit structured logs and metrics, and notify
subscribers with both the previous and current snapshot. A throwing subscriber
is ignored so it cannot break detection.

## Embedding the monitor

```ts
import { createProviderOutageMonitor } from './src/services/providerStatus';

const monitor = createProviderOutageMonitor({
  providers: ['stripe', 'paypal', 'paddle', 'stellar'],
  failureThreshold: 3,
  recoveryThreshold: 2,
  metrics: prometheusAdapter,
});

await gateway.charge(request).then(
  () => monitor.recordSuccess('stripe'),
  (error) => monitor.recordFailure('stripe', error.code),
);
```

`monitor.subscribe(listener)` is the hook for WebSocket/SSE fan-out. The
framework-agnostic `createProviderStatusHandler(monitor)` exposes
`getSnapshot` and `getProvider` for Express/Fastify routes; an unknown provider
returns HTTP 404.

## Mobile surface

`mobile/src/components/StatusBanner.tsx` renders a snapshot as an accessible
alert. It returns `null` when everything is operational, lists affected
providers for degraded/outage states, localises all copy through
`mobile/src/i18n/resources.ts`, and mirrors the row in RTL locales. `onRetry`
and `onDismiss` are supplied by the parent screen.

```tsx
<StatusBanner
  snapshot={snapshot}
  locale={savedLocale}
  onRetry={() => monitor.refresh()}
  onDismiss={() => setDismissed(true)}
/>
```
