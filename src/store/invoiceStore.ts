import { create } from 'zustand';
import type {
  Invoice,
  InvoiceBranding,
  InvoiceTemplate,
  InvoiceAnalytics,
  InvoiceFormData,
  PDFGenerationOptions,
  InvoiceFilters,
} from '../types/invoice';
import * as invoiceService from '../services/invoiceService';

interface InvoiceStore {
  invoices: Invoice[];
  branding: InvoiceBranding | null;
  templates: InvoiceTemplate[];
  analytics: InvoiceAnalytics | null;
  isLoading: boolean;
  error: string | null;

  // Invoice operations
  loadInvoices: (filters?: InvoiceFilters) => Promise<void>;
  createInvoice: (data: InvoiceFormData) => Promise<Invoice>;
  updateInvoice: (id: string, updates: Partial<Invoice>) => Promise<Invoice>;
  deleteInvoice: (id: string) => Promise<void>;
  getInvoiceById: (id: string) => Invoice | undefined;

  // Branding operations
  loadBranding: () => Promise<void>;
  saveBranding: (branding: Omit<InvoiceBranding, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  deleteBranding: () => Promise<void>;

  // Template operations
  loadTemplates: () => Promise<void>;
  createTemplate: (template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<InvoiceTemplate>;
  updateTemplate: (id: string, updates: Partial<InvoiceTemplate>) => Promise<InvoiceTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
  getDefaultTemplate: () => InvoiceTemplate | undefined;

  // PDF and preview
  generatePDF: (options: PDFGenerationOptions) => Promise<string>;
  previewInvoice: (invoiceId: string) => Promise<string>;

  // Analytics
  loadAnalytics: () => Promise<void>;

  // Utility
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  invoices: [],
  branding: null,
  templates: [],
  analytics: null,
  isLoading: false,
  error: null,
};

export const useInvoiceStore = create<InvoiceStore>((set, get) => ({
  ...initialState,

  // Invoice operations
  loadInvoices: async (filters?: InvoiceFilters) => {
    set({ isLoading: true, error: null });
    try {
      const invoices = await invoiceService.getAllInvoices(filters);
      set({ invoices, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createInvoice: async (data: InvoiceFormData) => {
    set({ isLoading: true, error: null });
    try {
      const invoice = await invoiceService.createInvoice(data);
      set(state => ({
        invoices: [...state.invoices, invoice],
        isLoading: false,
      }));
      return invoice;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  updateInvoice: async (id: string, updates: Partial<Invoice>) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await invoiceService.updateInvoice(id, updates);
      set(state => ({
        invoices: state.invoices.map(inv => (inv.id === id ? updated : inv)),
        isLoading: false,
      }));
      return updated;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  deleteInvoice: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoiceService.deleteInvoice(id);
      set(state => ({
        invoices: state.invoices.filter(inv => inv.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  getInvoiceById: (id: string) => {
    return get().invoices.find(inv => inv.id === id);
  },

  // Branding operations
  loadBranding: async () => {
    set({ isLoading: true, error: null });
    try {
      const branding = await invoiceService.getBranding();
      set({ branding, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  saveBranding: async (branding: Omit<InvoiceBranding, 'id' | 'createdAt' | 'updatedAt'>) => {
    set({ isLoading: true, error: null });
    try {
      const saved = await invoiceService.saveBranding(branding);
      set({ branding: saved, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  deleteBranding: async () => {
    set({ isLoading: true, error: null });
    try {
      await invoiceService.deleteBranding();
      set({ branding: null, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  // Template operations
  loadTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const templates = await invoiceService.getAllTemplates();
      set({ templates, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createTemplate: async (template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    set({ isLoading: true, error: null });
    try {
      const created = await invoiceService.createTemplate(template);
      set(state => ({
        templates: [...state.templates, created],
        isLoading: false,
      }));
      return created;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  updateTemplate: async (id: string, updates: Partial<InvoiceTemplate>) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await invoiceService.updateTemplate(id, updates);
      set(state => ({
        templates: state.templates.map(t => (t.id === id ? updated : t)),
        isLoading: false,
      }));
      return updated;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  deleteTemplate: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await invoiceService.deleteTemplate(id);
      set(state => ({
        templates: state.templates.filter(t => t.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  getDefaultTemplate: () => {
    return get().templates.find(t => t.isDefault);
  },

  // PDF and preview
  generatePDF: async (options: PDFGenerationOptions) => {
    set({ isLoading: true, error: null });
    try {
      const pdfUrl = await invoiceService.generateInvoicePDF(options);
      
      // Update the invoice with the PDF URL
      const invoice = get().invoices.find(inv => inv.id === options.invoiceId);
      if (invoice) {
        set(state => ({
          invoices: state.invoices.map(inv =>
            inv.id === options.invoiceId ? { ...inv, pdfUrl } : inv
          ),
          isLoading: false,
        }));
      }
      
      return pdfUrl;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  previewInvoice: async (invoiceId: string) => {
    set({ isLoading: true, error: null });
    try {
      const preview = await invoiceService.previewInvoice(invoiceId);
      set({ isLoading: false });
      return preview.html;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      throw error;
    }
  },

  // Analytics
  loadAnalytics: async () => {
    set({ isLoading: true, error: null });
    try {
      const analytics = await invoiceService.getInvoiceAnalytics();
      set({ analytics, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  // Utility
  clearError: () => set({ error: null }),
  reset: () => set(initialState),
}));
