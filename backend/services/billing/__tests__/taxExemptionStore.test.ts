/**
 * Tests for the Postgres-backed customer tax status store (issue #1740).
 */

import { PostgresCustomerTaxStatusStore } from '../taxExemptionService';
import type { Pool } from '../../../shared/db/connectionPool';
import type { CustomerTaxStatus } from '../taxTypes';

function makePool(rows: unknown[] = []) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const pool = {
    query: jest.fn((text: string, params: unknown[]) => {
      queries.push({ text, params });
      return Promise.resolve({ rows });
    }),
  } as unknown as Pool;
  return { pool, queries };
}

const status: CustomerTaxStatus = {
  isExempt: true,
  certificateId: 'CERT-1',
  certificateExpiry: 1_900_000_000_000,
  issuingAuthority: 'IRS',
  exemptJurisdictions: ['US-CA'],
};

describe('PostgresCustomerTaxStatusStore (#1740)', () => {
  it('maps a stored row back to a CustomerTaxStatus', async () => {
    const { pool } = makePool([
      {
        is_exempt: true,
        certificate_id: 'CERT-1',
        certificate_expiry: '1900000000000',
        issuing_authority: 'IRS',
        exempt_jurisdictions: ['US-CA'],
      },
    ]);
    const store = new PostgresCustomerTaxStatusStore(pool);

    const result = await store.get('cust-1');

    expect(result).toEqual({
      isExempt: true,
      certificateId: 'CERT-1',
      certificateExpiry: 1_900_000_000_000,
      issuingAuthority: 'IRS',
      exemptJurisdictions: ['US-CA'],
    });
  });

  it('returns null when no row exists and defaults a missing jurisdiction list', async () => {
    const { pool } = makePool([]);
    const store = new PostgresCustomerTaxStatusStore(pool);
    expect(await store.get('missing')).toBeNull();

    const { pool: pool2 } = makePool([
      {
        is_exempt: false,
        certificate_id: '',
        certificate_expiry: 0,
        issuing_authority: '',
        exempt_jurisdictions: null,
      },
    ]);
    const store2 = new PostgresCustomerTaxStatusStore(pool2);
    expect((await store2.get('cust-2'))!.exemptJurisdictions).toEqual([]);
  });

  it('upserts the flag and passes the actor through', async () => {
    const { pool, queries } = makePool();
    const store = new PostgresCustomerTaxStatusStore(pool);

    await store.set('cust-1', status, 'admin-1');

    expect(queries[0].text).toContain('INSERT INTO customer_tax_status');
    expect(queries[0].text).toContain('ON CONFLICT (customer_id) DO UPDATE');
    expect(queries[0].params).toEqual([
      'cust-1',
      true,
      'CERT-1',
      1_900_000_000_000,
      'IRS',
      ['US-CA'],
      'admin-1',
    ]);
  });

  it('stores null for the actor when none is supplied', async () => {
    const { pool, queries } = makePool();
    const store = new PostgresCustomerTaxStatusStore(pool);
    await store.set('cust-9', status);
    expect(queries[0].params[6]).toBeNull();
  });

  it('scopes the lookup by customer id', async () => {
    const { pool, queries } = makePool();
    const store = new PostgresCustomerTaxStatusStore(pool);
    await store.get('cust-42');
    expect(queries[0].text).toContain('WHERE customer_id = $1');
    expect(queries[0].params).toEqual(['cust-42']);
  });
});
