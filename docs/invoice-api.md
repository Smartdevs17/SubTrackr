# Invoice API Documentation

## Overview

The Invoice API provides comprehensive invoice management capabilities including branding customization, template management, PDF generation, and analytics.

## Invoice Management

### Create Invoice

```typescript
createInvoice(data: InvoiceFormData): Promise<Invoice>
```

Creates a new invoice with the specified data.

**Parameters:**
- `data.subscriptionId` (string, required): ID of the associated subscription
- `data.amount` (number, required): Invoice amount
- `data.currency` (string, required): Currency code (e.g., 'USD', 'EUR')
- `data.dueDate` (Date, required): Payment due date
- `data.brandingId` (string, optional): ID of branding to apply
- `data.templateId` (string, optional): ID of template to use
- `data.notes` (string, optional): Additional notes
- `data.paymentTerms` (string, optional): Payment terms description
- `data.customerEmail` (string, optional): Customer email address
- `data.customerName` (string, optional): Customer name
- `data.lineItems` (InvoiceLineItem[], required): Invoice line items
- `data.taxAmount` (number, optional): Tax amount
- `data.discountAmount` (number, optional): Discount amount

**Returns:** Created invoice object

**Example:**
```typescript
const invoice = await createInvoice({
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
});
```

### Update Invoice

```typescript
updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice>
```

Updates an existing invoice.

**Parameters:**
- `id` (string, required): Invoice ID
- `updates` (object, required): Fields to update

**Returns:** Updated invoice object

### Get All Invoices

```typescript
getAllInvoices(filters?: InvoiceFilters): Promise<Invoice[]>
```

Retrieves all invoices with optional filtering.

**Filter Parameters:**
- `status` (InvoiceStatus[], optional): Filter by status
- `subscriptionId` (string, optional): Filter by subscription
- `dateFrom` (Date, optional): Start date filter
- `dateTo` (Date, optional): End date filter
- `minAmount` (number, optional): Minimum amount filter
- `maxAmount` (number, optional): Maximum amount filter

**Returns:** Array of invoices

### Get Invoice by ID

```typescript
getInvoiceById(id: string): Promise<Invoice | null>
```

Retrieves a specific invoice by ID.

**Parameters:**
- `id` (string, required): Invoice ID

**Returns:** Invoice object or null if not found

### Delete Invoice

```typescript
deleteInvoice(id: string): Promise<void>
```

Deletes an invoice.

**Parameters:**
- `id` (string, required): Invoice ID

## Branding Management

### Save Branding

```typescript
saveBranding(branding: Omit<InvoiceBranding, 'id' | 'createdAt' | 'updatedAt'>): Promise<InvoiceBranding>
```

Creates or updates invoice branding settings.

**Parameters:**
- `companyName` (string, required): Company name
- `companyLogo` (string, optional): Logo URL
- `primaryColor` (string, required): Primary brand color (hex)
- `secondaryColor` (string, required): Secondary brand color (hex)
- `accentColor` (string, optional): Accent color (hex)
- `fontFamily` (string, optional): Font family CSS string
- `logoPosition` ('left' | 'center' | 'right', optional): Logo alignment

**Returns:** Saved branding object

**Example:**
```typescript
const branding = await saveBranding({
  companyName: 'Acme Inc',
  companyLogo: 'https://example.com/logo.png',
  primaryColor: '#4F46E5',
  secondaryColor: '#6B7280',
  logoPosition: 'left',
});
```

### Get Branding

```typescript
getBranding(): Promise<InvoiceBranding | null>
```

Retrieves current invoice branding settings.

**Returns:** Branding object or null if not configured

### Delete Branding

```typescript
deleteBranding(): Promise<void>
```

Removes invoice branding settings.

## Template Management

### Create Template

```typescript
createTemplate(template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<InvoiceTemplate>
```

Creates a new invoice template.

**Parameters:**
- `name` (string, required): Template name
- `description` (string, optional): Template description
- `layout` (InvoiceLayout, required): Layout style
- `headerContent` (string, optional): Custom header HTML
- `footerContent` (string, optional): Custom footer HTML
- `includePaymentTerms` (boolean, required): Show payment terms
- `includeNotes` (boolean, required): Show notes section
- `includeSignature` (boolean, required): Show signature line
- `isDefault` (boolean, required): Set as default template

**Returns:** Created template object

**Example:**
```typescript
const template = await createTemplate({
  name: 'Professional Invoice',
  layout: InvoiceLayout.PROFESSIONAL,
  includePaymentTerms: true,
  includeNotes: true,
  includeSignature: true,
  isDefault: false,
});
```

### Update Template

```typescript
updateTemplate(id: string, updates: Partial<InvoiceTemplate>): Promise<InvoiceTemplate>
```

Updates an existing template.

**Parameters:**
- `id` (string, required): Template ID
- `updates` (object, required): Fields to update

**Returns:** Updated template object

### Get All Templates

```typescript
getAllTemplates(): Promise<InvoiceTemplate[]>
```

Retrieves all invoice templates.

**Returns:** Array of templates

### Delete Template

```typescript
deleteTemplate(id: string): Promise<void>
```

Deletes a template.

**Parameters:**
- `id` (string, required): Template ID

## PDF Generation

### Generate Invoice PDF

```typescript
generateInvoicePDF(options: PDFGenerationOptions): Promise<string>
```

Generates a PDF version of an invoice with branding.

**Parameters:**
- `invoiceId` (string, required): Invoice ID
- `includeWatermark` (boolean, optional): Add watermark
- `paperSize` ('A4' | 'Letter', optional): Paper size
- `orientation` ('portrait' | 'landscape', optional): Page orientation
- `quality` ('low' | 'medium' | 'high', optional): PDF quality

**Returns:** PDF URL

**Example:**
```typescript
const pdfUrl = await generateInvoicePDF({
  invoiceId: 'inv-123',
  paperSize: 'A4',
  orientation: 'portrait',
  quality: 'high',
});
```

### Preview Invoice

```typescript
previewInvoice(invoiceId: string): Promise<InvoicePreview>
```

Generates HTML preview of an invoice.

**Parameters:**
- `invoiceId` (string, required): Invoice ID

**Returns:** Preview object with HTML content

## Analytics

### Get Invoice Analytics

```typescript
getInvoiceAnalytics(): Promise<InvoiceAnalytics>
```

Retrieves comprehensive invoice analytics.

**Returns:** Analytics object containing:
- `totalInvoices` (number): Total invoice count
- `totalRevenue` (number): Total revenue from paid invoices
- `paidInvoices` (number): Count of paid invoices
- `pendingInvoices` (number): Count of pending invoices
- `overdueInvoices` (number): Count of overdue invoices
- `averageInvoiceAmount` (number): Average invoice value
- `revenueByMonth` (object): Monthly revenue breakdown
- `statusBreakdown` (object): Invoice count by status
- `paymentMethodBreakdown` (object): Invoice count by payment method
- `topSubscriptions` (array): Top revenue-generating subscriptions

**Example Response:**
```typescript
{
  totalInvoices: 150,
  totalRevenue: 14999.50,
  paidInvoices: 120,
  pendingInvoices: 20,
  overdueInvoices: 10,
  averageInvoiceAmount: 124.99,
  revenueByMonth: {
    '2026-07': 2500.00,
    '2026-06': 3200.00,
  },
  statusBreakdown: {
    draft: 5,
    pending: 20,
    paid: 120,
    overdue: 10,
    cancelled: 3,
    refunded: 2,
  },
  paymentMethodBreakdown: {
    'credit_card': 80,
    'crypto': 40,
  },
  topSubscriptions: [
    {
      subscriptionId: 'sub-123',
      subscriptionName: 'Netflix Premium',
      revenue: 1499.88,
      invoiceCount: 12,
    },
  ],
}
```

## Invoice Status Workflow

```
DRAFT → PENDING → PAID
              ↓
           OVERDUE
              ↓
         CANCELLED or REFUNDED
```

- **DRAFT**: Invoice created but not sent
- **PENDING**: Invoice sent, awaiting payment
- **PAID**: Payment received
- **OVERDUE**: Past due date without payment
- **CANCELLED**: Invoice cancelled
- **REFUNDED**: Payment refunded

## Layout Types

- **MODERN**: Clean and contemporary design
- **CLASSIC**: Traditional professional layout
- **MINIMAL**: Simple and straightforward
- **PROFESSIONAL**: Formal business style

## Storage

All invoice data is stored locally using AsyncStorage with the following keys:
- `@SubTrackr:invoices`: Invoice records
- `@SubTrackr:invoiceBranding`: Branding configuration
- `@SubTrackr:invoiceTemplates`: Invoice templates

## Error Handling

All API methods throw errors with descriptive messages. Always wrap calls in try-catch blocks:

```typescript
try {
  const invoice = await createInvoice(data);
} catch (error) {
  console.error('Invoice creation failed:', error.message);
}
```

## Integration with Subscriptions

Invoices are linked to subscriptions via `subscriptionId`. When a subscription is charged, an invoice should be created to track the transaction.

## Best Practices

1. **Always set branding** before generating PDFs for professional appearance
2. **Use templates** to maintain consistent invoice styling
3. **Track analytics regularly** to monitor revenue and payment status
4. **Update invoice status** when payments are received
5. **Generate PDFs** for record-keeping and customer delivery
6. **Filter invoices** when displaying large lists to improve performance
7. **Include line items** with clear descriptions for transparency
