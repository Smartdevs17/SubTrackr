// The store reaches for expo-notifications when an invoice is sent; that
// native module is unavailable under Jest, so stub the whole service.
import { useInvoiceStore, validateInvoiceBranding } from '../invoiceStore';
import { DEFAULT_INVOICE_CONFIG, InvoiceStatus } from '../../types/invoice';
import type { Invoice } from '../../types/invoice';

// The store reaches for expo-notifications when an invoice is sent; that native
// module is unavailable under Jest, so stub the whole service. babel-jest
// hoists this above the imports at transform time.
jest.mock('../../services/notificationService', () => ({
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../services/notificationService', () => ({
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

const resetStore = () => {
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
};

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1',
  invoiceNumber: 'INV-000001',
  subscriptionId: 'sub-1',
  subscriptionName: 'Pro Plan',
  merchantName: 'Platform Merchant',
  lineItems: [],
  tax: 0,
  subtotal: 100,
  total: 100,
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

beforeEach(resetStore);

describe('validateInvoiceBranding', () => {
  it('accepts a fully specified valid profile', () => {
    expect(
      validateInvoiceBranding({
        logoUrl: 'https://cdn.example.com/logo.png',
        primaryColor: '#1a73e8',
        secondaryColor: '#fff',
        accentColor: '#188038',
        textColor: '#202124',
        fontFamily: 'Inter, sans-serif',
        logoWidth: 120,
        supportEmail: 'billing@example.com',
        websiteUrl: 'https://example.com',
      })
    ).toEqual([]);
  });

  it('accepts an empty profile', () => {
    expect(validateInvoiceBranding({})).toEqual([]);
  });

  it('rejects malformed hex colours', () => {
    const errors = validateInvoiceBranding({ primaryColor: 'red', accentColor: '#12345' });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/primaryColor/);
    expect(errors[1]).toMatch(/accentColor/);
  });

  it('rejects a logo URL with an unsafe scheme', () => {
    expect(validateInvoiceBranding({ logoUrl: 'javascript:alert(1)' })).toEqual([
      'logoUrl must be an http(s) or data:image URL',
    ]);
  });

  it('accepts an inline data image logo', () => {
    expect(validateInvoiceBranding({ logoUrl: 'data:image/png;base64,AAAA' })).toEqual([]);
  });

  it('rejects a non-positive logo width', () => {
    expect(validateInvoiceBranding({ logoWidth: 0 })).toEqual([
      'logoWidth must be a positive number',
    ]);
  });

  it('rejects a malformed support email and website', () => {
    const errors = validateInvoiceBranding({
      supportEmail: 'not-an-email',
      websiteUrl: 'ftp://example.com',
    });
    expect(errors).toHaveLength(2);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    expect(
      validateInvoiceBranding({ primaryColor: 'nope', logoUrl: 'javascript:x', logoWidth: -1 })
    ).toHaveLength(3);
  });
});

describe('tenant branding registry', () => {
  it('stores and reads back a tenant profile', () => {
    const store = useInvoiceStore.getState();
    const saved = store.setTenantBranding('tenant-a', {
      displayName: 'Acme Inc.',
      branding: { primaryColor: '#ff0000' },
      templateId: 'tpl-2',
    });

    expect(saved.tenantId).toBe('tenant-a');
    expect(saved.updatedAt).toBeInstanceOf(Date);
    expect(useInvoiceStore.getState().getTenantBranding('tenant-a')?.displayName).toBe('Acme Inc.');
  });

  it('rejects an invalid profile instead of storing it', () => {
    const store = useInvoiceStore.getState();
    expect(() =>
      store.setTenantBranding('tenant-a', { branding: { primaryColor: 'not-a-colour' } })
    ).toThrow(/Invalid branding for tenant tenant-a/);
    expect(useInvoiceStore.getState().getTenantBranding('tenant-a')).toBeUndefined();
  });

  it('merges a partial update onto the stored branding', () => {
    const store = useInvoiceStore.getState();
    store.setTenantBranding('tenant-a', {
      branding: { primaryColor: '#ff0000', fontFamily: 'Inter' },
    });
    const updated = useInvoiceStore
      .getState()
      .updateTenantBranding('tenant-a', { branding: { primaryColor: '#00ff00' } });

    expect(updated?.branding.primaryColor).toBe('#00ff00');
    // Untouched fields survive the patch.
    expect(updated?.branding.fontFamily).toBe('Inter');
  });

  it('validates the merged result of a partial update', () => {
    const store = useInvoiceStore.getState();
    store.setTenantBranding('tenant-a', { branding: { primaryColor: '#ff0000' } });
    expect(() =>
      useInvoiceStore.getState().updateTenantBranding('tenant-a', {
        branding: { primaryColor: 'bad' },
      })
    ).toThrow(/Invalid branding/);
  });

  it('returns null when updating an unknown tenant', () => {
    expect(useInvoiceStore.getState().updateTenantBranding('nope', {})).toBeNull();
  });

  it('removes a profile', () => {
    const store = useInvoiceStore.getState();
    store.setTenantBranding('tenant-a', { branding: {} });
    useInvoiceStore.getState().removeTenantBranding('tenant-a');
    expect(useInvoiceStore.getState().getTenantBranding('tenant-a')).toBeUndefined();
  });

  it('removing an unknown tenant is a no-op', () => {
    useInvoiceStore.getState().setTenantBranding('tenant-a', { branding: {} });
    useInvoiceStore.getState().removeTenantBranding('nope');
    expect(useInvoiceStore.getState().listTenantBranding()).toHaveLength(1);
  });

  it('lists every stored profile', () => {
    const store = useInvoiceStore.getState();
    store.setTenantBranding('tenant-a', { branding: {} });
    useInvoiceStore.getState().setTenantBranding('tenant-b', { branding: {} });
    expect(
      useInvoiceStore
        .getState()
        .listTenantBranding()
        .map((p) => p.tenantId)
    ).toEqual(['tenant-a', 'tenant-b']);
  });
});

describe('resolveBranding', () => {
  it('falls back to the platform default when no tenant is given', () => {
    const resolved = useInvoiceStore.getState().resolveBranding();
    expect(resolved.source).toBe('fallback');
    expect(resolved.templateId).toBe('tpl-1');
    expect(resolved.numberingPrefix).toBe('INV');
  });

  it('reports the platform layer when a platform default exists', () => {
    useInvoiceStore.getState().setInvoiceBranding({ primaryColor: '#000000' });
    const resolved = useInvoiceStore.getState().resolveBranding();
    expect(resolved.source).toBe('platform');
    expect(resolved.branding.primaryColor).toBe('#000000');
  });

  it('layers tenant values over the platform defaults field by field', () => {
    const store = useInvoiceStore.getState();
    store.setInvoiceBranding({ primaryColor: '#000000', fontFamily: 'PlatformFont' });
    useInvoiceStore
      .getState()
      .setTenantBranding('tenant-a', { branding: { primaryColor: '#ff0000' } });

    const resolved = useInvoiceStore.getState().resolveBranding('tenant-a');
    expect(resolved.source).toBe('tenant');
    expect(resolved.branding.primaryColor).toBe('#ff0000');
    // The tenant overrode only its colour, so the platform font shows through.
    expect(resolved.branding.fontFamily).toBe('PlatformFont');
  });

  it('honours a tenant template and numbering prefix', () => {
    useInvoiceStore.getState().setTenantBranding('tenant-a', {
      branding: {},
      templateId: 'tpl-3',
      numberingPrefix: 'ACME',
    });
    const resolved = useInvoiceStore.getState().resolveBranding('tenant-a');
    expect(resolved.templateId).toBe('tpl-3');
    expect(resolved.numberingPrefix).toBe('ACME');
  });

  it('falls back when a tenant points at a template that no longer exists', () => {
    useInvoiceStore.getState().setTenantBranding('tenant-a', { branding: {}, templateId: 'tpl-3' });
    useInvoiceStore.getState().removeTemplate('tpl-3');
    expect(useInvoiceStore.getState().resolveBranding('tenant-a').templateId).toBe('tpl-1');
  });

  it('falls back to the platform default for an unknown tenant', () => {
    const resolved = useInvoiceStore.getState().resolveBranding('never-registered');
    expect(resolved.source).toBe('fallback');
  });
});

describe('template management', () => {
  it('replaces a template registered under an existing id', () => {
    const store = useInvoiceStore.getState();
    store.addTemplate({ id: 'tpl-1', name: 'Renamed', layout: 'minimalist' });
    const templates = useInvoiceStore.getState().templates;
    expect(templates).toHaveLength(3);
    expect(templates.find((t) => t.id === 'tpl-1')?.name).toBe('Renamed');
  });

  it('clears the default template pointer when that template is removed', () => {
    const store = useInvoiceStore.getState();
    store.setDefaultTemplate('tpl-2');
    useInvoiceStore.getState().removeTemplate('tpl-2');
    expect(useInvoiceStore.getState().config.defaultTemplateId).toBeUndefined();
    expect(useInvoiceStore.getState().resolveBranding().templateId).toBe('tpl-1');
  });
});

describe('applyBrandingToInvoice', () => {
  it('stamps the resolved branding onto an existing invoice', () => {
    useInvoiceStore.setState({ invoices: [makeInvoice()] });
    useInvoiceStore.getState().setTenantBranding('tenant-a', {
      displayName: 'Acme Inc.',
      branding: { primaryColor: '#ff0000' },
      templateId: 'tpl-2',
    });

    const updated = useInvoiceStore.getState().applyBrandingToInvoice('inv-1', 'tenant-a');
    expect(updated?.tenantId).toBe('tenant-a');
    expect(updated?.branding?.primaryColor).toBe('#ff0000');
    expect(updated?.templateId).toBe('tpl-2');
    expect(updated?.merchantName).toBe('Acme Inc.');
    expect(useInvoiceStore.getState().invoices[0].merchantName).toBe('Acme Inc.');
  });

  it("reuses the invoice's own tenant when none is passed", () => {
    useInvoiceStore.setState({ invoices: [makeInvoice({ tenantId: 'tenant-a' })] });
    useInvoiceStore
      .getState()
      .setTenantBranding('tenant-a', { branding: { primaryColor: '#0000ff' } });

    expect(useInvoiceStore.getState().applyBrandingToInvoice('inv-1')?.branding?.primaryColor).toBe(
      '#0000ff'
    );
  });

  it('returns null for an unknown invoice', () => {
    expect(useInvoiceStore.getState().applyBrandingToInvoice('nope')).toBeNull();
  });
});
