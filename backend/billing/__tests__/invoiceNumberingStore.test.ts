/**
 * Tests for PostgresInvoiceNumberingStore (issue #1738).
 *
 * Uses a fake pool to assert the SQL contract: a single atomic upsert for
 * allocation, sequence-preserving configuration updates, and row mapping.
 */

import {
  DEFAULT_INVOICE_NUMBERING_SCHEME,
  PostgresInvoiceNumberingStore,
} from '../domain/InvoiceNumberingService';
import type { Pool } from '../../shared/db/connectionPool';

type Query = { text: string; params: unknown[] };

function makePool(rows: unknown[] = []): { pool: Pool; queries: Query[] } {
  const queries: Query[] = [];
  const pool = {
    query: jest.fn((text: string, params: unknown[]) => {
      queries.push({ text, params });
      return Promise.resolve({ rows });
    }),
  } as unknown as Pool;
  return { pool, queries };
}

const ROW = {
  merchant_id: 'merch_a',
  prefix: 'ACME',
  padding: 4,
  include_year: false,
  yearly_reset: false,
  sequence: 7,
  period: '',
};

describe('PostgresInvoiceNumberingStore', () => {
  describe('get', () => {
    it('maps a row to a state object', async () => {
      const { pool, queries } = makePool([ROW]);
      const store = new PostgresInvoiceNumberingStore(pool);

      const state = await store.get('merch_a');

      expect(state).toEqual({
        merchantId: 'merch_a',
        scheme: { prefix: 'ACME', padding: 4, includeYear: false, yearlyReset: false },
        sequence: 7,
        period: '',
      });
      expect(queries[0].text).toContain('FROM invoice_numbering');
      expect(queries[0].text).toContain('WHERE merchant_id = $1');
      expect(queries[0].params).toEqual(['merch_a']);
    });

    it('returns null when the merchant has no row', async () => {
      const { pool } = makePool([]);
      const store = new PostgresInvoiceNumberingStore(pool);
      expect(await store.get('merch_missing')).toBeNull();
    });

    it('propagates query failures', async () => {
      const pool = {
        query: jest.fn(() => Promise.reject(new Error('connection lost'))),
      } as unknown as Pool;
      const store = new PostgresInvoiceNumberingStore(pool);
      await expect(store.get('merch_a')).rejects.toThrow('connection lost');
    });
  });

  describe('configure', () => {
    it('upserts the scheme while preserving the sequence', async () => {
      const { pool, queries } = makePool([ROW]);
      const store = new PostgresInvoiceNumberingStore(pool);

      const state = await store.configure('merch_a', {
        prefix: 'ACME',
        padding: 4,
        includeYear: false,
        yearlyReset: false,
      });

      const { text, params } = queries[0];
      expect(text).toContain('INSERT INTO invoice_numbering');
      expect(text).toContain('ON CONFLICT (merchant_id) DO UPDATE');
      const updateClause = text.slice(text.indexOf('DO UPDATE'), text.indexOf('RETURNING'));
      expect(updateClause).not.toContain('sequence');
      expect(text).toContain('RETURNING merchant_id');
      expect(params).toEqual(['merch_a', 'ACME', 4, false, false]);
      expect(state.sequence).toBe(7);
      expect(state.scheme.prefix).toBe('ACME');
    });
  });

  describe('nextSequence', () => {
    it('allocates with a single atomic period-aware upsert', async () => {
      const { pool, queries } = makePool([{ sequence: 3 }]);
      const store = new PostgresInvoiceNumberingStore(pool);

      const sequence = await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2026');

      const { text, params } = queries[0];
      expect(text).toContain('INSERT INTO invoice_numbering');
      expect(text).toContain('ON CONFLICT (merchant_id) DO UPDATE');
      expect(text).toContain('CASE WHEN invoice_numbering.period = EXCLUDED.period');
      expect(text).toContain('RETURNING sequence');
      expect(params).toEqual(['merch_a', 'INV', 6, true, true, '2026']);
      expect(sequence).toBe(3);
    });

    it('coerces a string sequence from the driver to a number', async () => {
      const { pool } = makePool([{ sequence: '12' }]);
      const store = new PostgresInvoiceNumberingStore(pool);
      expect(await store.nextSequence('merch_a', DEFAULT_INVOICE_NUMBERING_SCHEME, '2026')).toBe(12);
    });

    it('passes an empty period when the scheme never resets', async () => {
      const { pool, queries } = makePool([{ sequence: 9 }]);
      const store = new PostgresInvoiceNumberingStore(pool);

      await store.nextSequence('merch_a', { ...DEFAULT_INVOICE_NUMBERING_SCHEME, yearlyReset: false }, '');

      expect(queries[0].params[5]).toBe('');
    });
  });
});
