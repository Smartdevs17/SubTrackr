/**
 * Tests for invoice numbering schemes (issue #1738).
 *
 * Covers scheme configuration, validation, formatting, yearly reset,
 * per-merchant sequence isolation and the in-memory store.
 */

import {
  createInvoiceNumberingService,
  DEFAULT_INVOICE_NUMBERING_SCHEME,
  formatInvoiceNumber,
  InMemoryInvoiceNumberingStore,
  InvoiceNumberingValidationError,
  invoiceNumberingPeriod,
  parseInvoiceNumberingScheme,
} from '../domain/InvoiceNumberingService';

const at2026 = () => new Date(Date.UTC(2026, 2, 15));
const at2027 = () => new Date(Date.UTC(2027, 0, 3));

function makeService(now: () => Date = at2026) {
  const store = new InMemoryInvoiceNumberingStore();
  return { store, service: createInvoiceNumberingService({ store, now }) };
}

describe('invoice numbering — formatting', () => {
  it('formats defaults as PREFIX-YEAR-SEQUENCE with padding', () => {
    expect(formatInvoiceNumber(DEFAULT_INVOICE_NUMBERING_SCHEME, 1, at2026())).toBe('INV-2026-000001');
  });

  it('omits the year segment when includeYear is false', () => {
    expect(
      formatInvoiceNumber({ prefix: 'ACME', padding: 4, includeYear: false, yearlyReset: false }, 7, at2026())
    ).toBe('ACME-0007');
  });

  it('honours custom prefix and padding together', () => {
    expect(
      formatInvoiceNumber({ prefix: 'BILL', padding: 3, includeYear: true, yearlyReset: true }, 42, at2026())
    ).toBe('BILL-2026-042');
  });

  it('never formats a sequence below 1', () => {
    expect(formatInvoiceNumber(DEFAULT_INVOICE_NUMBERING_SCHEME, 0, at2026())).toBe('INV-2026-000001');
  });

  it('keeps overflow sequences readable (padding is a floor, not a cap)', () => {
    expect(formatInvoiceNumber(DEFAULT_INVOICE_NUMBERING_SCHEME, 1234567, at2026())).toBe(
      'INV-2026-1234567'
    );
  });

  it('uses the UTC year for both the year segment and the period', () => {
    expect(invoiceNumberingPeriod(DEFAULT_INVOICE_NUMBERING_SCHEME, at2026())).toBe('2026');
    expect(invoiceNumberingPeriod({ ...DEFAULT_INVOICE_NUMBERING_SCHEME, yearlyReset: false }, at2026())).toBe(
      ''
    );
  });
});

describe('invoice numbering — scheme validation', () => {
  const valid = { prefix: 'ACME', padding: 4, includeYear: true, yearlyReset: false };

  it('rejects a non-object scheme', () => {
    for (const bad of [null, undefined, 'INV', 5, ['INV']]) {
      expect(() => parseInvoiceNumberingScheme(bad)).toThrow(InvoiceNumberingValidationError);
    }
  });

  it('rejects invalid prefixes', () => {
    for (const prefix of ['', '  ', '123', 'A B', 'INV-', 42, true]) {
      expect(() => parseInvoiceNumberingScheme({ prefix })).toThrow(InvoiceNumberingValidationError);
    }
  });

  it('rejects prefixes longer than 16 characters', () => {
    expect(() => parseInvoiceNumberingScheme({ prefix: 'A'.repeat(17) })).toThrow(/16 characters or fewer/);
  });

  it('trims surrounding whitespace from prefixes', () => {
    expect(parseInvoiceNumberingScheme({ prefix: '  ACME  ' }).prefix).toBe('ACME');
  });

  it('rejects padding outside 1-12 or non-integers', () => {
    for (const padding of [0, -1, 13, 1.5, NaN, '6', null]) {
      expect(() => parseInvoiceNumberingScheme({ padding })).toThrow(InvoiceNumberingValidationError);
    }
    expect(parseInvoiceNumberingScheme({ padding: 1 }).padding).toBe(1);
    expect(parseInvoiceNumberingScheme({ padding: 12 }).padding).toBe(12);
  });

  it('rejects non-boolean includeYear/yearlyReset', () => {
    expect(() => parseInvoiceNumberingScheme({ includeYear: 'true' })).toThrow(/boolean/);
    expect(() => parseInvoiceNumberingScheme({ yearlyReset: 1 })).toThrow(/boolean/);
  });

  it('rejects yearlyReset without includeYear (would reissue numbers)', () => {
    expect(() =>
      parseInvoiceNumberingScheme({ includeYear: false, yearlyReset: true })
    ).toThrow(/yearlyReset requires includeYear/);
  });

  it('implies yearlyReset off when the year segment is explicitly dropped', () => {
    expect(parseInvoiceNumberingScheme({ includeYear: false }).yearlyReset).toBe(false);
    const patched = parseInvoiceNumberingScheme(
      { includeYear: false },
      { prefix: 'ACME', padding: 4, includeYear: true, yearlyReset: true }
    );
    expect(patched.includeYear).toBe(false);
    expect(patched.yearlyReset).toBe(false);
  });

  it('merges a patch over the base scheme instead of replacing it', () => {
    const merged = parseInvoiceNumberingScheme({ prefix: 'ACME' });
    expect(merged).toEqual({ ...DEFAULT_INVOICE_NUMBERING_SCHEME, prefix: 'ACME' });
    expect(merged.padding).toBe(6);
    expect(merged.includeYear).toBe(true);
  });

  it('accepts a fully valid scheme', () => {
    expect(parseInvoiceNumberingScheme(valid)).toEqual(valid);
  });
});

describe('invoice numbering — service', () => {
  it('serves built-in defaults before anything is configured', async () => {
    const { service } = makeService();
    const view = await service.getScheme('merch_a');
    expect(view.isDefault).toBe(true);
    expect(view.scheme).toEqual(DEFAULT_INVOICE_NUMBERING_SCHEME);
    expect(view.sequence).toBe(0);
    expect(view.nextExample).toBe('INV-2026-000001');
  });

  it('requires a merchantId', async () => {
    const { service } = makeService();
    await expect(service.getScheme('')).rejects.toThrow(InvoiceNumberingValidationError);
    await expect(service.configureScheme('', {})).rejects.toThrow(InvoiceNumberingValidationError);
    await expect(service.nextNumber('')).rejects.toThrow(InvoiceNumberingValidationError);
  });

  it('allocates sequential numbers within a merchant', async () => {
    const { service } = makeService();
    const first = await service.nextNumber('merch_a');
    const second = await service.nextNumber('merch_a');
    expect(first.invoiceNumber).toBe('INV-2026-000001');
    expect(first.sequence).toBe(1);
    expect(second.invoiceNumber).toBe('INV-2026-000002');
    expect(second.sequence).toBe(2);
  });

  it('keeps sequences unique per merchant', async () => {
    const { service } = makeService();
    await service.nextNumber('merch_a');
    await service.nextNumber('merch_a');
    const other = await service.nextNumber('merch_b');
    expect(other.sequence).toBe(1);
    expect(other.invoiceNumber).toBe('INV-2026-000001');
    const viewA = await service.getScheme('merch_a');
    expect(viewA.sequence).toBe(2);
  });

  it('applies a configured scheme to subsequently allocated numbers', async () => {
    const { service } = makeService();
    await service.configureScheme('merch_a', { prefix: 'ACME', padding: 4, includeYear: false });
    const first = await service.nextNumber('merch_a');
    expect(first.invoiceNumber).toBe('ACME-0001');
    expect(first.scheme.prefix).toBe('ACME');
  });

  it('merges configuration patches over the stored scheme', async () => {
    const { service } = makeService();
    await service.configureScheme('merch_a', { prefix: 'ACME' });
    const view = await service.configureScheme('merch_a', { padding: 3 });
    expect(view.scheme).toEqual({ prefix: 'ACME', padding: 3, includeYear: true, yearlyReset: true });
    expect(view.isDefault).toBe(false);
  });

  it('preserves the sequence when the scheme is reconfigured', async () => {
    const { service } = makeService();
    await service.nextNumber('merch_a');
    await service.nextNumber('merch_a');
    const view = await service.configureScheme('merch_a', { prefix: 'ACME' });
    expect(view.sequence).toBe(2);
    const next = await service.nextNumber('merch_a');
    expect(next.invoiceNumber).toBe('ACME-2026-000003');
  });

  it('does not save an invalid scheme', async () => {
    const { service } = makeService();
    await service.configureScheme('merch_a', { prefix: 'ACME' });
    await expect(service.configureScheme('merch_a', { prefix: '9' })).rejects.toThrow(
      InvoiceNumberingValidationError
    );
    const view = await service.getScheme('merch_a');
    expect(view.scheme.prefix).toBe('ACME');
  });

  it('resets the sequence when the year rolls over', async () => {
    const store = new InMemoryInvoiceNumberingStore();
    const now = at2026();
    const service = createInvoiceNumberingService({ store, now: () => now });

    await service.nextNumber('merch_a');
    const second = await service.nextNumber('merch_a');
    expect(second.invoiceNumber).toBe('INV-2026-000002');

    now.setTime(Date.UTC(2027, 0, 3));
    const rolled = await service.nextNumber('merch_a');
    expect(rolled.invoiceNumber).toBe('INV-2027-000001');
    expect(rolled.period).toBe('2027');
  });

  it('continues the sequence across years when yearlyReset is off', async () => {
    const store = new InMemoryInvoiceNumberingStore();
    const now = at2026();
    const service = createInvoiceNumberingService({ store, now: () => now });

    await service.configureScheme('merch_a', { yearlyReset: false });
    await service.nextNumber('merch_a');
    await service.nextNumber('merch_a');

    now.setTime(Date.UTC(2027, 0, 3));
    const rolled = await service.nextNumber('merch_a');
    expect(rolled.invoiceNumber).toBe('INV-2027-000003');
    expect(rolled.period).toBe('');
  });

  it('reports the number the next invoice would receive', async () => {
    const { service } = makeService();
    await service.nextNumber('merch_a');
    const view = await service.getScheme('merch_a');
    expect(view.sequence).toBe(1);
    expect(view.nextExample).toBe('INV-2026-000002');
  });

  it('never issues the same number twice within a merchant', async () => {
    const { service } = makeService();
    const numbers = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      numbers.add((await service.nextNumber('merch_a')).invoiceNumber);
    }
    expect(numbers.size).toBe(50);
  });
});

describe('invoice numbering — in-memory store', () => {
  it('stores configuration without touching the sequence', async () => {
    const store = new InMemoryInvoiceNumberingStore();
    await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2026');
    await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2026');
    const configured = await store.configure('merch_a', {
      prefix: 'ACME',
      padding: 4,
      includeYear: false,
      yearlyReset: false,
    });
    expect(configured.sequence).toBe(2);
    expect(configured.scheme.prefix).toBe('ACME');
    const row = await store.get('merch_a');
    expect(row?.sequence).toBe(2);
    expect(row?.scheme.prefix).toBe('ACME');
  });

  it('resets the sequence when the period changes', async () => {
    const store = new InMemoryInvoiceNumberingStore();
    expect(await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2026')).toBe(1);
    expect(await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2026')).toBe(2);
    expect(await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2027')).toBe(1);
    expect(await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2027')).toBe(2);
  });

  it('returns null for unknown merchants and copies state out', async () => {
    const store = new InMemoryInvoiceNumberingStore();
    expect(await store.get('merch_x')).toBeNull();
    await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2026');
    const row = await store.get('merch_a');
    row!.scheme.prefix = 'MUTATED';
    const again = await store.get('merch_a');
    expect(again!.scheme.prefix).toBe('INV');
  });
});
