import type {
  InvoicePreviewJobPayload,
  PreviewEnqueueOptions,
  PreviewJobHandle,
  PreviewQueue,
} from './types';

interface InMemoryJob<T> extends PreviewJobHandle<T> {
  id: string;
  name: string;
  enqueuedAt: number;
  runAt: number;
}

/**
 * Standalone queue used when no external priority queue is supplied. Jobs with
 * the same idempotency key are replaced, so repeated enqueues cannot duplicate
 * a preview render.
 */
export class InMemoryPreviewQueue implements PreviewQueue<InvoicePreviewJobPayload> {
  private readonly jobs: InMemoryJob<InvoicePreviewJobPayload>[] = [];
  private sequence = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async add(
    name: string,
    data: InvoicePreviewJobPayload,
    options: PreviewEnqueueOptions = {}
  ): Promise<PreviewJobHandle<InvoicePreviewJobPayload>> {
    const now = this.now();
    const id = options.jobId ?? `${name}-${(this.sequence += 1)}-${now}`;
    const job: InMemoryJob<InvoicePreviewJobPayload> = {
      id,
      name,
      data,
      enqueuedAt: now,
      runAt: now + Math.max(0, options.delay ?? 0),
    };

    const existing = this.jobs.findIndex((candidate) => candidate.id === id);
    if (existing >= 0) this.jobs[existing] = job;
    else this.jobs.push(job);
    return job;
  }

  async dequeue(): Promise<PreviewJobHandle<InvoicePreviewJobPayload> | undefined> {
    const now = this.now();
    const index = this.jobs.findIndex((job) => job.runAt <= now);
    if (index < 0) return undefined;
    const [job] = this.jobs.splice(index, 1);
    return { id: job.id, data: job.data };
  }

  stats(): { depth: number; ids: string[] } {
    return { depth: this.jobs.length, ids: this.jobs.map((job) => job.id) };
  }
}
