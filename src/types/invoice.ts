export interface InvoiceBranding {
  id: string;
  companyName: string;
  companyLogo?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  fontFamily?: string;
  logoPosition?: 'left' | 'center' | 'right';
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  description?: string;
  layout: InvoiceLayout;
  headerContent?: string;
  footerContent?: string;
  includePaymentTerms: boolean;
  includeNotes: boolean;
  includeSignature: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export enum InvoiceLayout {
  MODERN = 'modern',
  CLASSIC = 'classic',
  MINIMAL = 'minimal',
  PROFESSIONAL = 'professional',
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  subscriptionId: string;
  subscriptionName: string;
  amount: number;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  status: InvoiceStatus;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  brandingId?: string;
  templateId?: string;
  pdfUrl?: string;
  paymentMethod?: string;
  transactionId?: string;
  notes?: string;
  paymentTerms?: string;
  customerEmail?: string;
  customerName?: string;
  lineItems: InvoiceLineItem[];
  taxAmount?: number;
  discountAmount?: number;
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export enum InvoiceStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export interface InvoiceAnalytics {
  totalInvoices: number;
  totalRevenue: number;
  paidInvoices: number;
  pendingInvoices: number;
  overdueInvoices: number;
  averageInvoiceAmount: number;
  revenueByMonth: Record<string, number>;
  statusBreakdown: Record<InvoiceStatus, number>;
  paymentMethodBreakdown: Record<string, number>;
  topSubscriptions: Array<{
    subscriptionId: string;
    subscriptionName: string;
    revenue: number;
    invoiceCount: number;
  }>;
}

export interface InvoicePreview {
  invoiceId: string;
  html: string;
  brandingApplied: boolean;
  templateApplied: boolean;
}

export interface InvoiceFormData {
  subscriptionId: string;
  amount: number;
  currency: string;
  dueDate: Date;
  brandingId?: string;
  templateId?: string;
  notes?: string;
  paymentTerms?: string;
  customerEmail?: string;
  customerName?: string;
  lineItems: InvoiceLineItem[];
  taxAmount?: number;
  discountAmount?: number;
}

export interface PDFGenerationOptions {
  invoiceId: string;
  includeWatermark?: boolean;
  paperSize?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  quality?: 'low' | 'medium' | 'high';
}

export interface InvoiceFilters {
  status?: InvoiceStatus[];
  subscriptionId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
}
