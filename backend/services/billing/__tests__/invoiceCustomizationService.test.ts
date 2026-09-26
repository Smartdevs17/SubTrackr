import {
  FALLBACK_BRANDING,
  InvoiceCustomizationService,
  escapeHtml,
  normalizeBranding,
} from '../invoiceCustomizationService';
import { useInvoiceStore } from '../../../../src/store/invoiceStore';
import { DEFAULT_INVOICE_CONFIG, InvoiceStatus } from '../../../../src/types/invoice';
import type { Invoice } from '../../../../src/types/invoice';

// expo-notifications has no native module under Jest; ts-jest hoists jest.mock
// above the imports at transform time.
jest.mock('../../../../src/services/notificationService', () => ({
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1',
  invoiceNumber: 'INV-000001',
  subscriptionId: 'sub-1',
  subscriptionName: 'Pro Plan',
  merchantName: 'Platform Merchant',
  lineItems: [
    {
      description: 'Pro Plan — January',
      quantity: 1,
      unitPrice: 100,
      currency: 'USD',
      exchangeRate: 1_000_000,
      taxRateBps: 0,
      lineTotal: 100,
    },
  ],
  tax: 10,
  subtotal: 100,
  total: 110,
  dueDate: new Date('2026-02-01T00:00:00.000Z'),
  status: InvoiceStatus.DRAFT,
  currency: 'USD',
  region: 'GLOBAL',
  exchangeRate: 1_000_000,
  period: {
    start: new Date('2026-01-01T00:00:00.000Z'),
    end: new Date('2026-02-01T00:00:00.000Z'),
  },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

beforeEach(() => {
  useInvoiceStore.setState({
    invoices: [],
    config: { ...DEFAULT_INVOICE_CONFIG },
    nextSequence: 1,
    isLoading: false,
    error: null,
    brandingProfiles: {},
    templates: [
      { id: 'tpl-1', name: 'Standard', layout: 'standard' },
      { id: 'tpl-2', name: 'Modern', layout: 'modern' },
      { id: 'tpl-3', name: 'Minimalist', layout: 'minimalist' },
    ],
  });
});

describe('escapeHtml', () => {
  it('escapes every character that could break out of markup', () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;'
    );
  });

  it('renders null and undefined as an empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('normalizeBranding', () => {
  it('fills every unset field from the fallback palette', () => {
    expect(normalizeBranding(undefined)).toMatchObject(FALLBACK_BRANDING);
  });

  it('keeps valid tenant values', () => {
    expect(normalizeBranding({ primaryColor: '#abc' }).primaryColor).toBe('#abc');
  });

  it('replaces an invalid colour with the fallback', () => {
    expect(normalizeBranding({ primaryColor: 'red; background:url(x)' }).primaryColor).toBe(
      FALLBACK_BRANDING.primaryColor
    );
  });

  it('drops a logo URL with an unsafe scheme', () => {
    expect(normalizeBranding({ logoUrl: 'javascript:alert(1)' }).logoUrl).toBeUndefined();
  });

  it('keeps http(s) and data:image logos', () => {
    expect(normalizeBranding({ logoUrl: 'https://cdn.example.com/l.png' }).logoUrl).toBe(
      'https://cdn.example.com/l.png'
    );
    expect(normalizeBranding({ logoUrl: 'data:image/png;base64,AA' }).logoUrl).toBe(
      'data:image/png;base64,AA'
    );
  });

  it('clamps the logo width into the renderable range', () => {
    expect(normalizeBranding({ logoWidth: 5 }).logoWidth).toBe(24);
    expect(normalizeBranding({ logoWidth: 9_999 }).logoWidth).toBe(320);
    expect(normalizeBranding({}).logoWidth).toBe(140);
  });

  it('strips characters that would let a font stack close its declaration', () => {
    expect(normalizeBranding({ fontFamily: 'Inter";}body{display:none' }).fontFamily).toBe(
      'Interbodydisplaynone'
    );
  });

  it('falls back when a font stack sanitizes to nothing', () => {
    expect(normalizeBranding({ fontFamily: '";{}' }).fontFamily).toBe(
      FALLBACK_BRANDING.fontFamily
    );
  });
});

describe('renderInvoice', () => {
  it('renders under the platform defaults when no tenant is set', () => {
    const rendered = InvoiceCustomizationService.renderInvoice(makeInvoice());
    expect(rendered.layout).toBe('standard');
    expect(rendered.templateId).toBe('tpl-1');
    expect(rendered.html).toContain('Platform Merchant');
    expect(rendered.branding.primaryColor).toBe(FALLBACK_BRANDING.primaryColor);
  });

  it("applies the tenant's branding, template, and display name", () => {
    useInvoiceStore.getState().setTenantBranding('tenant-a', {
      displayName: 'Acme Inc.',
      branding: { primaryColor: '#ff0000', logoUrl: 'https://cdn.example.com/acme.png' },
      templateId: 'tpl-2',
    });

    const rendered = InvoiceCustomizationService.renderInvoice(
      makeInvoice({ tenantId: 'tenant-a' })
    );
    expect(rendered.layout).toBe('modern');
    expect(rendered.html).toContain('Acme Inc.');
    expect(rendered.html).toContain('#ff0000');
    expect(rendered.html).toContain('https://cdn.example.com/acme.png');
  });

  it('renders each layout differently', () => {
    const store = useInvoiceStore.getState();
    const htmls = (['tpl-1', 'tpl-2', 'tpl-3'] as const).map((templateId) => {
      store.setTenantBranding('t', { branding: {}, templateId });
      return InvoiceCustomizationService.renderInvoice(makeInvoice({ tenantId: 't' })).html;
    });
    expect(new Set(htmls).size).toBe(3);
  });

  it('is deterministic — the same input renders byte-identical markup', () => {
    const invoice = makeInvoice();
    expect(InvoiceCustomizationService.renderInvoice(invoice).html).toBe(
      InvoiceCustomizationService.renderInvoice(invoice).html
    );
  });

  it('escapes a tenant display name containing markup', () => {
    useInvoiceStore.getState().setTenantBranding('tenant-x', {
      displayName: '<script>alert(1)</script>',
      branding: {},
    });
    const html = InvoiceCustomizationService.renderInvoice(
      makeInvoice({ tenantId: 'tenant-x' })
    ).html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes markup in line item descriptions', () => {
    const html = InvoiceCustomizationService.renderInvoice(
      makeInvoice({
        lineItems: [
          {
            description: '<img src=x onerror=alert(1)>',
            quantity: 1,
            unitPrice: 1,
            currency: 'USD',
            exchangeRate: 1,
            taxRateBps: 0,
            lineTotal: 1,
          },
        ],
      })
    ).html;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders a placeholder row when there are no line items', () => {
    const rendered = InvoiceCustomizationService.renderInvoice(makeInvoice({ lineItems: [] }));
    expect(rendered.html).toContain('No line items');
  });

  it('renders totals in the invoice currency', () => {
    const rendered = InvoiceCustomizationService.renderInvoice(
      makeInvoice({ currency: 'XLM', subtotal: 100, tax: 10, total: 110 })
    );
    expect(rendered.html).toContain('110.00 XLM');
    expect(rendered.text).toContain('Total: 110.00 XLM');
  });

  it('lets a per-invoice branding override outrank the tenant profile', () => {
    useInvoiceStore
      .getState()
      .setTenantBranding('tenant-a', { branding: { primaryColor: '#ff0000' } });
    const rendered = InvoiceCustomizationService.renderInvoice(
      makeInvoice({ tenantId: 'tenant-a', branding: { primaryColor: '#00ff00' } })
    );
    expect(rendered.branding.primaryColor).toBe('#00ff00');
  });

  it('renders the footer contact block only when it is configured', () => {
    expect(InvoiceCustomizationService.renderInvoice(makeInvoice()).html).not.toContain(
      '<footer>'
    );

    useInvoiceStore.getState().setTenantBranding('tenant-a', {
      branding: {
        footerText: 'Payable within 14 days',
        supportEmail: 'billing@acme.example',
        websiteUrl: 'https://acme.example',
      },
    });
    const html = InvoiceCustomizationService.renderInvoice(
      makeInvoice({ tenantId: 'tenant-a' })
    ).html;
    expect(html).toContain('Payable within 14 days');
    expect(html).toContain('mailto:billing@acme.example');
    expect(html).toContain('https://acme.example');
  });

  it('produces a plain-text alternative alongside the HTML', () => {
    const rendered = InvoiceCustomizationService.renderInvoice(makeInvoice());
    expect(rendered.text).toContain('Invoice INV-000001');
    expect(rendered.text).toContain('Pro Plan — January x1: 100.00 USD');
    expect(rendered.text).not.toContain('<');
  });

  it('renders an unparseable date as a dash rather than "Invalid Date"', () => {
    const rendered = InvoiceCustomizationService.renderInvoice(
      makeInvoice({ dueDate: new Date('nonsense') })
    );
    expect(rendered.html).toContain('Due: —');
  });
});

describe('previewForTenant', () => {
  it('reflects the current profile, ignoring branding frozen on the sample', () => {
    useInvoiceStore
      .getState()
      .setTenantBranding('tenant-a', { branding: { primaryColor: '#123456' } });
    const preview = InvoiceCustomizationService.previewForTenant(
      'tenant-a',
      makeInvoice({ branding: { primaryColor: '#ffffff' } })
    );
    expect(preview.branding.primaryColor).toBe('#123456');
  });
});

describe('generateInvoicePdf', () => {
  it('returns a document URL alongside the rendered markup', async () => {
    const { url, rendered } = await InvoiceCustomizationService.generateInvoicePdf(makeInvoice());
    expect(url).toBe('https://cdn.subtrackr.app/invoices/inv-1.pdf');
    expect(rendered.html).toContain('INV-000001');
  });

  it('encodes an invoice id that needs escaping', async () => {
    const { url } = await InvoiceCustomizationService.generateInvoicePdf(
      makeInvoice({ id: 'inv/1 2' })
    );
    expect(url).toBe('https://cdn.subtrackr.app/invoices/inv%2F1%202.pdf');
  });
});

describe('deliverInvoice', () => {
  it('renders, sends, and marks the invoice sent', async () => {
    useInvoiceStore.setState({ invoices: [makeInvoice()] });
    const result = await InvoiceCustomizationService.deliverInvoice('inv-1', 'payer@example.com');

    expect(result.delivered).toBe(true);
    expect(result.documentUrl).toContain('inv-1.pdf');
    expect(useInvoiceStore.getState().invoices[0].status).toBe(InvoiceStatus.SENT);
    expect(useInvoiceStore.getState().invoices[0].recipientEmail).toBe('payer@example.com');
  });

  it('reports a missing invoice instead of throwing', async () => {
    const result = await InvoiceCustomizationService.deliverInvoice('nope', 'payer@example.com');
    expect(result.delivered).toBe(false);
    expect(result.error).toBe('Invoice not found');
  });
});
