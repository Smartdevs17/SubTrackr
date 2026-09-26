import AsyncStorage from '@react-native-async-storage/async-storage';
import * as invoiceService from '../invoiceService';
import { InvoiceLayout, InvoiceStatus } from '../../types/invoice';
import type { InvoiceFormData } from '../../types/invoice';

jest.mock('@react-native-async-storage/async-storage');

describe('invoiceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Branding Management', () => {
    it('should save new branding', async () => {
      const brandingData = {
        companyName: 'Test Company',
        primaryColor: '#4F46E5',
        secondaryColor: '#6B7280',
      };

      const branding = await invoiceService.saveBranding(brandingData);

      expect(branding).toMatchObject(brandingData);
      expect(branding.id).toBeDefined();
      expect(branding.createdAt).toBeInstanceOf(Date);
      expect(branding.updatedAt).toBeInstanceOf(Date);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        '@SubTrackr:invoiceBranding',
        expect.any(String)
      );
    });

    it('should update existing branding', async () => {
      const existingBranding = {
        id: 'brand-123',
        companyName: 'Old Company',
        primaryColor: '#000000',
        secondaryColor: '#FFFFFF',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(existingBranding));

      const updatedData = {
        companyName: 'New Company',
        primaryColor: '#4F46E5',
        secondaryColor: '#6B7280',
      };

      const branding = await invoiceService.saveBranding(updatedData);

      expect(branding.id).toBe(existingBranding.id);
      expect(branding.companyName).toBe('New Company');
      expect(branding.createdAt).toEqual(existingBranding.createdAt);
    });

    it('should get branding', async () => {
      const brandingData = {
        id: 'brand-123',
        companyName: 'Test Company',
        primaryColor: '#4F46E5',
        secondaryColor: '#6B7280',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(brandingData));

      const branding = await invoiceService.getBranding();

      expect(branding).toBeDefined();
      expect(branding?.companyName).toBe('Test Company');
      expect(branding?.createdAt).toBeInstanceOf(Date);
    });

    it('should return null when no branding exists', async () => {
      const branding = await invoiceService.getBranding();
      expect(branding).toBeNull();
    });

    it('should delete branding', async () => {
      await invoiceService.deleteBranding();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@SubTrackr:invoiceBranding');
    });
  });

  describe('Template Management', () => {
    it('should create new template', async () => {
      const templateData = {
        name: 'Test Template',
        description: 'A test template',
        layout: InvoiceLayout.MODERN,
        includePaymentTerms: true,
        includeNotes: true,
        includeSignature: false,
        isDefault: false,
      };

      const template = await invoiceService.createTemplate(templateData);

      expect(template).toMatchObject(templateData);
      expect(template.id).toBeDefined();
      expect(template.createdAt).toBeInstanceOf(Date);
    });

    it('should set template as default and unset others', async () => {
      const existingTemplates = [
        {
          id: 'temp-1',
          name: 'Template 1',
          layout: InvoiceLayout.MODERN,
          includePaymentTerms: true,
          includeNotes: true,
          includeSignature: false,
          isDefault: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(existingTemplates));

      const newTemplate = await invoiceService.createTemplate({
        name: 'Template 2',
        layout: InvoiceLayout.CLASSIC,
        includePaymentTerms: true,
        includeNotes: true,
        includeSignature: true,
        isDefault: true,
      });

      expect(newTemplate.isDefault).toBe(true);

      const savedData = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
      const savedTemplates = JSON.parse(savedData);
      const oldTemplate = savedTemplates.find((t: any) => t.id === 'temp-1');
      expect(oldTemplate.isDefault).toBe(false);
    });

    it('should update template', async () => {
      const templates = [
        {
          id: 'temp-1',
          name: 'Old Name',
          layout: InvoiceLayout.MODERN,
          includePaymentTerms: true,
          includeNotes: true,
          includeSignature: false,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(templates));

      const updated = await invoiceService.updateTemplate('temp-1', { name: 'New Name' });

      expect(updated.name).toBe('New Name');
      expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw error when updating non-existent template', async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify([]));

      await expect(
        invoiceService.updateTemplate('non-existent', { name: 'Test' })
      ).rejects.toThrow('Template with id non-existent not found');
    });

    it('should delete template', async () => {
      const templates = [
        {
          id: 'temp-1',
          name: 'Template 1',
          layout: InvoiceLayout.MODERN,
          includePaymentTerms: true,
          includeNotes: true,
          includeSignature: false,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(templates));

      await invoiceService.deleteTemplate('temp-1');

      const savedData = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
      const savedTemplates = JSON.parse(savedData);
      expect(savedTemplates).toHaveLength(0);
    });

    it('should get all templates', async () => {
      const templates = await invoiceService.getAllTemplates();
      expect(templates).toBeDefined();
      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0].layout).toBeDefined();
    });

    it('should get default template', async () => {
      const template = await invoiceService.getDefaultTemplate();
      expect(template).toBeDefined();
      expect(template.isDefault).toBe(true);
    });
  });

  describe('Invoice Management', () => {
    const mockInvoiceData: InvoiceFormData = {
      subscriptionId: 'sub-123',
      amount: 99.99,
      currency: 'USD',
      dueDate: new Date('2026-08-26'),
      lineItems: [
        {
          id: 'item-1',
          description: 'Monthly Subscription',
          quantity: 1,
          unitPrice: 99.99,
          amount: 99.99,
        },
      ],
    };

    it('should create new invoice', async () => {
      const invoice = await invoiceService.createInvoice(mockInvoiceData);

      expect(invoice).toMatchObject({
        subscriptionId: 'sub-123',
        amount: 99.99,
        currency: 'USD',
        status: InvoiceStatus.DRAFT,
      });
      expect(invoice.id).toBeDefined();
      expect(invoice.invoiceNumber).toMatch(/^INV-\d{6}-\d{4}$/);
      expect(invoice.totalAmount).toBe(99.99);
    });

    it('should calculate total with tax and discount', async () => {
      const dataWithTaxAndDiscount = {
        ...mockInvoiceData,
        taxAmount: 10,
        discountAmount: 5,
      };

      const invoice = await invoiceService.createInvoice(dataWithTaxAndDiscount);

      expect(invoice.totalAmount).toBe(104.99); // 99.99 + 10 - 5
    });

    it('should update invoice', async () => {
      const invoice = await invoiceService.createInvoice(mockInvoiceData);

      const updated = await invoiceService.updateInvoice(invoice.id, {
        status: InvoiceStatus.PAID,
      });

      expect(updated.status).toBe(InvoiceStatus.PAID);
      expect(updated.updatedAt).toBeInstanceOf(Date);
    });

    it('should recalculate total when line items updated', async () => {
      const invoice = await invoiceService.createInvoice(mockInvoiceData);

      const newLineItems = [
        {
          id: 'item-1',
          description: 'Item 1',
          quantity: 2,
          unitPrice: 50,
          amount: 100,
        },
        {
          id: 'item-2',
          description: 'Item 2',
          quantity: 1,
          unitPrice: 25,
          amount: 25,
        },
      ];

      const updated = await invoiceService.updateInvoice(invoice.id, {
        lineItems: newLineItems,
      });

      expect(updated.totalAmount).toBe(125);
    });

    it('should get all invoices', async () => {
      await invoiceService.createInvoice(mockInvoiceData);
      await invoiceService.createInvoice(mockInvoiceData);

      const invoices = await invoiceService.getAllInvoices();

      expect(invoices).toHaveLength(2);
    });

    it('should filter invoices by status', async () => {
      const invoice1 = await invoiceService.createInvoice(mockInvoiceData);
      const invoice2 = await invoiceService.createInvoice(mockInvoiceData);

      await invoiceService.updateInvoice(invoice1.id, { status: InvoiceStatus.PAID });

      const paidInvoices = await invoiceService.getAllInvoices({
        status: [InvoiceStatus.PAID],
      });

      expect(paidInvoices).toHaveLength(1);
      expect(paidInvoices[0].status).toBe(InvoiceStatus.PAID);
    });

    it('should filter invoices by date range', async () => {
      const invoice1 = await invoiceService.createInvoice(mockInvoiceData);
      
      // Create invoice with past date
      const oldInvoice = await invoiceService.createInvoice(mockInvoiceData);
      await invoiceService.updateInvoice(oldInvoice.id, {
        issueDate: new Date('2026-01-01'),
      });

      const recentInvoices = await invoiceService.getAllInvoices({
        dateFrom: new Date('2026-07-01'),
      });

      expect(recentInvoices.length).toBeGreaterThan(0);
      expect(recentInvoices.every(inv => inv.issueDate >= new Date('2026-07-01'))).toBe(true);
    });

    it('should delete invoice', async () => {
      const invoice = await invoiceService.createInvoice(mockInvoiceData);
      await invoiceService.deleteInvoice(invoice.id);

      const invoices = await invoiceService.getAllInvoices();
      expect(invoices.find(inv => inv.id === invoice.id)).toBeUndefined();
    });

    it('should get invoice by id', async () => {
      const created = await invoiceService.createInvoice(mockInvoiceData);
      const found = await invoiceService.getInvoiceById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });
  });

  describe('PDF Generation', () => {
    it('should generate PDF and update invoice', async () => {
      const invoice = await invoiceService.createInvoice({
        subscriptionId: 'sub-123',
        amount: 99.99,
        currency: 'USD',
        dueDate: new Date('2026-08-26'),
        lineItems: [
          {
            id: 'item-1',
            description: 'Test Item',
            quantity: 1,
            unitPrice: 99.99,
            amount: 99.99,
          },
        ],
      });

      const pdfUrl = await invoiceService.generateInvoicePDF({
        invoiceId: invoice.id,
      });

      expect(pdfUrl).toContain('mock://invoice-');
      expect(pdfUrl).toContain('.pdf');

      const updated = await invoiceService.getInvoiceById(invoice.id);
      expect(updated?.pdfUrl).toBe(pdfUrl);
    });

    it('should throw error when generating PDF for non-existent invoice', async () => {
      await expect(
        invoiceService.generateInvoicePDF({ invoiceId: 'non-existent' })
      ).rejects.toThrow('Invoice with id non-existent not found');
    });
  });

  describe('Invoice Preview', () => {
    it('should generate HTML preview', async () => {
      const invoice = await invoiceService.createInvoice({
        subscriptionId: 'sub-123',
        amount: 99.99,
        currency: 'USD',
        dueDate: new Date('2026-08-26'),
        customerName: 'John Doe',
        customerEmail: 'john@example.com',
        lineItems: [
          {
            id: 'item-1',
            description: 'Test Item',
            quantity: 1,
            unitPrice: 99.99,
            amount: 99.99,
          },
        ],
      });

      const preview = await invoiceService.previewInvoice(invoice.id);

      expect(preview.html).toContain('<!DOCTYPE html>');
      expect(preview.html).toContain(invoice.invoiceNumber);
      expect(preview.html).toContain('Test Item');
      expect(preview.invoiceId).toBe(invoice.id);
    });
  });

  describe('Invoice Analytics', () => {
    beforeEach(async () => {
      // Create test invoices
      const invoice1 = await invoiceService.createInvoice({
        subscriptionId: 'sub-1',
        amount: 100,
        currency: 'USD',
        dueDate: new Date('2026-08-26'),
        lineItems: [{ id: '1', description: 'Item 1', quantity: 1, unitPrice: 100, amount: 100 }],
      });

      const invoice2 = await invoiceService.createInvoice({
        subscriptionId: 'sub-2',
        amount: 200,
        currency: 'USD',
        dueDate: new Date('2026-08-26'),
        lineItems: [{ id: '2', description: 'Item 2', quantity: 1, unitPrice: 200, amount: 200 }],
      });

      await invoiceService.updateInvoice(invoice1.id, {
        status: InvoiceStatus.PAID,
        subscriptionName: 'Subscription 1',
      });

      await invoiceService.updateInvoice(invoice2.id, {
        status: InvoiceStatus.PENDING,
        subscriptionName: 'Subscription 2',
      });
    });

    it('should calculate total invoices', async () => {
      const analytics = await invoiceService.getInvoiceAnalytics();
      expect(analytics.totalInvoices).toBeGreaterThanOrEqual(2);
    });

    it('should calculate total revenue from paid invoices', async () => {
      const analytics = await invoiceService.getInvoiceAnalytics();
      expect(analytics.totalRevenue).toBeGreaterThanOrEqual(100);
    });

    it('should count paid, pending, and overdue invoices', async () => {
      const analytics = await invoiceService.getInvoiceAnalytics();
      expect(analytics.paidInvoices).toBeGreaterThanOrEqual(1);
      expect(analytics.pendingInvoices).toBeGreaterThanOrEqual(1);
    });

    it('should provide status breakdown', async () => {
      const analytics = await invoiceService.getInvoiceAnalytics();
      expect(analytics.statusBreakdown).toHaveProperty('paid');
      expect(analytics.statusBreakdown).toHaveProperty('pending');
      expect(analytics.statusBreakdown).toHaveProperty('draft');
    });

    it('should track top subscriptions by revenue', async () => {
      const analytics = await invoiceService.getInvoiceAnalytics();
      expect(analytics.topSubscriptions).toBeDefined();
      expect(analytics.topSubscriptions.length).toBeGreaterThan(0);
    });
  });
});
