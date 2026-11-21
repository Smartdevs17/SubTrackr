import { InvoicePreviewError, type InvoicePreviewJobPayload } from './types';

export function validatePreviewPayload(payload: InvoicePreviewJobPayload | undefined): void {
  if (!payload || typeof payload.invoiceId !== 'string' || payload.invoiceId.trim() === '') {
    throw new InvoicePreviewError('invoiceId is required', 'INVALID_PAYLOAD', false);
  }
}

/** Idempotency key reused for enqueue, de-duplication and retries. */
export function previewJobId(payload: InvoicePreviewJobPayload): string {
  const version = payload.contentVersion ?? 'latest';
  return `invoice-preview:${payload.invoiceId}:${version}:${payload.tenantId ?? '*'}:${payload.templateId ?? '*'}`;
}

/** Cache key intentionally excludes `reason` and `attempt`: output is identical. */
export function previewCacheKey(payload: InvoicePreviewJobPayload): string {
  return previewJobId(payload);
}
