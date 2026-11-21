import { InMemoryPreviewCache } from '../cache';
import { enqueueInvoicePreview } from '../enqueue';
import { previewCacheKey } from '../keys';
import { InMemoryPreviewQueue } from '../queue';
import {
  InvoicePreviewWorker,
  previewRetryDelay,
  type InvoicePreviewWorkerOptions,
} from '../worker';
import {
  InvoicePreviewError,
  type CachedInvoicePreview,
  type InvoicePreviewJobPayload,
  type InvoicePreviewRenderResult,
  type PreviewEvent,
  type PreviewWorkerMetrics,
} from '../types';

const payload = (overrides: Partial<InvoicePreviewJobPayload> = {}): InvoicePreviewJobPayload => ({
  invoiceId: 'inv-1',
  tenantId: 'tenant-1',
  templateId: 'tpl-1',
  contentVersion: 'v1',
  ...overrides,
});

const rendered = (
  overrides: Partial<InvoicePreviewRenderResult> = {}
): InvoicePreviewRenderResult => ({
  invoiceId: 'inv-1',
  tenantId: 'tenant-1',
  templateId: 'tpl-1',
  version: 'v1',
  html: '<html>fresh</html>',
  text: 'fresh',
  ...overrides,
});

describe('InvoicePreviewWorker', () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
  });

  function setup(overrides: Partial<InvoicePreviewWorkerOptions> = {}) {
    const renderer = { render: jest.fn(async () => rendered()) };
    const queue = new InMemoryPreviewQueue(() => now);
    const cache = new InMemoryPreviewCache({ now: () => now });
    const events: PreviewEvent[] = [];
    const metrics: PreviewWorkerMetrics[] = [];
    const onDeadLetter = jest.fn();
    const logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const worker = new InvoicePreviewWorker({
      renderer,
      queue,
      cache,
      logger,
      now: () => now,
      ttlMs: 1_000,
      retryBaseMs: 10,
      retryMaxMs: 100,
      onEvent: (event) => events.push(event),
      onMetrics: (snapshot) => metrics.push(snapshot),
      onDeadLetter,
      ...overrides,
    });

    return { worker, renderer, queue, cache, events, metrics, onDeadLetter, logger };
  }

  it('renders a queued preview, caches it and emits an event', async () => {
    const { worker, renderer, queue, cache, events, metrics } = setup();
    await enqueueInvoicePreview(queue, payload());

    await worker.tick();

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(cache.get(previewCacheKey(payload()))?.html).toBe('<html>fresh</html>');
    expect(events.map((event) => event.type)).toEqual(['rendered']);
    expect(metrics[metrics.length - 1]).toMatchObject({ rendered: 1, jobsDequeued: 1 });
  });

  it('serves later jobs for the same key from cache', async () => {
    const { worker, renderer, queue, events } = setup();
    await enqueueInvoicePreview(queue, payload(), { jobId: 'job-1' });
    await enqueueInvoicePreview(queue, payload(), { jobId: 'job-2' });

    await worker.tick();

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['rendered', 'cache-hit']);
  });

  it('single-flights concurrent renders for the same cache key', async () => {
    const { worker, renderer, events } = setup();

    await Promise.all([worker.process({ data: payload() }), worker.process({ data: payload() })]);

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type).sort()).toEqual(['deduplicated', 'rendered']);
    expect(worker.getMetrics().inFlight).toBe(0);
  });

  it('invalidates stale cache entries for update reasons before rendering', async () => {
    const { worker, renderer, cache } = setup();
    const invalidate = jest.spyOn(cache, 'invalidate');
    const key = previewCacheKey(payload());
    const stale: CachedInvoicePreview = {
      ...rendered({ html: '<html>stale</html>' }),
      key,
      renderedAt: now,
      expiresAt: now + 1_000,
    };
    cache.set(key, stale);

    await enqueueInvoicePreview(worker['queue'], payload({ reason: 'invoice-updated' }));
    await worker.tick();

    expect(invalidate).toHaveBeenCalledWith('inv-1');
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(cache.get(key)?.html).toBe('<html>fresh</html>');
  });

  it('retries transient render failures with capped backoff', async () => {
    const renderer = {
      render: jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValueOnce(rendered()),
    };
    const { worker, queue, events } = setup({ renderer });
    await enqueueInvoicePreview(queue, payload());

    await worker.tick();
    expect(events.map((event) => event.type)).toEqual(['retry-scheduled']);
    expect(queue.stats().depth).toBe(1);

    now += 10;
    await worker.tick();

    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.render.mock.calls[1][0]).toMatchObject({ attempt: 1 });
    expect(events.map((event) => event.type)).toEqual(['retry-scheduled', 'rendered']);
    expect(queue.stats().depth).toBe(0);
  });

  it('dead-letters after the configured number of attempts', async () => {
    const error = new Error('renderer still down');
    const renderer = { render: jest.fn().mockRejectedValue(error) };
    const { worker, queue, events, onDeadLetter } = setup({ renderer, maxAttempts: 2 });
    await enqueueInvoicePreview(queue, payload());

    await worker.tick();
    now += 10;
    await worker.tick();

    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(queue.stats().depth).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['retry-scheduled', 'dead-letter']);
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(worker.getMetrics().deadLettered).toBe(1);
  });

  it('does not retry non-retryable renderer errors', async () => {
    const error = new InvoicePreviewError('Invoice inv-1 not found', 'INVOICE_NOT_FOUND', false);
    const renderer = { render: jest.fn().mockRejectedValue(error) };
    const { worker, queue, events, onDeadLetter } = setup({ renderer });
    await enqueueInvoicePreview(queue, payload());

    await worker.tick();

    expect(queue.stats().depth).toBe(0);
    expect(events.map((event) => event.type)).toEqual(['dead-letter']);
    expect(onDeadLetter).toHaveBeenCalledWith(expect.objectContaining(payload()), error);
  });

  it('quarantines invalid payloads without calling the renderer', async () => {
    const { worker, renderer, queue, events } = setup();
    await queue.add('invoice:prerender-preview', { invoiceId: '' });

    await worker.tick();

    expect(renderer.render).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['invalid-payload']);
    expect(queue.stats().depth).toBe(0);
  });

  it('starts polling immediately and stops cleanly', async () => {
    const { worker, renderer, queue } = setup();
    await enqueueInvoicePreview(queue, payload());

    worker.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    worker.stop();

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(queue.stats().depth).toBe(0);
  });

  it('caps exponential retry delays', () => {
    expect(previewRetryDelay(1, 100, 250)).toBe(100);
    expect(previewRetryDelay(2, 100, 250)).toBe(200);
    expect(previewRetryDelay(3, 100, 250)).toBe(250);
  });
});
