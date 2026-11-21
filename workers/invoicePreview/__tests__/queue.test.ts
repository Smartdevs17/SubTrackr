import { enqueueInvoicePreview } from '../enqueue';
import { InvoicePreviewError, type InvoicePreviewJobPayload } from '../types';
import { InMemoryPreviewQueue } from '../queue';

const payload = (overrides: Partial<InvoicePreviewJobPayload> = {}): InvoicePreviewJobPayload => ({
  invoiceId: 'inv-1',
  tenantId: 'tenant-1',
  contentVersion: 'v1',
  ...overrides,
});

describe('InMemoryPreviewQueue', () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
  });

  it('deduplicates jobs by idempotency key and keeps the latest payload', async () => {
    const queue = new InMemoryPreviewQueue(() => now);
    await enqueueInvoicePreview(queue, payload(), { jobId: 'same-job' });
    await enqueueInvoicePreview(queue, payload({ contentVersion: 'v2' }), { jobId: 'same-job' });

    expect(queue.stats().depth).toBe(1);
    const job = await queue.dequeue();
    expect(job?.data.contentVersion).toBe('v2');
    expect(queue.stats().depth).toBe(0);
  });

  it('uses the payload-derived idempotency key by default', async () => {
    const queue = new InMemoryPreviewQueue(() => now);
    await enqueueInvoicePreview(queue, payload());
    await enqueueInvoicePreview(queue, payload());
    expect(queue.stats().depth).toBe(1);
  });

  it('defers delayed jobs until their run time', async () => {
    const queue = new InMemoryPreviewQueue(() => now);
    await queue.add('invoice:prerender-preview', payload(), { jobId: 'delayed', delay: 100 });

    expect(await queue.dequeue()).toBeUndefined();
    now += 100;
    expect((await queue.dequeue())?.id).toBe('delayed');
  });

  it('rejects payloads without an invoice id', async () => {
    const queue = new InMemoryPreviewQueue(() => now);
    await expect(enqueueInvoicePreview(queue, { invoiceId: '' })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD',
      retryable: false,
    });
    expect(queue.stats().depth).toBe(0);
    expect(new InvoicePreviewError('x').retryable).toBe(true);
  });
});
