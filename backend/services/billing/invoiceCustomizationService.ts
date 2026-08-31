/**
 * Per-tenant invoice rendering.
 *
 * One deployment issues invoices on behalf of many merchants, so an invoice's
 * appearance is a property of its *tenant*, not of the platform. This module
 * turns an invoice plus a resolved branding profile into a document, and
 * delivers it.
 *
 * Rendering is deterministic and side-effect free: the same invoice and
 * branding always produce byte-identical markup. That is what makes the output
 * snapshot-testable, cacheable, and safe to re-render when a dispute needs the
 * exact document a payer saw.
 *
 * Every branding value is attacker-controlled — a tenant types it into a form —
 * so all of it is escaped or scheme-checked before it reaches the markup.
 */

import type {
  Invoice,
  InvoiceBranding,
  InvoiceLineItem,
  InvoiceTemplate,
  ResolvedInvoiceBranding,
} from '../../../src/types/invoice';
import { useInvoiceStore } from '../../../src/store/invoiceStore';

/** Applied wherever a tenant has not supplied its own value. */
export const FALLBACK_BRANDING: Required<
  Pick<InvoiceBranding, 'primaryColor' | 'secondaryColor' | 'accentColor' | 'textColor' | 'fontFamily'>
> = {
  primaryColor: '#1a73e8',
  secondaryColor: '#f1f3f4',
  accentColor: '#188038',
  textColor: '#202124',
  fontFamily: 'Helvetica, Arial, sans-serif',
};

const MIN_LOGO_WIDTH = 24;
const MAX_LOGO_WIDTH = 320;
const DEFAULT_LOGO_WIDTH = 140;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface RenderedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  templateId: string;
  layout: InvoiceTemplate['layout'];
  /** Self-contained HTML — the input to the PDF pipeline. */
  html: string;
  /** Plain-text alternative for the email body. */
  text: string;
  branding: InvoiceBranding;
  tenantId?: string;
}

export interface DeliveryResult {
  delivered: boolean;
  invoiceId: string;
  recipientEmail?: string;
  documentUrl?: string;
  error?: string;
}

/**
 * Escapes text for HTML. Applied to every interpolated value without
 * exception — a tenant's own display name included.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Passes through only colours that are safe to drop into a style attribute. */
function safeColor(value: string | undefined, fallback: string): string {
  return value && HEX_COLOR.test(value) ? value : fallback;
}

/**
 * Only http(s) and inline image data URLs may be embedded. Anything else — most
 * importantly `javascript:` — is dropped, and the invoice renders without a logo.
 */
function safeImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value) ? value : null;
}

function safeLinkUrl(value: string | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

function clampLogoWidth(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LOGO_WIDTH;
  return Math.min(Math.max(value as number, MIN_LOGO_WIDTH), MAX_LOGO_WIDTH);
}

/**
 * A font stack reaches the document as a CSS value, so quotes and semicolons
 * would let a tenant close the declaration and inject their own.
 */
function safeFontFamily(value: string | undefined): string {
  if (!value) return FALLBACK_BRANDING.fontFamily;
  const cleaned = value.replace(/[^a-zA-Z0-9 ,\-]/g, '').trim();
  return cleaned.length > 0 ? cleaned : FALLBACK_BRANDING.fontFamily;
}

function formatMoney(amount: number, currency: string): string {
  const normalized = Number.isFinite(amount) ? amount : 0;
  return `${normalized.toFixed(2)} ${currency}`;
}

function formatDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
}

/** Fills every unset branding field so downstream rendering never branches. */
export function normalizeBranding(branding: InvoiceBranding | undefined): InvoiceBranding {
  const source = branding ?? {};
  return {
    ...source,
    primaryColor: safeColor(source.primaryColor, FALLBACK_BRANDING.primaryColor),
    secondaryColor: safeColor(source.secondaryColor, FALLBACK_BRANDING.secondaryColor),
    accentColor: safeColor(source.accentColor, FALLBACK_BRANDING.accentColor),
    textColor: safeColor(source.textColor, FALLBACK_BRANDING.textColor),
    fontFamily: safeFontFamily(source.fontFamily),
    logoUrl: safeImageUrl(source.logoUrl) ?? undefined,
    logoWidth: clampLogoWidth(source.logoWidth),
    websiteUrl: safeLinkUrl(source.websiteUrl) ?? undefined,
  };
}

function renderLineItems(items: InvoiceLineItem[], currency: string, branding: InvoiceBranding): string {
  if (items.length === 0) {
    return '<tr><td colspan="3" class="empty">No line items</td></tr>';
  }
  return items
    .map((item) => {
      const amount = formatMoney(Number(item.lineTotal ?? 0), currency);
      const quantity = item.quantity ?? 1;
      return [
        '<tr>',
        `<td>${escapeHtml(item.description ?? 'Item')}</td>`,
        `<td class="num">${escapeHtml(quantity)}</td>`,
        `<td class="num" style="color:${branding.textColor}">${escapeHtml(amount)}</td>`,
        '</tr>',
      ].join('');
    })
    .join('');
}

/**
 * Layout-specific chrome. The three layouts differ only in how prominent the
 * brand colour is, so they share one document skeleton.
 */
function layoutStyles(layout: InvoiceTemplate['layout'], branding: InvoiceBranding): string {
  switch (layout) {
    case 'modern':
      return `header{background:${branding.primaryColor};color:#fff;padding:32px}` +
        `h1{margin:0;font-size:28px;letter-spacing:-0.5px}` +
        `th{background:${branding.secondaryColor}}`;
    case 'minimalist':
      return `header{padding:24px 0;border-bottom:1px solid ${branding.secondaryColor}}` +
        `h1{margin:0;font-size:20px;font-weight:500;color:${branding.textColor}}` +
        `th{background:transparent;border-bottom:1px solid ${branding.secondaryColor}}`;
    case 'standard':
    default:
      return `header{padding:24px 0;border-bottom:3px solid ${branding.primaryColor}}` +
        `h1{margin:0;font-size:24px;color:${branding.primaryColor}}` +
        `th{background:${branding.secondaryColor}}`;
  }
}

export class InvoiceCustomizationService {
  /**
   * Renders an invoice under a tenant's branding.
   *
   * When `resolved` is omitted the branding is looked up from the invoice's
   * own `tenantId`, so a caller holding only an invoice still gets the right
   * brand.
   */
  static renderInvoice(
    invoice: Invoice,
    resolved?: ResolvedInvoiceBranding
  ): RenderedInvoice {
    const store = useInvoiceStore.getState();
    const effective = resolved ?? store.resolveBranding(invoice.tenantId);
    // An explicit per-invoice override outranks the tenant profile: it is what
    // was in force when the invoice was issued.
    const branding = normalizeBranding(invoice.branding ?? effective.branding);
    const templateId = invoice.templateId ?? effective.templateId;
    const template = store.templates.find((t) => t.id === templateId);
    const layout = template?.layout ?? 'standard';

    const currency = invoice.currency ?? 'USD';
    const issuer = effective.displayName ?? invoice.merchantName;
    const logoUrl = safeImageUrl(branding.logoUrl);
    const websiteUrl = safeLinkUrl(branding.websiteUrl);

    const logo = logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(issuer)}" width="${branding.logoWidth}" />`
      : '';

    const footerParts: string[] = [];
    if (branding.footerText) footerParts.push(escapeHtml(branding.footerText));
    if (branding.supportEmail) {
      footerParts.push(
        `<a href="mailto:${escapeHtml(branding.supportEmail)}">${escapeHtml(branding.supportEmail)}</a>`
      );
    }
    if (websiteUrl) {
      footerParts.push(`<a href="${escapeHtml(websiteUrl)}">${escapeHtml(websiteUrl)}</a>`);
    }

    const html = [
      '<!doctype html><html><head><meta charset="utf-8" />',
      `<title>${escapeHtml(invoice.invoiceNumber)}</title>`,
      '<style>',
      `body{font-family:${branding.fontFamily};color:${branding.textColor};margin:0;padding:32px}`,
      layoutStyles(layout, branding),
      'table{width:100%;border-collapse:collapse;margin-top:24px}',
      'th,td{padding:8px 12px;text-align:left}',
      '.num{text-align:right}',
      '.empty{color:#5f6368;font-style:italic}',
      `.total{font-weight:700;color:${branding.accentColor}}`,
      'footer{margin-top:32px;font-size:12px;color:#5f6368}',
      '</style></head><body>',
      `<header>${logo}<h1>${escapeHtml(issuer)}</h1>`,
      `<p>Invoice ${escapeHtml(invoice.invoiceNumber)} · issued ${escapeHtml(formatDate(invoice.createdAt))}</p>`,
      '</header>',
      '<section>',
      `<p>Subscription: ${escapeHtml(invoice.subscriptionName)}</p>`,
      `<p>Period: ${escapeHtml(formatDate(invoice.period.start))} → ${escapeHtml(formatDate(invoice.period.end))}</p>`,
      `<p>Due: ${escapeHtml(formatDate(invoice.dueDate))}</p>`,
      '</section>',
      '<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>',
      `<tbody>${renderLineItems(invoice.lineItems ?? [], currency, branding)}</tbody>`,
      '<tfoot>',
      `<tr><td colspan="2" class="num">Subtotal</td><td class="num">${escapeHtml(formatMoney(invoice.subtotal, currency))}</td></tr>`,
      `<tr><td colspan="2" class="num">Tax</td><td class="num">${escapeHtml(formatMoney(invoice.tax, currency))}</td></tr>`,
      `<tr><td colspan="2" class="num total">Total</td><td class="num total">${escapeHtml(formatMoney(invoice.total, currency))}</td></tr>`,
      '</tfoot></table>',
      footerParts.length > 0 ? `<footer>${footerParts.join(' · ')}</footer>` : '',
      '</body></html>',
    ].join('');

    const text = [
      `${issuer}`,
      `Invoice ${invoice.invoiceNumber}`,
      `Subscription: ${invoice.subscriptionName}`,
      `Period: ${formatDate(invoice.period.start)} - ${formatDate(invoice.period.end)}`,
      `Due: ${formatDate(invoice.dueDate)}`,
      '',
      ...(invoice.lineItems ?? []).map(
        (item) =>
          `- ${item.description ?? 'Item'} x${item.quantity ?? 1}: ${formatMoney(Number(item.lineTotal ?? 0), currency)}`
      ),
      '',
      `Subtotal: ${formatMoney(invoice.subtotal, currency)}`,
      `Tax: ${formatMoney(invoice.tax, currency)}`,
      `Total: ${formatMoney(invoice.total, currency)}`,
      branding.footerText ? `\n${branding.footerText}` : '',
    ]
      .join('\n')
      .trim();

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      templateId,
      layout,
      html,
      text,
      branding,
      tenantId: invoice.tenantId,
    };
  }

  /**
   * Produces the branded document and returns its storage URL.
   *
   * The PDF conversion itself is a deployment concern (pdfkit, puppeteer, a
   * hosted renderer); what belongs here is the branded HTML that goes into it.
   */
  static async generateInvoicePdf(
    invoice: Invoice,
    resolved?: ResolvedInvoiceBranding
  ): Promise<{ url: string; rendered: RenderedInvoice }> {
    const rendered = this.renderInvoice(invoice, resolved);
    return {
      url: `https://cdn.subtrackr.app/invoices/${encodeURIComponent(invoice.id)}.pdf`,
      rendered,
    };
  }

  /** Renders a tenant's branding against a sample invoice for the settings preview. */
  static previewForTenant(tenantId: string, sample: Invoice): RenderedInvoice {
    const resolved = useInvoiceStore.getState().resolveBranding(tenantId);
    // Ignore any branding frozen onto the sample so the preview reflects the
    // profile as it stands right now.
    return this.renderInvoice({ ...sample, branding: undefined, tenantId }, resolved);
  }

  /** Renders the branded document and marks the invoice sent. */
  static async deliverInvoice(invoiceId: string, recipientEmail: string): Promise<DeliveryResult> {
    try {
      const store = useInvoiceStore.getState();
      const invoice = store.invoices.find((i) => i.id === invoiceId);

      if (!invoice) {
        return { delivered: false, invoiceId, error: 'Invoice not found' };
      }

      const { url } = await this.generateInvoicePdf(invoice);
      await store.sendInvoice(invoiceId, recipientEmail);

      return { delivered: true, invoiceId, recipientEmail, documentUrl: url };
    } catch (error) {
      return {
        delivered: false,
        invoiceId,
        recipientEmail,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
