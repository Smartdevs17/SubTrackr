import { previewJobId, validatePreviewPayload } from './keys';
import {
  INVOICE_PREVIEW_JOB_NAME,
  type InvoicePreviewJobPayload,
  type PreviewEnqueueOptions,
  type PreviewJobHandle,
  type PreviewQueue,
} from './types';

/** Enqueue a preview job with a stable idempotency key. */
export async function enqueueInvoicePreview(
  queue: PreviewQueue,
  payload: InvoicePreviewJobPayload,
  options: PreviewEnqueueOptions = {}
): Promise<PreviewJobHandle | void> {
  validatePreviewPayload(payload);
  return queue.add(
    INVOICE_PREVIEW_JOB_NAME,
    { ...payload, attempt: options.attempt ?? payload.attempt ?? 0 },
    {
      jobId: options.jobId ?? previewJobId(payload),
      delay: options.delay,
    }
  );
}
