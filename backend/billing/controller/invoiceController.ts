/**
 * Invoice Controller
 *
 * REST endpoints for invoice generation and email delivery.
 * Closes #1132
 */

import type { Pool } from "../../shared/db/connectionPool";
import { InvoiceGenerator, type InvoiceData, type GeneratedInvoice } from "../domain/InvoiceGenerator";
import { InvoiceEmailService, type EmailConfig, type EmailResult } from "../domain/InvoiceEmailService";

export interface InvoiceControllerDeps {
  pool: Pool;
  emailConfig?: EmailConfig;
}

export function createInvoiceController(deps: InvoiceControllerDeps) {
  const generator = new InvoiceGenerator();
  const emailService = new InvoiceEmailService(
    deps.emailConfig ?? {
      fromEmail: process.env.INVOICE_FROM_EMAIL ?? "billing@subtrackr.com",
      fromName: process.env.INVOICE_FROM_NAME ?? "SubTrackr Billing",
    },
  );

  return {
    /**
     * POST /invoices/generate
     * Generate an invoice and return it as PDF (base64).
     */
    async generateInvoice(
      body: {
        customerName: string;
        customerEmail: string;
        items: Array<{ description: string; quantity: number; unitPrice: number }>;
        taxRate?: number;
        discount?: number;
        currency?: string;
        subscriptionId?: string;
        notes?: string;
        dueInDays?: number;
      },
    ): Promise<{ success: boolean; data?: { invoice: InvoiceData; pdfBase64: string; fileSize: number }; status?: number; error?: string }> {
      try {
        if (!body.customerName || !body.customerEmail) {
          return { success: false, status: 400, error: "customerName and customerEmail are required" };
        }
        if (!body.items || body.items.length === 0) {
          return { success: false, status: 400, error: "at least one item is required" };
        }

        const items = body.items.map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: Math.round(i.quantity * i.unitPrice * 100) / 100,
        }));

        const invoice = generator.createInvoice({
          senderName: deps.emailConfig?.fromName ?? "SubTrackr",
          senderEmail: deps.emailConfig?.fromEmail ?? "billing@subtrackr.com",
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          items,
          taxRate: body.taxRate,
          discount: body.discount,
          currency: body.currency,
          subscriptionId: body.subscriptionId,
          notes: body.notes,
          dueInDays: body.dueInDays,
        });

        const generated = generator.generatePdf(invoice);

        // Persist to database
        await deps.pool.query(
          `INSERT INTO invoices
           (invoice_number, customer_name, customer_email, status, subtotal,
            tax_rate, tax_amount, discount, total, currency, pdf_base64,
            subscription_id, notes, invoice_date, due_date, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            invoice.invoiceNumber, invoice.customerName, invoice.customerEmail,
            invoice.status, invoice.subtotal, invoice.taxRate, invoice.taxAmount,
            invoice.discount, invoice.total, invoice.currency, generated.pdfBase64,
            invoice.subscriptionId ?? null, invoice.notes ?? null,
            invoice.invoiceDate, invoice.dueDate, new Date().toISOString(),
          ],
        );

        return {
          success: true,
          data: { invoice, pdfBase64: generated.pdfBase64, fileSize: generated.fileSize },
        };
      } catch (err) {
        console.error("[Invoice] Error generating invoice:", err);
        return { success: false, status: 500, error: "Failed to generate invoice" };
      }
    },

    /**
     * POST /invoices/:invoiceNumber/email
     * Send an invoice via email with PDF attachment.
     */
    async emailInvoice(
      invoiceNumber: string,
    ): Promise<{ success: boolean; data?: EmailResult; status?: number; error?: string }> {
      try {
        const result = await deps.pool.query(
          `SELECT * FROM invoices WHERE invoice_number = $1`,
          [invoiceNumber],
        );
        if (result.rows.length === 0) {
          return { success: false, status: 404, error: "Invoice not found" };
        }

        const row = result.rows[0];
        const invoice: InvoiceData = {
          invoiceNumber: row.invoice_number,
          invoiceDate: row.invoice_date,
          dueDate: row.due_date,
          status: row.status,
          senderName: "SubTrackr",
          senderEmail: "billing@subtrackr.com",
          customerName: row.customer_name,
          customerEmail: row.customer_email,
          items: [],
          subtotal: parseFloat(row.subtotal),
          taxRate: parseFloat(row.tax_rate),
          taxAmount: parseFloat(row.tax_amount),
          discount: parseFloat(row.discount),
          total: parseFloat(row.total),
          currency: row.currency,
        };

        const generated: GeneratedInvoice = {
          invoice,
          pdfBase64: row.pdf_base64,
          pdfBuffer: Buffer.from(row.pdf_base64, "base64"),
          fileSize: row.pdf_base64.length,
          generatedAt: row.created_at,
        };

        const emailResult = await emailService.sendInvoiceEmail(invoice, generated);

        if (emailResult.success) {
          await deps.pool.query(
            `UPDATE invoices SET status = 'sent', updated_at = NOW() WHERE invoice_number = $1`,
            [invoiceNumber],
          );
        }

        return { success: true, data: emailResult };
      } catch (err) {
        console.error("[Invoice] Error emailing invoice:", err);
        return { success: false, status: 500, error: "Failed to send invoice email" };
      }
    },

    /**
     * GET /invoices/:invoiceNumber
     * Retrieve an invoice by number.
     */
    async getInvoice(
      invoiceNumber: string,
    ): Promise<{ success: boolean; data?: Record<string, unknown>; status?: number; error?: string }> {
      try {
        const result = await deps.pool.query(
          `SELECT invoice_number, customer_name, customer_email, status, subtotal,
                  tax_amount, discount, total, currency, invoice_date, due_date
           FROM invoices WHERE invoice_number = $1`,
          [invoiceNumber],
        );
        if (result.rows.length === 0) {
          return { success: false, status: 404, error: "Invoice not found" };
        }
        return { success: true, data: result.rows[0] };
      } catch (err) {
        return { success: false, status: 500, error: "Failed to fetch invoice" };
      }
    },

    /**
     * GET /invoices
     * List invoices with optional filters.
     */
    async listInvoices(
      filters: { customerEmail?: string; status?: string; limit?: number },
    ): Promise<{ success: boolean; data?: Record<string, unknown>[]; status?: number; error?: string }> {
      try {
        const limit = Math.min(filters.limit ?? 50, 100);
        let query = `SELECT invoice_number, customer_name, customer_email, status, total, currency, invoice_date, due_date FROM invoices`;
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        if (filters.customerEmail) {
          conditions.push(`customer_email = $${paramIdx++}`);
          params.push(filters.customerEmail);
        }
        if (filters.status) {
          conditions.push(`status = $${paramIdx++}`);
          params.push(filters.status);
        }

        if (conditions.length > 0) query += ` WHERE ${conditions.join(" AND ")}`;
        query += ` ORDER BY created_at DESC LIMIT $${paramIdx}`;
        params.push(limit);

        const result = await deps.pool.query(query, params);
        return { success: true, data: result.rows };
      } catch (err) {
        return { success: false, status: 500, error: "Failed to list invoices" };
      }
    },
  };
}

export type InvoiceController = ReturnType<typeof createInvoiceController>;
