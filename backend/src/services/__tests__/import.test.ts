import {
  importSubscriptions,
  parseCsv,
  parsePriceMinor,
  duplicateKey,
  ImportError,
  type ImportSubscriptionInput,
} from '../import';

const HEADER = 'name,price,currency,billing_cycle,next_billing_date,category';

function deps(existing: Array<{ name: string; currency: string; billingCycle: string }> = []) {
  const created: ImportSubscriptionInput[] = [];
  const logger = { info: jest.fn(), warn: jest.fn() };
  return {
    created,
    logger,
    deps: {
      existing,
      logger,
      create: jest.fn(async (input: ImportSubscriptionInput) => {
        created.push(input);
        return { id: `sub_${created.length}` };
      }),
    },
  };
}

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas/newlines, CRLF and BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,"oops')).toThrow(ImportError);
  });
});

describe('parsePriceMinor', () => {
  it.each([
    ['9.99', 999],
    ['10', 1000],
    ['0.5', 50],
  ])('parses %s', (raw, minor) => expect(parsePriceMinor(raw)).toBe(minor));

  it.each(['0', '-1', '1.234', 'abc', '', '1e3'])('rejects %p', (raw) =>
    expect(parsePriceMinor(raw)).toBeUndefined(),
  );
});

describe('importSubscriptions', () => {
  it('creates valid rows and normalises values', async () => {
    const { deps: d, created } = deps();
    const summary = await importSubscriptions(
      `${HEADER}\nNetflix,15.49,usd,Monthly,2026-12-01,Streaming\n`,
      d,
    );
    expect(summary).toMatchObject({ total: 1, created: 1, duplicates: 0, failed: 0, dryRun: false });
    expect(created[0]).toEqual({
      name: 'Netflix',
      priceMinor: 1549,
      currency: 'USD',
      billingCycle: 'monthly',
      nextBillingDate: '2026-12-01',
      category: 'Streaming',
    });
    expect(summary.rows[0]).toMatchObject({ line: 2, status: 'created', id: 'sub_1' });
  });

  it('accepts columns in any order and ignores unknown ones with a warning', async () => {
    const { deps: d, created, logger } = deps();
    await importSubscriptions('billing_cycle,currency,price,name,color\nyearly,eur,99,Spotify,green\n', d);
    expect(created[0]).toMatchObject({ name: 'Spotify', priceMinor: 9900, currency: 'EUR' });
    expect(logger.warn).toHaveBeenCalledWith('[import] ignoring unknown columns', { columns: ['color'] });
  });

  it('reports per-row errors without blocking valid rows', async () => {
    const { deps: d } = deps();
    const summary = await importSubscriptions(
      [
        HEADER,
        'Good,5,USD,monthly,,',
        ',5,USD,monthly,,',
        'BadPrice,-3,USD,monthly,,',
        'BadCycle,5,USD,fortnightly,,',
        'BadCur,5,DOLLARS,monthly,,',
        'BadDate,5,USD,monthly,2026-02-31,',
        'AlsoGood,7,USD,weekly,,',
      ].join('\n'),
      d,
    );
    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(5);
    const byLine = Object.fromEntries(summary.rows.map((r) => [r.line, r]));
    expect(byLine[3].errors.map((e) => e.field)).toEqual(['name']);
    expect(byLine[4].errors.map((e) => e.field)).toEqual(['price']);
    expect(byLine[5].errors.map((e) => e.field)).toEqual(['billing_cycle']);
    expect(byLine[6].errors.map((e) => e.field)).toEqual(['currency']);
    expect(byLine[7].errors.map((e) => e.field)).toEqual(['next_billing_date']);
    expect(byLine[8].status).toBe('created');
  });

  it('collects every error on a row', async () => {
    const { deps: d } = deps();
    const summary = await importSubscriptions(`${HEADER}\n,0,X,never,nope,\n`, d);
    expect(summary.rows[0].errors.map((e) => e.field)).toEqual([
      'name',
      'price',
      'currency',
      'billing_cycle',
      'next_billing_date',
    ]);
  });

  it('detects duplicates against existing subscriptions (case/space-insensitive)', async () => {
    const { deps: d, created } = deps([{ name: 'netflix', currency: 'USD', billingCycle: 'monthly' }]);
    const summary = await importSubscriptions(`${HEADER}\n  NETFLIX ,15,usd,monthly,,\n`, d);
    expect(created).toHaveLength(0);
    expect(summary.duplicates).toBe(1);
    expect(summary.rows[0]).toMatchObject({ status: 'duplicate', duplicateOf: 'existing' });
  });

  it('detects duplicates within the same file and points at the first occurrence', async () => {
    const { deps: d, created } = deps();
    const summary = await importSubscriptions(
      `${HEADER}\nHulu,8,USD,monthly,,\nHulu,9,USD,monthly,,\nHulu,8,USD,yearly,,\n`,
      d,
    );
    expect(created.map((c) => c.billingCycle)).toEqual(['monthly', 'yearly']);
    expect(summary.rows[1]).toMatchObject({ status: 'duplicate', duplicateOf: { line: 2 } });
  });

  it('turns a create() failure into a row error and lets a later identical row retry', async () => {
    const d = deps();
    d.deps.create.mockRejectedValueOnce(new Error('db down'));
    const summary = await importSubscriptions(`${HEADER}\nHulu,8,USD,monthly,,\nHulu,8,USD,monthly,,\n`, d.deps);
    expect(summary.rows[0]).toMatchObject({ status: 'error', errors: [{ field: '*', message: 'db down' }] });
    expect(summary.rows[1].status).toBe('created');
  });

  it('dry run validates and dedupes but never calls create', async () => {
    const d = deps();
    const summary = await importSubscriptions(`${HEADER}\nA,1,USD,monthly,,\nA,1,USD,monthly,,\n,1,USD,monthly,,\n`, d.deps, {
      dryRun: true,
    });
    expect(d.deps.create).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ dryRun: true, created: 1, duplicates: 1, failed: 1 });
    expect(summary.rows[0].status).toBe('would_create');
  });

  it('keeps source line numbers across blank lines', async () => {
    const d = deps();
    const summary = await importSubscriptions(`${HEADER}\n\nA,1,USD,monthly,,\n\n,1,USD,monthly,,\n`, d.deps);
    expect(summary.rows.map((r) => r.line)).toEqual([3, 5]);
  });

  it('flags rows with extra populated columns', async () => {
    const d = deps();
    const summary = await importSubscriptions('name,price,currency,billing_cycle\nA,1,USD,monthly,surprise\n', d.deps);
    expect(summary.rows[0].errors[0].message).toMatch(/5 columns but the header has 4/);
  });

  it('rejects structurally bad files with typed errors', async () => {
    const d = deps();
    await expect(importSubscriptions('', d.deps)).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    await expect(importSubscriptions('name,price\nA,1\n', d.deps)).rejects.toMatchObject({
      code: 'MISSING_COLUMNS',
      message: expect.stringContaining('currency, billing_cycle'),
    });
    await expect(
      importSubscriptions(`${HEADER}\nA,1,USD,monthly,,\nB,1,USD,monthly,,\n`, d.deps, { maxRows: 1 }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_ROWS' });
  });

  it('logs a summary for observability', async () => {
    const d = deps();
    await importSubscriptions(`${HEADER}\nA,1,USD,monthly,,\n`, d.deps);
    expect(d.logger.info).toHaveBeenCalledWith(
      '[import] subscription import finished',
      expect.objectContaining({ total: 1, created: 1, failed: 0 }),
    );
  });

  it('re-running the same file creates nothing new', async () => {
    const d = deps();
    const csv = `${HEADER}\nA,1,USD,monthly,,\nB,2,USD,yearly,,\n`;
    await importSubscriptions(csv, d.deps);
    const second = await importSubscriptions(
      csv,
      { ...d.deps, existing: d.created.map((c) => ({ name: c.name, currency: c.currency, billingCycle: c.billingCycle })) },
    );
    expect(second).toMatchObject({ created: 0, duplicates: 2 });
  });
});

describe('duplicateKey', () => {
  it('collapses whitespace and case', () => {
    expect(duplicateKey(' My   App ', 'usd', 'Monthly')).toBe('my app|USD|monthly');
  });
});
