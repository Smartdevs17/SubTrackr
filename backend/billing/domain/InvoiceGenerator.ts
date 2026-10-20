/**
 * InvoiceGenerator
 *
 * Generates PDF invoices for subscription payments.
 * Uses a lightweight PDF template engine that produces valid PDF 1.4 output.
 *
 * Closes #1132
 */

import { formatDate, formatMoney } from './formatting';

export interface InvoiceBranding {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /**
   * Discriminates a chargeable line (`'item'`, the default) from an itemised
   * discount (`'discount'`). Discount line items reduce the subtotal instead of
   * adding to it. This is deliberately distinct from coupons, which are a
   * checkout-time promotion concept.
   */
  kind?: "item" | "discount";
}

/** A line item that reduces the amount payable rather than adding to it. */
function isDiscountLineItem(item: InvoiceLineItem): boolean {
  return item.kind === "discount";
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";

  // From
  senderName: string;
  senderEmail: string;
  senderAddress?: string;

  // To
  customerName: string;
  customerEmail: string;
  customerAddress?: string;

  // Line items
  items: InvoiceLineItem[];

  // Totals
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  /** Region the tax was calculated for, e.g. "DE" or "US-CA". */
  taxRegion?: string;
  /** Tax type applied, e.g. "vat", "gst", "sales_tax". */
  taxType?: string;
  discount: number;
  total: number;
  currency: string;
  locale: string;
  branding: InvoiceBranding;

  // Metadata
  subscriptionId?: string;
  notes?: string;
}

export interface GeneratedInvoice {
  invoice: InvoiceData;
  pdfBase64: string;
  pdfBuffer: Buffer;
  fileSize: number;
  generatedAt: string;
}

/** Rounds to minor units, mapping non-finite input to zero. */
function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON * Math.sign(amount)) * 100) / 100;
}

/**
 * Human-readable tax label for invoice documents, e.g. "VAT 19.0% · DE".
 */
export function formatTaxLabel(invoice: Pick<InvoiceData, 'taxRate' | 'taxRegion' | 'taxType'>): string {
  const rate = `${(invoice.taxRate * 100).toFixed(1)}%`;
  if (!invoice.taxType && !invoice.taxRegion) return rate;
  const type = invoice.taxType ? invoice.taxType.toUpperCase() : 'Tax';
  const region = invoice.taxRegion ? ` · ${invoice.taxRegion.toUpperCase()}` : '';
  return `${type} ${rate}${region}`;
}

/** Constrains `value` to `[min, max]`, tolerating non-finite input. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export class InvoiceGenerator {
  /**
   * Generate a unique invoice number.
   */
  generateInvoiceNumber(): string {
    const year = new Date().getFullYear();
    const timestamp = Date.now().toString(36).toUpperCase().slice(-6);
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `INV-${year}-${timestamp}${random}`;
  }

  /**
   * Calculate totals from line items and tax rate.
   *
   * Discount line items (and the legacy scalar `discount`) are applied to the
   * subtotal before tax. The returned `discount` is the total reduction so the
   * rendered invoice can show it even when it arrived itemised.
   */
  calculateTotals(items: InvoiceLineItem[], taxRate: number, discount: number = 0) {
    const chargeItems = items.filter((item) => !isDiscountLineItem(item));
    const discountItems = items.filter((item) => isDiscountLineItem(item));

    const rawSubtotal = chargeItems.reduce((sum, item) => sum + item.total, 0);
    const subtotal = roundMoney(rawSubtotal);

    const lineDiscount = roundMoney(
      discountItems.reduce((sum, item) => sum + Math.abs(item.total), 0)
    );

    // A discount may not exceed the subtotal. Without this clamp a discount
    // larger than the invoice produced a negative tax base and a negative
    // total, which downstream reconciliation reads as a credit owed rather
    // than an over-discounted invoice.
    const appliedDiscount = roundMoney(clamp(discount + lineDiscount, 0, subtotal));
    const taxableAmount = roundMoney(subtotal - appliedDiscount);

    // `taxRate` is a decimal fraction (0.2), not basis points.
    const safeTaxRate = Number.isFinite(taxRate) ? Math.max(taxRate, 0) : 0;
    const taxAmount = roundMoney(taxableAmount * safeTaxRate);
    const total = roundMoney(Math.max(taxableAmount + taxAmount, 0));

    return { subtotal, discount: appliedDiscount, taxAmount, total };
  }

  /**
   * Create invoice data from raw parameters.
   */
  createInvoice(params: {
    senderName: string;
    senderEmail: string;
    customerName: string;
    customerEmail: string;
    items: InvoiceLineItem[];
    taxRate?: number;
    taxRegion?: string;
    taxType?: string;
    discount?: number;
    currency?: string;
    subscriptionId?: string;
    notes?: string;
    dueInDays?: number;
    locale?: string;
    branding?: InvoiceBranding;
    senderAddress?: string;
    customerAddress?: string;
    /** Pre-allocated number from a numbering scheme (issue #1738); defaults to the legacy generator. */
    invoiceNumber?: string;
  }): InvoiceData {
    const taxRate = params.taxRate ?? 0;
    const discount = params.discount ?? 0;
    const currency = (params.currency ?? "USD").toUpperCase();
    const locale = params.locale ?? "en-US";
    const now = new Date();
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + (params.dueInDays ?? 30));

    const { subtotal, discount: appliedDiscount, taxAmount, total } = this.calculateTotals(
      params.items,
      taxRate,
      discount
    );

    return {
      invoiceNumber: params.invoiceNumber ?? this.generateInvoiceNumber(),
      invoiceDate: now.toISOString(),
      dueDate: dueDate.toISOString(),
      status: "draft",
      senderName: params.senderName,
      senderEmail: params.senderEmail,
      senderAddress: params.senderAddress,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerAddress: params.customerAddress,
      items: params.items,
      subtotal: Math.round(subtotal * 100) / 100,
      taxRate,
      taxAmount,
      taxRegion: params.taxRegion,
      taxType: params.taxType,
      discount,
      total,
      currency,
      locale,
      branding: { ...params.branding },
      subscriptionId: params.subscriptionId,
      notes: params.notes,
    };
  }

  /**
   * Generate a PDF from invoice data.
   * Produces a minimal valid PDF 1.4 document.
   */
  generatePdf(invoice: InvoiceData): GeneratedInvoice {
    const pdfContent = this.buildPdfString(invoice);
    const pdfBuffer = Buffer.from(pdfContent, "latin1");
    const pdfBase64 = pdfBuffer.toString("base64");

    return {
      invoice,
      pdfBase64,
      pdfBuffer,
      fileSize: pdfBuffer.length,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Build a minimal PDF document string.
   */
  private buildPdfString(invoice: InvoiceData): string {
    const lines: string[] = [];
    const content: string[] = [];

    // Build text content
    const fmt = (n: number) => formatMoney(n, invoice.currency, invoice.locale);
    const primaryColor = this.pdfColor(invoice.branding.primaryColor ?? '#4F46E5');

    content.push(`BT`);
    content.push(`/F1 24 Tf`);
    content.push(`72 720 Td`);
    content.push(`${primaryColor} rg`);
    content.push(`(INVOICE) Tj`);
    content.push(`0 0 0 rg`);
    if (invoice.branding.logoUrl) {
      content.push(`0 -18 Td`);
      content.push(`(${this.escapePdfString(`Logo: ${invoice.branding.logoUrl}`)}) Tj`);
    }
    content.push(`/F1 12 Tf`);
    content.push(`0 -30 Td`);
    content.push(`(${this.escapePdfString(`Invoice #: ${invoice.invoiceNumber}`)}) Tj`);
    content.push(`0 -18 Td`);
    content.push(`(${this.escapePdfString(`Date: ${formatDate(invoice.invoiceDate, invoice.locale)}`)}) Tj`);
    content.push(`0 -18 Td`);
    content.push(`(${this.escapePdfString(`Due: ${formatDate(invoice.dueDate, invoice.locale)}`)}) Tj`);
    content.push(`0 -18 Td`);
    content.push(`(${this.escapePdfString(`Status: ${invoice.status}`)}) Tj`);

    // Sender
    content.push(`0 -30 Td`);
    content.push(`(${this.escapePdfString(`From: ${invoice.senderName}`)}) Tj`);
    content.push(`0 -18 Td`);
    content.push(`(${this.escapePdfString(`  ${invoice.senderEmail}`)}) Tj`);

    // Customer
    content.push(`0 -30 Td`);
    content.push(`(${this.escapePdfString(`To: ${invoice.customerName}`)}) Tj`);
    content.push(`0 -18 Td`);
    content.push(`(${this.escapePdfString(`  ${invoice.customerEmail}`)}) Tj`);

    // Items header
    content.push(`0 -30 Td`);
    content.push(`(${this.escapePdfString(`Items:`)}) Tj`);

    for (const item of invoice.items) {
      const isDiscount = isDiscountLineItem(item);
      const amount = isDiscount ? `-${fmt(Math.abs(item.total))}` : fmt(item.total);
      content.push(`0 -16 Td`);
      content.push(`(${this.escapePdfString(`  ${item.description}  x${item.quantity}  ${amount}`)}) Tj`);
    }

    // Totals
    content.push(`0 -24 Td`);
    content.push(`(${this.escapePdfString(`Subtotal: ${fmt(invoice.subtotal)}`)}) Tj`);
    if (invoice.discount > 0) {
      content.push(`0 -16 Td`);
      content.push(`(${this.escapePdfString(`Discount: -${fmt(invoice.discount)}`)}) Tj`);
    }
    if (invoice.taxAmount > 0) {
      content.push(`0 -16 Td`);
      content.push(`(${this.escapePdfString(`Tax (${formatTaxLabel(invoice)}): ${fmt(invoice.taxAmount)}`)}) Tj`);
    }
    content.push(`0 -20 Td`);
    content.push(`/F1 14 Tf`);
    content.push(`(${this.escapePdfString(`Total: ${fmt(invoice.total)}`)}) Tj`);
    content.push(`ET`);

    const contentStr = content.join("\n");
    const contentLength = contentStr.length;

    // PDF structure
    let offset = 0;
    lines.push("%PDF-1.4");
    offset += lines[0].length + 1;

    // Object 1: Catalog
    lines.push(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`);
    const obj1Offset = offset;
    offset += lines[1].length + 1;

    // Object 2: Pages
    lines.push(`2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`);
    const obj2Offset = offset;
    offset += lines[2].length + 1;

    // Object 3: Page
    lines.push(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj`);
    const obj3Offset = offset;
    offset += lines[3].length + 1;

    // Object 4: Content stream
    lines.push(`4 0 obj << /Length ${contentLength} >> stream`);
    lines.push(contentStr);
    lines.push("endstream endobj");
    const obj4Offset = offset;
    offset += lines.slice(4).join("\n").length + 1;

    // Object 5: Font
    lines.push(`5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);
    const obj5Offset = offset;
    offset += lines[5].length + 1;

    // Cross-reference table
    const xrefOffset = offset;
    lines.push("xref");
    lines.push("0 6");
    lines.push("0000000000 65535 f ");
    lines.push(`${String(obj1Offset).padStart(10, "0")} 00000 n `);
    lines.push(`${String(obj2Offset).padStart(10, "0")} 00000 n `);
    lines.push(`${String(obj3Offset).padStart(10, "0")} 00000 n `);
    lines.push(`${String(obj4Offset).padStart(10, "0")} 00000 n `);
    lines.push(`${String(obj5Offset).padStart(10, "0")} 00000 n `);

    // Trailer
    lines.push("trailer << /Size 6 /Root 1 0 R >>");
    lines.push("startxref");
    lines.push(String(xrefOffset));
    lines.push("%%EOF");

    return lines.join("\n");
  }

  /**
   * Escape special characters for PDF strings.
   */
  private escapePdfString(str: string): string {
    return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  private pdfColor(hex: string): string {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!match) return '0.31 0.27 0.90';
    const value = match[1];
    return `${parseInt(value.slice(0, 2), 16) / 255} ${parseInt(value.slice(2, 4), 16) / 255} ${parseInt(value.slice(4), 16) / 255}`;
  }
}
