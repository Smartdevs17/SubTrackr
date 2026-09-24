/**
 * Tests for InvoiceGenerator and InvoiceEmailService
 * Closes #1132
 */

import { InvoiceGenerator, type InvoiceLineItem } from "../domain/InvoiceGenerator";
import { InvoiceEmailService } from "../domain/InvoiceEmailService";

describe("InvoiceGenerator", () => {
  const generator = new InvoiceGenerator();

  const items: InvoiceLineItem[] = [
    { description: "Pro Plan Monthly", quantity: 1, unitPrice: 49.99, total: 49.99 },
    { description: "Extra Seat", quantity: 2, unitPrice: 10.0, total: 20.0 },
  ];

  describe("generateInvoiceNumber", () => {
    it("generates a unique invoice number", () => {
      const num1 = generator.generateInvoiceNumber();
      const num2 = generator.generateInvoiceNumber();
      expect(num1).toMatch(/^INV-\d{4}-/);
      expect(num1).not.toBe(num2);
    });
  });

  describe("calculateTotals", () => {
    it("calculates subtotal, tax, and total", () => {
      const { subtotal, taxAmount, total } = generator.calculateTotals(items, 0.08);
      expect(subtotal).toBe(69.99);
      expect(taxAmount).toBe(5.6);
      expect(total).toBe(75.59);
    });

    it("applies discount before tax", () => {
      const { subtotal, taxAmount, total } = generator.calculateTotals(items, 0.1, 10);
      expect(subtotal).toBe(69.99);
      expect(taxAmount).toBe(6.0); // (69.99 - 10) * 0.1 = 5.999 -> 6
      expect(total).toBe(65.99); // 59.99 + 6
    });

    it("handles zero tax", () => {
      const { taxAmount, total } = generator.calculateTotals(items, 0);
      expect(taxAmount).toBe(0);
      expect(total).toBe(69.99);
    });
  });

  describe("createInvoice", () => {
    it("creates a complete invoice", () => {
      const invoice = generator.createInvoice({
        senderName: "SubTrackr",
        senderEmail: "billing@subtrackr.com",
        customerName: "John Doe",
        customerEmail: "john@example.com",
        items,
        taxRate: 0.08,
      });

      expect(invoice.invoiceNumber).toMatch(/^INV-/);
      expect(invoice.status).toBe("draft");
      expect(invoice.customerName).toBe("John Doe");
      expect(invoice.items).toHaveLength(2);
      expect(invoice.subtotal).toBe(69.99);
      expect(invoice.total).toBeGreaterThan(invoice.subtotal);
    });

    it("sets due date 30 days out by default", () => {
      const invoice = generator.createInvoice({
        senderName: "SubTrackr",
        senderEmail: "billing@subtrackr.com",
        customerName: "Jane",
        customerEmail: "jane@example.com",
        items,
      });
      const dueDate = new Date(invoice.dueDate);
      const invoiceDate = new Date(invoice.invoiceDate);
      const diffDays = (dueDate.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(29);
      expect(diffDays).toBeLessThanOrEqual(31);
    });
  });

  describe("generatePdf", () => {
    it("generates a valid PDF buffer", () => {
      const invoice = generator.createInvoice({
        senderName: "SubTrackr",
        senderEmail: "billing@subtrackr.com",
        customerName: "John Doe",
        customerEmail: "john@example.com",
        items,
      });
      const generated = generator.generatePdf(invoice);

      expect(generated.pdfBuffer).toBeInstanceOf(Buffer);
      expect(generated.fileSize).toBeGreaterThan(0);
      expect(generated.pdfBase64).toBeTruthy();
      // PDF header check
      const pdfHeader = generated.pdfBuffer.toString("latin1").slice(0, 8);
      expect(pdfHeader).toBe("%PDF-1.4");
    });
  });
});

describe("InvoiceEmailService", () => {
  const emailService = new InvoiceEmailService({
    fromEmail: "billing@subtrackr.com",
    fromName: "SubTrackr",
  });

  const generator = new InvoiceGenerator();
  const invoice = generator.createInvoice({
    senderName: "SubTrackr",
    senderEmail: "billing@subtrackr.com",
    customerName: "John Doe",
    customerEmail: "john@example.com",
    items: [{ description: "Pro Plan", quantity: 1, unitPrice: 49.99, total: 49.99 }],
  });

  describe("buildSubject", () => {
    it("includes invoice number and sender name", () => {
      const subject = emailService.buildSubject(invoice);
      expect(subject).toContain(invoice.invoiceNumber);
      expect(subject).toContain("SubTrackr");
    });
  });

  describe("buildHtmlBody", () => {
    it("generates HTML with invoice details", () => {
      const html = emailService.buildHtmlBody(invoice);
      expect(html).toContain("<html>");
      expect(html).toContain(invoice.invoiceNumber);
      expect(html).toContain(invoice.customerName);
      expect(html).toContain("Pro Plan");
    });
  });

  describe("buildTextBody", () => {
    it("generates plain text with invoice details", () => {
      const text = emailService.buildTextBody(invoice);
      expect(text).toContain(invoice.invoiceNumber);
      expect(text).toContain("Pro Plan");
      expect(text).toContain("Total:");
    });
  });

  describe("sendInvoiceEmail", () => {
    it("sends email and returns success", async () => {
      const generated = generator.generatePdf(invoice);
      const result = await emailService.sendInvoiceEmail(invoice, generated);
      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();
      expect(result.recipient).toBe("john@example.com");
    });
  });
});
