import { InMemoryPreviewCache } from '../cache';
import type { CachedInvoicePreview } from '../types';

const makePreview = (overrides: Partial<CachedInvoicePreview> = {}): CachedInvoicePreview => ({
  key: 'invoice-preview:inv-1:v1:*:*',
  invoiceId: 'inv-1',
  tenantId: 'tenant-1',
  templateId: 'tpl-1',
  version: 'v1',
  html: '<html>invoice</html>',
  text: 'invoice',
  renderedAt: 1_000,
  expiresAt: 2_000,
  ...overrides,
});

describe('InMemoryPreviewCache', () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
  });

  it('returns cached previews and records hit/miss counters', () => {
    const cache = new InMemoryPreviewCache({ now: () => now });
    const key = 'invoice-preview:inv-1:v1:*:*';

    expect(cache.get(key)).toBeUndefined();
    cache.set(key, makePreview());
    expect(cache.get(key)?.html).toBe('<html>invoice</html>');
    expect(cache.stats()).toMatchObject({ size: 1, hits: 1, misses: 1, sets: 1 });
  });

  it('expires entries using the caller-supplied clock', () => {
    const cache = new InMemoryPreviewCache({ now: () => now });
    cache.set('key', makePreview({ expiresAt: now + 50 }));

    expect(cache.get('key')).toBeDefined();
    now += 51;
    expect(cache.get('key')).toBeUndefined();
    expect(cache.stats().size).toBe(0);
  });

  it('evicts the oldest entry when the size cap is exceeded', () => {
    const cache = new InMemoryPreviewCache({ now: () => now, maxEntries: 2 });
    cache.set('a', makePreview({ key: 'a' }));
    cache.set('b', makePreview({ key: 'b' }));
    cache.set('c', makePreview({ key: 'c' }));

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('invalidates by invoice and by tenant', () => {
    const cache = new InMemoryPreviewCache({ now: () => now });
    cache.set('a', makePreview({ key: 'a', invoiceId: 'inv-1', tenantId: 'tenant-1' }));
    cache.set('b', makePreview({ key: 'b', invoiceId: 'inv-2', tenantId: 'tenant-1' }));
    cache.set('c', makePreview({ key: 'c', invoiceId: 'inv-3', tenantId: 'tenant-2' }));

    cache.invalidate('inv-1');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();

    cache.invalidateTenant('tenant-1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.stats().invalidations).toBe(2);
  });
});
