# Invoice preview pre-render worker

`workers/invoicePreview/` moves branded invoice-preview rendering off the request
path and onto a background worker. Jobs are idempotent, previews are cached with
a TTL, and rendering is single-flight per cache key.

## Usage

```ts
import {
  createBackendPreviewRenderer,
  enqueueInvoicePreview,
  InvoicePreviewWorker,
  InMemoryPreviewQueue,
} from '../../workers/invoicePreview';

const queue = new InMemoryPreviewQueue();
const worker = new InvoicePreviewWorker({
  renderer: createBackendPreviewRenderer(),
  queue,
  pollIntervalMs: 5_000,
  ttlMs: 15 * 60 * 1000,
  onEvent: (event) => logger.debug('invoice preview', event),
});

worker.start();

// From the invoice write path:
await enqueueInvoicePreview(queue, {
  invoiceId: invoice.id,
  tenantId: invoice.tenantId,
  templateId: invoice.templateId,
  contentVersion: String(invoice.updatedAt.getTime()),
  reason: 'invoice-updated',
});
```

`backendRenderer.ts` lazily loads the existing, sanitized
`InvoiceCustomizationService` and zustand invoice store, so no second rendering
implementation is introduced. Tests inject a `PreviewRenderer` instead.

Any queue satisfying the structural `PreviewQueue` interface works; the repo's
priority queues already match `add(name, data, { jobId, delay })` / `dequeue()`.
`InMemoryPreviewQueue` is the standalone default.

## Behaviour

- **Idempotency** — the job id is derived from invoice, version, tenant and
  template. Re-enqueueing the same preview replaces the pending job instead of
  duplicating work.
- **Cache** — successful renders are stored with `renderedAt`/`expiresAt`. Hits
  skip rendering entirely; concurrent misses for the same key share one render.
- **Invalidation** — jobs whose `reason` is `invoice-updated`, `branding-updated`
  or `manual` invalidate cached entries for that invoice (and tenant, when
  supplied) before rendering.
- **Retries** — retryable failures are re-enqueued with capped exponential
  backoff (default `1s`, `2s`, `4s`, … capped at `30s`) up to three attempts.
  Terminal failures invoke `onDeadLetter`.
- **Shutdown** — `stop()` clears the polling timer; `tick()` is safe to call
  concurrently because overlapping ticks are skipped.

## Observability

- `onEvent` receives one `PreviewEvent` for every cache hit, render, dedupe,
  retry or terminal failure, including attempt count and duration.
- `onMetrics` receives a snapshot after each event and each tick.
  `getMetrics()` returns counters for ticks, dequeued jobs, renders, cache hits,
  dedupes, retries, dead letters, failures and in-flight renders.
- All failure and result paths log structured metadata through the injected
  `PreviewLogger`.

## Testing

This directory is intentionally outside the default Jest/tsconfig roots. Run
its tests with the backend config and an explicit match:

```bash
npx jest --config jest.backend.config.js \
  --testMatch '**/workers/invoicePreview/__tests__/**/*.test.ts' --runInBand
```

The suite covers cache expiry/eviction/invalidation, queue idempotency and
delays, render/cache-hit/single-flight paths, invalidation reasons, retry and
dead-letter handling, non-retryable and invalid payloads, and start/stop.
