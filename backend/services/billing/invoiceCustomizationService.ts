import { Invoice, InvoiceBranding } from '../../../src/types/invoice';
import { useInvoiceStore } from '../../../src/store/invoiceStore';
import { presentLocalNotification } from '../../../src/services/notificationService';

export class InvoiceCustomizationService {
  /**
   * Simulates generating a PDF with per-tenant branding applied.
   */
  static async generateInvoicePdf(invoice: Invoice, branding?: InvoiceBranding): Promise<string> {
    const configBranding = branding || invoice.branding || useInvoiceStore.getState().config.defaultBranding;
    const templateId = invoice.templateId || 'tpl-1';

    // In a real implementation, we would use pdfkit, puppeteer, or a service like PDFMonkey here.
    // For now, we simulate generation.
    console.log(`Generating PDF for ${invoice.invoiceNumber}...`);
    console.log(`Applying Template ID: ${templateId}`);
    if (configBranding) {
      console.log(`Applying Branding: Logo=${configBranding.logoUrl}, PrimaryColor=${configBranding.primaryColor}, Font=${configBranding.fontFamily}`);
    }

    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 800));

    const simulatedPdfUrl = `https://cdn.subtrackr.app/invoices/${invoice.id}.pdf`;
    return simulatedPdfUrl;
  }

  /**
   * Automates the delivery of an invoice via email and pushes a notification.
   */
  static async deliverInvoice(invoiceId: string, recipientEmail: string): Promise<boolean> {
    try {
      const store = useInvoiceStore.getState();
      const invoice = store.invoices.find(i => i.id === invoiceId);
      
      if (!invoice) throw new Error('Invoice not found');

      // Generate the branded PDF
      const pdfUrl = await this.generateInvoicePdf(invoice);

      console.log(`Sending email to ${recipientEmail} with attachment ${pdfUrl}...`);
      
      // Update the invoice status
      await store.sendInvoice(invoiceId, recipientEmail);

      return true;
    } catch (e) {
      console.error('Automated invoice delivery failed:', e);
      return false;
    }
  }
}
