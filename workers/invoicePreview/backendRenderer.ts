import {
  InvoicePreviewError,
  type InvoicePreviewRenderResult,
  type PreviewRenderer,
} from './types';

/**
 * Production renderer backed by the existing, sanitized invoice renderer.
 * Imports are dynamic so unit tests (and non-Node bundles) can use the worker
 * without loading the zustand-backed invoice store.
 */
export function createBackendPreviewRenderer(): PreviewRenderer {
  return {
    async render(payload): Promise<InvoicePreviewRenderResult> {
      const [{ InvoiceCustomizationService }, { useInvoiceStore }] = await Promise.all([
        import('../../backend/services/billing/invoiceCustomizationService'),
        import('../../src/store/invoiceStore'),
      ]);

      const store = useInvoiceStore.getState();
      const invoice = store.invoices.find((candidate) => candidate.id === payload.invoiceId);
      if (!invoice) {
        throw new InvoicePreviewError(
          `Invoice ${payload.invoiceId} not found`,
          'INVOICE_NOT_FOUND',
          false
        );
      }

      const rendered = InvoiceCustomizationService.renderInvoice(invoice);
      const timestamp =
        invoice.updatedAt?.getTime?.() ??
        invoice.createdAt?.getTime?.() ??
        new Date(invoice.createdAt).getTime();
      const version =
        payload.contentVersion ?? (Number.isFinite(timestamp) ? String(timestamp) : 'latest');

      return {
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        templateId: rendered.templateId,
        version,
        html: rendered.html,
        text: rendered.text,
      };
    },
  };
}
