import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Invoice,
  InvoiceBranding,
  InvoiceTemplate,
  InvoiceAnalytics,
  InvoicePreview,
  InvoiceFormData,
  PDFGenerationOptions,
  InvoiceFilters,
  InvoiceStatus,
  InvoiceLineItem,
} from '../types/invoice';
import { InvoiceLayout } from '../types/invoice';

const STORAGE_KEYS = {
  INVOICES: '@SubTrackr:invoices',
  BRANDING: '@SubTrackr:invoiceBranding',
  TEMPLATES: '@SubTrackr:invoiceTemplates',
} as const;

// Branding Management
export async function saveBranding(branding: Omit<InvoiceBranding, 'id' | 'createdAt' | 'updatedAt'>): Promise<InvoiceBranding> {
  const existing = await getBranding();
  const now = new Date();
  
  const newBranding: InvoiceBranding = {
    ...branding,
    id: existing?.id || generateId(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await AsyncStorage.setItem(STORAGE_KEYS.BRANDING, JSON.stringify(newBranding));
  return newBranding;
}

export async function getBranding(): Promise<InvoiceBranding | null> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.BRANDING);
    if (!data) return null;
    const branding = JSON.parse(data);
    return {
      ...branding,
      createdAt: new Date(branding.createdAt),
      updatedAt: new Date(branding.updatedAt),
    };
  } catch (error) {
    console.error('Failed to load invoice branding:', error);
    return null;
  }
}

export async function deleteBranding(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.BRANDING);
}

// Template Management
export async function createTemplate(template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<InvoiceTemplate> {
  const templates = await getAllTemplates();
  const now = new Date();
  
  const newTemplate: InvoiceTemplate = {
    ...template,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };

  // If this is set as default, unset others
  if (newTemplate.isDefault) {
    templates.forEach(t => t.isDefault = false);
  }

  templates.push(newTemplate);
  await AsyncStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
  return newTemplate;
}

export async function updateTemplate(id: string, updates: Partial<InvoiceTemplate>): Promise<InvoiceTemplate> {
  const templates = await getAllTemplates();
  const index = templates.findIndex(t => t.id === id);
  
  if (index === -1) {
    throw new Error(`Template with id ${id} not found`);
  }

  const updatedTemplate: InvoiceTemplate = {
    ...templates[index],
    ...updates,
    updatedAt: new Date(),
  };

  // If this is set as default, unset others
  if (updatedTemplate.isDefault) {
    templates.forEach((t, i) => {
      if (i !== index) t.isDefault = false;
    });
  }

  templates[index] = updatedTemplate;
  await AsyncStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
  return updatedTemplate;
}

export async function deleteTemplate(id: string): Promise<void> {
  const templates = await getAllTemplates();
  const filtered = templates.filter(t => t.id !== id);
  await AsyncStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(filtered));
}

export async function getAllTemplates(): Promise<InvoiceTemplate[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.TEMPLATES);
    if (!data) return getDefaultTemplates();
    const templates = JSON.parse(data);
    return templates.map((t: any) => ({
      ...t,
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
    }));
  } catch (error) {
    console.error('Failed to load invoice templates:', error);
    return getDefaultTemplates();
  }
}

export async function getTemplateById(id: string): Promise<InvoiceTemplate | null> {
  const templates = await getAllTemplates();
  return templates.find(t => t.id === id) || null;
}

export async function getDefaultTemplate(): Promise<InvoiceTemplate> {
  const templates = await getAllTemplates();
  return templates.find(t => t.isDefault) || templates[0];
}

// Invoice Management
export async function createInvoice(data: InvoiceFormData): Promise<Invoice> {
  const invoices = await getAllInvoices();
  const now = new Date();
  
  const lineTotal = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
  const totalAmount = lineTotal + (data.taxAmount || 0) - (data.discountAmount || 0);

  const newInvoice: Invoice = {
    ...data,
    id: generateId(),
    invoiceNumber: generateInvoiceNumber(invoices.length + 1),
    subscriptionName: '', // Should be fetched from subscription
    status: 'draft' as InvoiceStatus,
    issueDate: now,
    billingPeriodStart: now,
    billingPeriodEnd: new Date(data.dueDate),
    totalAmount,
    createdAt: now,
    updatedAt: now,
  };

  invoices.push(newInvoice);
  await saveInvoices(invoices);
  return newInvoice;
}

export async function updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice> {
  const invoices = await getAllInvoices();
  const index = invoices.findIndex(inv => inv.id === id);
  
  if (index === -1) {
    throw new Error(`Invoice with id ${id} not found`);
  }

  const updatedInvoice: Invoice = {
    ...invoices[index],
    ...updates,
    updatedAt: new Date(),
  };

  // Recalculate total if line items changed
  if (updates.lineItems || updates.taxAmount || updates.discountAmount) {
    const lineTotal = updatedInvoice.lineItems.reduce((sum, item) => sum + item.amount, 0);
    updatedInvoice.totalAmount = lineTotal + (updatedInvoice.taxAmount || 0) - (updatedInvoice.discountAmount || 0);
  }

  invoices[index] = updatedInvoice;
  await saveInvoices(invoices);
  return updatedInvoice;
}

export async function deleteInvoice(id: string): Promise<void> {
  const invoices = await getAllInvoices();
  const filtered = invoices.filter(inv => inv.id !== id);
  await saveInvoices(filtered);
}

export async function getAllInvoices(filters?: InvoiceFilters): Promise<Invoice[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEYS.INVOICES);
    if (!data) return [];
    
    let invoices: Invoice[] = JSON.parse(data);
    invoices = invoices.map((inv: any) => ({
      ...inv,
      issueDate: new Date(inv.issueDate),
      dueDate: new Date(inv.dueDate),
      billingPeriodStart: new Date(inv.billingPeriodStart),
      billingPeriodEnd: new Date(inv.billingPeriodEnd),
      createdAt: new Date(inv.createdAt),
      updatedAt: new Date(inv.updatedAt),
    }));

    return applyFilters(invoices, filters);
  } catch (error) {
    console.error('Failed to load invoices:', error);
    return [];
  }
}

export async function getInvoiceById(id: string): Promise<Invoice | null> {
  const invoices = await getAllInvoices();
  return invoices.find(inv => inv.id === id) || null;
}

export async function getInvoicesBySubscription(subscriptionId: string): Promise<Invoice[]> {
  return getAllInvoices({ subscriptionId });
}

// PDF Generation
export async function generateInvoicePDF(options: PDFGenerationOptions): Promise<string> {
  const invoice = await getInvoiceById(options.invoiceId);
  if (!invoice) {
    throw new Error(`Invoice with id ${options.invoiceId} not found`);
  }

  // Get branding and template
  const branding = invoice.brandingId ? await getBranding() : null;
  const template = invoice.templateId ? await getTemplateById(invoice.templateId) : await getDefaultTemplate();

  // Generate HTML
  const html = await generateInvoiceHTML(invoice, branding, template);

  // In a real implementation, this would call a PDF generation service
  // For now, we'll return a mock PDF URL
  const pdfUrl = `mock://invoice-${invoice.invoiceNumber}.pdf`;

  // Update invoice with PDF URL
  await updateInvoice(invoice.id, { pdfUrl });

  return pdfUrl;
}

// Invoice Preview
export async function previewInvoice(invoiceId: string): Promise<InvoicePreview> {
  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) {
    throw new Error(`Invoice with id ${invoiceId} not found`);
  }

  const branding = invoice.brandingId ? await getBranding() : null;
  const template = invoice.templateId ? await getTemplateById(invoice.templateId) : await getDefaultTemplate();

  const html = await generateInvoiceHTML(invoice, branding, template);

  return {
    invoiceId,
    html,
    brandingApplied: !!branding,
    templateApplied: !!template,
  };
}

// Invoice Analytics
export async function getInvoiceAnalytics(): Promise<InvoiceAnalytics> {
  const invoices = await getAllInvoices();

  const totalInvoices = invoices.length;
  const paidInvoices = invoices.filter(inv => inv.status === 'paid').length;
  const pendingInvoices = invoices.filter(inv => inv.status === 'pending').length;
  const overdueInvoices = invoices.filter(inv => inv.status === 'overdue').length;

  const totalRevenue = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((sum, inv) => sum + inv.totalAmount, 0);

  const averageInvoiceAmount = totalInvoices > 0 ? totalRevenue / paidInvoices || 0 : 0;

  // Revenue by month
  const revenueByMonth: Record<string, number> = {};
  invoices.filter(inv => inv.status === 'paid').forEach(inv => {
    const monthKey = `${inv.issueDate.getFullYear()}-${String(inv.issueDate.getMonth() + 1).padStart(2, '0')}`;
    revenueByMonth[monthKey] = (revenueByMonth[monthKey] || 0) + inv.totalAmount;
  });

  // Status breakdown
  const statusBreakdown: Record<InvoiceStatus, number> = {
    draft: 0,
    pending: 0,
    paid: 0,
    overdue: 0,
    cancelled: 0,
    refunded: 0,
  };
  invoices.forEach(inv => {
    statusBreakdown[inv.status]++;
  });

  // Payment method breakdown
  const paymentMethodBreakdown: Record<string, number> = {};
  invoices.filter(inv => inv.paymentMethod).forEach(inv => {
    const method = inv.paymentMethod!;
    paymentMethodBreakdown[method] = (paymentMethodBreakdown[method] || 0) + 1;
  });

  // Top subscriptions
  const subscriptionMap = new Map<string, { revenue: number; invoiceCount: number; name: string }>();
  invoices.filter(inv => inv.status === 'paid').forEach(inv => {
    const existing = subscriptionMap.get(inv.subscriptionId) || { revenue: 0, invoiceCount: 0, name: inv.subscriptionName };
    subscriptionMap.set(inv.subscriptionId, {
      revenue: existing.revenue + inv.totalAmount,
      invoiceCount: existing.invoiceCount + 1,
      name: inv.subscriptionName,
    });
  });

  const topSubscriptions = Array.from(subscriptionMap.entries())
    .map(([subscriptionId, data]) => ({
      subscriptionId,
      subscriptionName: data.name,
      revenue: data.revenue,
      invoiceCount: data.invoiceCount,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    totalInvoices,
    totalRevenue,
    paidInvoices,
    pendingInvoices,
    overdueInvoices,
    averageInvoiceAmount,
    revenueByMonth,
    statusBreakdown,
    paymentMethodBreakdown,
    topSubscriptions,
  };
}

// Helper Functions
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateInvoiceNumber(sequence: number): string {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const num = String(sequence).padStart(4, '0');
  return `INV-${year}${month}-${num}`;
}

async function saveInvoices(invoices: Invoice[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
}

function applyFilters(invoices: Invoice[], filters?: InvoiceFilters): Invoice[] {
  if (!filters) return invoices;

  return invoices.filter(inv => {
    if (filters.status && !filters.status.includes(inv.status)) return false;
    if (filters.subscriptionId && inv.subscriptionId !== filters.subscriptionId) return false;
    if (filters.dateFrom && inv.issueDate < filters.dateFrom) return false;
    if (filters.dateTo && inv.issueDate > filters.dateTo) return false;
    if (filters.minAmount && inv.totalAmount < filters.minAmount) return false;
    if (filters.maxAmount && inv.totalAmount > filters.maxAmount) return false;
    return true;
  });
}

async function generateInvoiceHTML(
  invoice: Invoice,
  branding: InvoiceBranding | null,
  template: InvoiceTemplate
): Promise<string> {
  const primaryColor = branding?.primaryColor || '#4F46E5';
  const secondaryColor = branding?.secondaryColor || '#6B7280';
  const fontFamily = branding?.fontFamily || 'Arial, sans-serif';

  const lineItemsHTML = invoice.lineItems
    .map(
      item => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #E5E7EB;">${item.description}</td>
      <td style="padding: 8px; border-bottom: 1px solid #E5E7EB; text-align: center;">${item.quantity}</td>
      <td style="padding: 8px; border-bottom: 1px solid #E5E7EB; text-align: right;">${invoice.currency} ${item.unitPrice.toFixed(2)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #E5E7EB; text-align: right;">${invoice.currency} ${item.amount.toFixed(2)}</td>
    </tr>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Invoice ${invoice.invoiceNumber}</title>
      <style>
        body { font-family: ${fontFamily}; color: #1F2937; }
        .container { max-width: 800px; margin: 0 auto; padding: 40px; }
        .header { text-align: ${branding?.logoPosition || 'left'}; margin-bottom: 40px; }
        .header h1 { color: ${primaryColor}; margin: 0; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .total-row { font-weight: bold; background-color: #F3F4F6; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          ${branding?.companyLogo ? `<img src="${branding.companyLogo}" alt="${branding.companyName}" style="max-height: 80px;">` : ''}
          <h1>${branding?.companyName || 'SubTrackr'}</h1>
        </div>
        
        <div class="info-grid">
          <div>
            <h3 style="color: ${secondaryColor};">Invoice Details</h3>
            <p><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</p>
            <p><strong>Issue Date:</strong> ${invoice.issueDate.toLocaleDateString()}</p>
            <p><strong>Due Date:</strong> ${invoice.dueDate.toLocaleDateString()}</p>
            <p><strong>Status:</strong> ${invoice.status.toUpperCase()}</p>
          </div>
          <div>
            <h3 style="color: ${secondaryColor};">Bill To</h3>
            <p><strong>${invoice.customerName || 'Customer'}</strong></p>
            <p>${invoice.customerEmail || ''}</p>
          </div>
        </div>

        ${template.headerContent ? `<div style="margin-bottom: 20px;">${template.headerContent}</div>` : ''}

        <table class="table">
          <thead>
            <tr style="background-color: ${primaryColor}; color: white;">
              <th style="padding: 12px; text-align: left;">Description</th>
              <th style="padding: 12px; text-align: center;">Quantity</th>
              <th style="padding: 12px; text-align: right;">Unit Price</th>
              <th style="padding: 12px; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsHTML}
          </tbody>
          <tfoot>
            ${invoice.discountAmount ? `<tr><td colspan="3" style="padding: 8px; text-align: right;">Discount:</td><td style="padding: 8px; text-align: right;">-${invoice.currency} ${invoice.discountAmount.toFixed(2)}</td></tr>` : ''}
            ${invoice.taxAmount ? `<tr><td colspan="3" style="padding: 8px; text-align: right;">Tax:</td><td style="padding: 8px; text-align: right;">${invoice.currency} ${invoice.taxAmount.toFixed(2)}</td></tr>` : ''}
            <tr class="total-row">
              <td colspan="3" style="padding: 12px; text-align: right;">Total:</td>
              <td style="padding: 12px; text-align: right;">${invoice.currency} ${invoice.totalAmount.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        ${template.includeNotes && invoice.notes ? `<div style="margin-top: 20px;"><h3 style="color: ${secondaryColor};">Notes</h3><p>${invoice.notes}</p></div>` : ''}
        ${template.includePaymentTerms && invoice.paymentTerms ? `<div style="margin-top: 20px;"><h3 style="color: ${secondaryColor};">Payment Terms</h3><p>${invoice.paymentTerms}</p></div>` : ''}
        ${template.footerContent ? `<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #E5E7EB;">${template.footerContent}</div>` : ''}
      </div>
    </body>
    </html>
  `;
}

function getDefaultTemplates(): InvoiceTemplate[] {
  const now = new Date();
  return [
    {
      id: 'default-modern',
      name: 'Modern',
      description: 'Clean and contemporary invoice design',
      layout: InvoiceLayout.MODERN,
      includePaymentTerms: true,
      includeNotes: true,
      includeSignature: false,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'default-classic',
      name: 'Classic',
      description: 'Traditional professional invoice layout',
      layout: InvoiceLayout.CLASSIC,
      includePaymentTerms: true,
      includeNotes: true,
      includeSignature: true,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'default-minimal',
      name: 'Minimal',
      description: 'Simple and straightforward design',
      layout: InvoiceLayout.MINIMAL,
      includePaymentTerms: false,
      includeNotes: false,
      includeSignature: false,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
}
