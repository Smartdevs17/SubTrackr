import { createHash } from 'crypto';
import {
  CsvExportError,
  createAesGcmFieldEncryption,
  createCsvExportService,
  createInMemoryCsvExportStore,
  escapeCsvCell,
  formatCsvCell,
  rowsToCsv,
  safeCsvFilename,
} from '../export';

const MASTER_KEY = Buffer.alloc(32, 7);

function makeService(overrides: Record<string, unknown> = {}) {
  const store = createInMemoryCsvExportStore();
  const metrics = {
    increment: jest.fn(),
    timing: jest.fn(),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = createCsvExportService({
    store,
    encryption: createAesGcmFieldEncryption({ masterKey: MASTER_KEY }),
    metrics,
    logger,
    now: () => 1_700_000_000_000,
    idFactory: () => 'export-1',
    ...overrides,
  });
  return { service, store, metrics, logger };
}

const COLUMNS = [
  { key: 'email', header: 'Email', pii: true },
  { key: 'name', header: 'Full name', pii: true },
  { key: 'plan', header: 'Plan' },
  { key: 'amount', header: 'Amount' },
];

const ROWS = [
  { email: 'alice@example.com', name: 'Alice, "A"', plan: 'pro', amount: 1999 },
  { email: 'bob@example.com', name: 'Bob', plan: 'starter', amount: null },
];

describe('CSV helpers', () => {
  it('quotes only cells that need escaping and doubles embedded quotes', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('formats null, booleans and numbers deterministically', () => {
    expect(formatCsvCell(null)).toBe('');
    expect(formatCsvCell(undefined)).toBe('');
    expect(formatCsvCell(true)).toBe('true');
    expect(formatCsvCell(12.5)).toBe('12.5');
  });

  it('renders headers and rows as CRLF-delimited CSV', () => {
    const csv = rowsToCsv(
      [
        { key: 'a', header: 'A', pii: false },
        { key: 'b', header: 'B', pii: false },
      ],
      [{ a: 'x', b: 'y,z' }]
    );
    expect(csv).toBe('A,B\r\nx,"y,z"\r\n');
  });

  it('sanitises download filenames', () => {
    expect(safeCsvFilename('billing/../report 2026.csv')).toBe('billing-..-report-2026.csv');
    expect(safeCsvFilename(undefined)).toBe('subtrackr-export.csv');
  });
});

describe('createCsvExportService.create', () => {
  it('encrypts PII cells at rest and reports the encrypted field count', async () => {
    const { service, store, metrics } = makeService();

    const summary = await service.create({
      ownerId: 'user-1',
      columns: COLUMNS,
      rows: ROWS,
    });

    expect(summary).toMatchObject({
      exportId: 'export-1',
      ownerId: 'user-1',
      rowCount: 2,
      columnCount: 4,
      encryptedCellCount: 4,
      filename: 'subtrackr-export.csv',
    });
    const stored = await store.get('export-1');
    expect(stored).not.toBeNull();
    const serialised = JSON.stringify(stored);
    expect(serialised).not.toContain('alice@example.com');
    expect(serialised).not.toContain('Alice, "A"');
    expect(serialised).toContain('aes-256-gcm');
    expect((stored as NonNullable<typeof stored>).rows[0].plan).toBe('pro');
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.csvExport.created', 1, {
      encryption: 'aes-256-gcm',
    });
  });

  it('rejects malformed requests before touching the store', async () => {
    const { service, store } = makeService();
    await expect(service.create({ ownerId: 'user-1', columns: [], rows: [] })).rejects.toThrow(
      /At least one column/
    );
    await expect(service.create({ ownerId: ' ', columns: COLUMNS, rows: [] })).rejects.toThrow(
      /ownerId/
    );
    await expect(
      service.create({
        ownerId: 'user-1',
        columns: [
          { key: 'email', header: 'Email' },
          { key: 'email', header: 'Other' },
        ],
        rows: [],
      })
    ).rejects.toThrow(/unique/);
    await expect(
      service.create({ ownerId: 'user-1', columns: COLUMNS, rows: ROWS, expiresInMinutes: -1 })
    ).rejects.toThrow(/expiresInMinutes/);
    expect(await store.get('export-1')).toBeNull();
  });

  it('honours the row limit', async () => {
    const { service } = makeService({ maxRows: 1 });
    await expect(
      service.create({ ownerId: 'user-1', columns: COLUMNS, rows: ROWS })
    ).rejects.toThrow(/50_000|1 entries/);
  });
});

describe('createCsvExportService.download', () => {
  it('decrypts PII fields and produces downloadable CSV', async () => {
    const { service, metrics } = makeService();
    await service.create({ ownerId: 'user-1', columns: COLUMNS, rows: ROWS });

    const result = await service.download('export-1');

    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.filename).toBe('subtrackr-export.csv');
    expect(result.rowCount).toBe(2);
    expect(result.content).toContain('Email,Full name,Plan,Amount');
    expect(result.content).toContain('alice@example.com');
    expect(result.content).toContain('"Alice, ""A"""');
    expect(result.content).toContain('1999');
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.csvExport.downloaded', 1, undefined);
  });

  it('returns a typed error for unknown exports', async () => {
    const { service } = makeService();
    await expect(service.download('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('expires exports and removes them from the store', async () => {
    const { service, store } = makeService();
    await service.create({ ownerId: 'user-1', columns: COLUMNS, rows: ROWS, expiresInMinutes: 1 });
    const serviceAtLaterTime = createCsvExportService({
      store,
      encryption: createAesGcmFieldEncryption({ masterKey: MASTER_KEY }),
      now: () => 1_700_000_000_000 + 60_001,
    });

    await expect(serviceAtLaterTime.download('export-1')).rejects.toMatchObject({
      code: 'EXPIRED',
    });
    expect(await store.get('export-1')).toBeNull();
  });

  it('detects a modified stored payload', async () => {
    const { service, store } = makeService();
    await service.create({ ownerId: 'user-1', columns: COLUMNS, rows: ROWS });
    const stored = await store.get('export-1');
    if (!stored) throw new Error('export was not stored');
    await store.put({
      ...stored,
      rows: [{ ...stored.rows[0], plan: 'tampered' }, ...stored.rows.slice(1)],
    });

    await expect(service.download('export-1')).rejects.toMatchObject({
      code: 'INTEGRITY_ERROR',
    });
  });

  it('rejects cells encrypted with an unknown key', async () => {
    const { service, store } = makeService();
    await service.create({ ownerId: 'user-1', columns: COLUMNS, rows: ROWS });
    const stranger = createCsvExportService({
      store,
      encryption: createAesGcmFieldEncryption({ masterKey: Buffer.alloc(32, 9) }),
    });

    await expect(stranger.download('export-1')).rejects.toBeInstanceOf(CsvExportError);
    await expect(stranger.download('export-1')).rejects.toMatchObject({ code: 'UNKNOWN_KEY' });
  });

  it('rejects a malformed encrypted cell', async () => {
    const { service, store } = makeService();
    await service.create({ ownerId: 'user-1', columns: COLUMNS, rows: ROWS });
    const stored = await store.get('export-1');
    if (!stored) throw new Error('export was not stored');
    await store.put({
      ...stored,
      rows: [{ ...stored.rows[0], email: 'not-json' }, ...stored.rows.slice(1)],
      checksum: createHash('sha256')
        .update(
          JSON.stringify({
            columns: stored.columns,
            rows: [{ ...stored.rows[0], email: 'not-json' }, ...stored.rows.slice(1)],
          })
        )
        .digest('hex'),
    });

    await expect(service.download('export-1')).rejects.toMatchObject({
      code: 'INVALID_ENCRYPTED_CELL',
    });
  });
});

describe('createCsvExportService.remove', () => {
  it('deletes the export and reports it', async () => {
    const { service, store, metrics } = makeService();
    await service.create({ ownerId: 'user-1', columns: COLUMNS, rows: ROWS });

    await service.remove('export-1');

    expect(await store.get('export-1')).toBeNull();
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.csvExport.removed', 1, undefined);
  });
});
