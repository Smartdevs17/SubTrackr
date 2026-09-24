/**
 * InvoiceGenerator
 *
 * Generates PDF invoices for subscription payments.
 * Uses a lightweight PDF template engine that produces valid PDF 1.4 output.
 *
 * Closes #1132
 */

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
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
  discount: number;
  total: number;
  currency: string;

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
   */
  calculateTotals(items: InvoiceLineItem[], taxRate: number, discount: number = 0) {
    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const taxableAmount = subtotal - discount;
    const taxAmount = Math.round(taxableAmount * taxRate * 100) / 100;
    const total = Math.round((taxableAmount + taxAmount) * 100) / 100;
    return { subtotal, taxAmount, total };
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
    discount?: number;
    currency?: string;
    subscriptionId?: string;
    notes?: string;
    dueInDays?: number;
  }): InvoiceData {
    const taxRate = params.taxRate ?? 0;
    const discount = params.discount ?? 0;
    const currency = params.currency ?? "USD";
    const now = new Date();
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + (params.dueInDays ?? 30));

    const { subtotal, taxAmount, total } = this.calculateTotals(params.items, taxRate, discount);

    return {
      invoiceNumber: this.generateInvoiceNumber(),
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
      discount,
      total,
      currency,
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
    const fmt = (n: number) => `${invoice.currency === "USD" ? "$" : ""}${n.toFixed(2)}`;

    content.push(`BT`);
    content.push(`/F1 24 Tf`);
    content.push(`72 720 Td`);
    content.push(`(INVOICE) Tj`);
    content.push(`/F1 12 Tf`);
    content.push(`0 -30 Td`);
    content.push(`(${this.escapePdfString(`Invoice #: ${invoice.invoiceNumber}`)}) Tj`);
    content.push(`0 -18 Td`);
    content.push(`(${this.escapePdfString(`Date: ${new Date(invoice.invoiceDate).toLocaleDateString()}`)}) Tj`);
    content.push(`0 -18 Td`);
    content.push(`(${this.escapePdfString(`Due: ${new Date(invoice.dueDate).toLocaleDateString()}`)}) Tj`);
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
      content.push(`0 -16 Td`);
      content.push(`(${this.escapePdfString(`  ${item.description}  x${item.quantity}  ${fmt(item.total)}`)}) Tj`);
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
      content.push(`(${this.escapePdfString(`Tax (${(invoice.taxRate * 100).toFixed(1)}%): ${fmt(invoice.taxAmount)}`)}) Tj`);
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
}
