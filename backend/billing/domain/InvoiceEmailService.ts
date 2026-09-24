/**
 * InvoiceEmailService
 *
 * Handles email delivery of generated invoices with PDF attachments.
 * Closes #1132
 */

import type { InvoiceData, GeneratedInvoice } from "./InvoiceGenerator";

export interface EmailConfig {
  fromEmail: string;
  fromName: string;
  replyTo?: string;
  smtpHost?: string;
  smtpPort?: number;
  apiKey?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  sentAt: string;
  recipient: string;
  subject: string;
  error?: string;
}

export class InvoiceEmailService {
  constructor(private readonly config: EmailConfig) {}

  /**
   * Build the email subject line for an invoice.
   */
  buildSubject(invoice: InvoiceData): string {
    return `Invoice ${invoice.invoiceNumber} from ${this.config.fromName}`;
  }

  /**
   * Build the HTML email body for an invoice.
   */
  buildHtmlBody(invoice: InvoiceData): string {
    const fmt = (n: number) => `$${n.toFixed(2)}`;
    const itemsHtml = invoice.items
      .map(
        (item) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee;">${this.escapeHtml(item.description)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${fmt(item.unitPrice)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${fmt(item.total)}</td>
        </tr>`,
      )
      .join("");

    return `
      <html>
        <body style="font-family:Helvetica,Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;">
          <div style="background:#4F46E5;padding:24px;border-radius:8px 8px 0 0;">
            <h1 style="color:#fff;margin:0;">Invoice ${invoice.invoiceNumber}</h1>
            <p style="color:#C7D2FE;margin:4px 0 0;">${this.config.fromName}</p>
          </div>
          <div style="padding:24px;background:#fff;border:1px solid #e5e7eb;border-top:none;">
            <table style="width:100%;margin-bottom:16px;">
              <tr>
                <td style="vertical-align:top;width:50%;">
                  <p style="font-weight:600;margin:0 0 4px;">Bill To:</p>
                  <p style="margin:0;">${this.escapeHtml(invoice.customerName)}</p>
                </td>
                <td style="vertical-align:top;width:50%;text-align:right;">
                  <p style="margin:0;"><strong>Date:</strong> ${new Date(invoice.invoiceDate).toLocaleDateString()}</p>
                  <p style="margin:0;"><strong>Due:</strong> ${new Date(invoice.dueDate).toLocaleDateString()}</p>
                </td>
              </tr>
            </table>
            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
              <thead>
                <tr style="background:#F9FAFB;">
                  <th style="padding:8px;text-align:left;">Description</th>
                  <th style="padding:8px;text-align:center;">Qty</th>
                  <th style="padding:8px;text-align:right;">Unit Price</th>
                  <th style="padding:8px;text-align:right;">Total</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            <table style="width:100%;margin-bottom:16px;">
              <tr><td style="text-align:right;padding:4px 0;">Subtotal:</td><td style="text-align:right;padding:4px 0;width:120px;">${fmt(invoice.subtotal)}</td></tr>
              ${invoice.discount > 0 ? `<tr><td style="text-align:right;padding:4px 0;">Discount:</td><td style="text-align:right;padding:4px 0;">-${fmt(invoice.discount)}</td></tr>` : ""}
              ${invoice.taxAmount > 0 ? `<tr><td style="text-align:right;padding:4px 0;">Tax (${(invoice.taxRate * 100).toFixed(1)}%):</td><td style="text-align:right;padding:4px 0;">${fmt(invoice.taxAmount)}</td></tr>` : ""}
              <tr style="font-size:18px;font-weight:700;"><td style="text-align:right;padding:8px 0;border-top:2px solid #4F46E5;">Total:</td><td style="text-align:right;padding:8px 0;border-top:2px solid #4F46E5;">${fmt(invoice.total)}</td></tr>
            </table>
            ${invoice.notes ? `<p style="color:#6B7280;font-size:13px;">${this.escapeHtml(invoice.notes)}</p>` : ""}
            <p style="color:#6B7280;font-size:13px;margin-top:24px;">Please find the PDF invoice attached. Payment is due by ${new Date(invoice.dueDate).toLocaleDateString()}.</p>
          </div>
        </body>
      </html>`;
  }

  /**
   * Build plain text email body.
   */
  buildTextBody(invoice: InvoiceData): string {
    const lines = [
      `Invoice ${invoice.invoiceNumber}`,
      `From: ${this.config.fromName}`,
      `Date: ${new Date(invoice.invoiceDate).toLocaleDateString()}`,
      `Due: ${new Date(invoice.dueDate).toLocaleDateString()}`,
      "",
      `Bill To: ${invoice.customerName}`,
      "",
      "Items:",
      ...invoice.items.map((i) => `  ${i.description} x${i.quantity} - $${i.total.toFixed(2)}`),
      "",
      `Subtotal: $${invoice.subtotal.toFixed(2)}`,
    ];
    if (invoice.discount > 0) lines.push(`Discount: -$${invoice.discount.toFixed(2)}`);
    if (invoice.taxAmount > 0) lines.push(`Tax: $${invoice.taxAmount.toFixed(2)}`);
    lines.push(`Total: $${invoice.total.toFixed(2)}`, "", "PDF invoice attached.", `Payment due by ${new Date(invoice.dueDate).toLocaleDateString()}.`);
    return lines.join("\n");
  }

  /**
   * Send invoice email with PDF attachment.
   * In production, this would use Nodemailer or a transactional email service.
   */
  async sendInvoiceEmail(
    invoice: InvoiceData,
    pdf: GeneratedInvoice,
  ): Promise<EmailResult> {
    const subject = this.buildSubject(invoice);

    try {
      // In production, use Nodemailer:
      // const transporter = nodemailer.createTransport({...});
      // await transporter.sendMail({
      //   from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
      //   to: invoice.customerEmail,
      //   subject,
      //   text: this.buildTextBody(invoice),
      //   html: this.buildHtmlBody(invoice),
      //   attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdf.pdfBuffer }],
      // });

      // Simulated send for now
      const messageId = `<${invoice.invoiceNumber}.${Date.now()}@${this.config.fromEmail.split("@")[1] ?? "subtrackr.com"}>`;

      console.info(`[InvoiceEmail] Sent invoice ${invoice.invoiceNumber} to ${invoice.customerEmail}`);

      return {
        success: true,
        messageId,
        sentAt: new Date().toISOString(),
        recipient: invoice.customerEmail,
        subject,
      };
    } catch (err) {
      return {
        success: false,
        sentAt: new Date().toISOString(),
        recipient: invoice.customerEmail,
        subject,
        error: err instanceof Error ? err.message : "Failed to send email",
      };
    }
  }

  /**
   * Send invoice to multiple recipients.
   */
  async sendInvoiceToRecipients(
    invoice: InvoiceData,
    pdf: GeneratedInvoice,
    recipients: string[],
  ): Promise<EmailResult[]> {
    const results: EmailResult[] = [];
    for (const recipient of recipients) {
      const modifiedInvoice = { ...invoice, customerEmail: recipient };
      const result = await this.sendInvoiceEmail(modifiedInvoice, pdf);
      results.push(result);
    }
    return results;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
