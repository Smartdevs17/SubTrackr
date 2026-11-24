/**
 * backend/src/services/export.ts
 *
 * Issue #2007 — export to CSV with field-level encryption at rest.
 *
 * The service keeps encrypted cells in the export store and only materialises
 * plaintext CSV at download time. Columns marked `pii` are encrypted
 * individually with AES-256-GCM, so a store dump never contains a plain email
 * address, name, phone number or subscriber id. Non-PII columns stay readable
 * for support tooling. Every write and read is logged and counted through
 * injected telemetry; no cell value is ever included in a log line.
 */

import { createHash, randomBytes } from 'crypto';
import {
  decryptField,
  encryptField,
  generateEncryptionKey,
  generateKey,
} from '../../services/shared/encryption';
import type { EncryptedField, EncryptionKey } from '../../services/shared/encryption';
import { logger as defaultLogger } from '../utils/logger';

// ── Public types ──────────────────────────────────────────────────────────────

export type CsvCellValue = string | number | boolean | null | undefined;

export interface CsvExportRow {
  [field: string]: CsvCellValue;
}

export interface CsvExportColumn {
  key: string;
  header: string;
  /** When true the cell is encrypted independently before it is stored. */
  pii?: boolean;
}

export interface StoredCsvColumn {
  key: string;
  header: string;
  pii: boolean;
}

/** Serialised form kept by the store. PII cells contain JSON `EncryptedField` values. */
export interface StoredCsvExport {
  exportId: string;
  ownerId: string;
  filename: string;
  columns: StoredCsvColumn[];
  rows: Array<Record<string, string>>;
  createdAt: number;
  expiresAt: number;
  rowCount: number;
  encryptedCellCount: number;
  checksum: string;
}

export interface CsvExportRequest {
  exportId?: string;
  ownerId: string;
  actorId?: string;
  filename?: string;
  columns: CsvExportColumn[];
  rows: CsvExportRow[];
  expiresInMinutes?: number;
}

export interface CsvExportSummary {
  exportId: string;
  ownerId: string;
  filename: string;
  rowCount: number;
  columnCount: number;
  encryptedCellCount: number;
  createdAt: number;
  expiresAt: number;
}

export interface CsvDownloadResult {
  exportId: string;
  filename: string;
  contentType: string;
  content: string;
  rowCount: number;
  downloadedAt: number;
}

export interface CsvExportStore {
  put(record: StoredCsvExport): Promise<void>;
  get(exportId: string): Promise<StoredCsvExport | null>;
  delete?(exportId: string): Promise<void>;
}

export interface CsvFieldEncryption {
  currentKeyId(): string;
  encrypt(value: string): Promise<EncryptedField>;
  decrypt(field: EncryptedField): Promise<string>;
  registerKey?(key: EncryptionKey): void;
}

export interface CsvExportLogger {
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

export interface CsvExportMetrics {
  increment?(name: string, value?: number, tags?: Record<string, string>): void;
  timing?(name: string, milliseconds: number, tags?: Record<string, string>): void;
}

export type CsvExportErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'INTEGRITY_ERROR'
  | 'INVALID_ENCRYPTED_CELL'
  | 'UNKNOWN_KEY'
  | 'ENCRYPTION_FAILED';

export class CsvExportError extends Error {
  constructor(
    public readonly code: CsvExportErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'CsvExportError';
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const METRIC_PREFIX = 'subtrackr.csvExport';
const DEFAULT_MAX_ROWS = 50_000;
const DEFAULT_EXPIRES_IN_MINUTES = 15;
const MAX_EXPIRES_IN_MINUTES = 24 * 60;

// ── CSV helpers ───────────────────────────────────────────────────────────────

/** Quote a cell only when the CSV grammar requires it; embedded quotes double. */
export function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatCsvCell(value: CsvCellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Yield one CRLF-terminated CSV record at a time. Consumers that write to a
 * socket or a file can keep only a single row in memory instead of one string
 * per row plus a second joined copy of the whole export.
 */
export function* csvLines(
  columns: StoredCsvColumn[],
  rows: Iterable<Record<string, string>>
): Generator<string> {
  yield `${columns.map((column) => escapeCsvCell(column.header)).join(',')}\r\n`;
  for (const row of rows) {
    yield `${columns.map((column) => escapeCsvCell(formatCsvCell(row[column.key]))).join(',')}\r\n`;
  }
}

export function rowsToCsv(columns: StoredCsvColumn[], rows: Array<Record<string, string>>): string {
  let content = '';
  for (const line of csvLines(columns, rows)) content += line;
  return content;
}

export function safeCsvFilename(filename: string | undefined): string {
  const base = (filename ?? 'subtrackr-export')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const withoutExtension = base.replace(/\.csv$/i, '');
  return `${withoutExtension || 'subtrackr-export'}.csv`;
}

function checksumFor(columns: StoredCsvColumn[], rows: Array<Record<string, string>>): string {
  return createHash('sha256').update(JSON.stringify({ columns, rows })).digest('hex');
}

function isEncryptedField(value: unknown): value is EncryptedField {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const field = value as Partial<EncryptedField>;
  return (
    typeof field.ciphertext === 'string' &&
    typeof field.iv === 'string' &&
    typeof field.authTag === 'string' &&
    typeof field.keyId === 'string' &&
    field.algorithm === 'aes-256-gcm'
  );
}

function parseEncryptedCell(cell: string): EncryptedField {
  try {
    const parsed: unknown = JSON.parse(cell);
    if (isEncryptedField(parsed)) return parsed;
  } catch {
    // Fall through to the typed error below.
  }
  throw new CsvExportError(
    'INVALID_ENCRYPTED_CELL',
    'Stored PII cell is not a valid encrypted field'
  );
}

// ── Encryption provider ───────────────────────────────────────────────────────

export interface AesGcmFieldEncryptionOptions {
  /** 32-byte master key. A process-local key is generated when omitted. */
  masterKey?: Buffer;
  keyVersion?: number;
}

/**
 * AES-256-GCM field encryption backed by the shared encryption primitives.
 * A process-local master key keeps development usable; deployments should
 * inject a stable key so exports survive a restart.
 */
export function createAesGcmFieldEncryption(
  options: AesGcmFieldEncryptionOptions = {}
): CsvFieldEncryption {
  const masterKey = options.masterKey ?? generateKey();
  const key = generateEncryptionKey(masterKey, options.keyVersion ?? 1);
  const keys = new Map<string, EncryptionKey>([[key.id, key]]);

  return {
    currentKeyId: () => key.id,
    async encrypt(value: string): Promise<EncryptedField> {
      return encryptField(value, key);
    },
    async decrypt(field: EncryptedField): Promise<string> {
      const resolved = keys.get(field.keyId);
      if (!resolved) {
        throw new CsvExportError('UNKNOWN_KEY', `No encryption key registered for ${field.keyId}`);
      }
      try {
        return decryptField(field, resolved).value;
      } catch (error) {
        throw new CsvExportError(
          'ENCRYPTION_FAILED',
          'Encrypted cell could not be decrypted',
          error
        );
      }
    },
    registerKey(nextKey: EncryptionKey): void {
      keys.set(nextKey.id, nextKey);
    },
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────

export function createInMemoryCsvExportStore(): CsvExportStore {
  const records = new Map<string, StoredCsvExport>();
  return {
    async put(record: StoredCsvExport): Promise<void> {
      records.set(record.exportId, { ...record });
    },
    async get(exportId: string): Promise<StoredCsvExport | null> {
      const record = records.get(exportId);
      return record ? { ...record } : null;
    },
    async delete(exportId: string): Promise<void> {
      records.delete(exportId);
    },
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface CsvExportServiceOptions {
  store?: CsvExportStore;
  encryption?: CsvFieldEncryption;
  logger?: CsvExportLogger;
  metrics?: CsvExportMetrics;
  now?: () => number;
  idFactory?: () => string;
  maxRows?: number;
  defaultExpiresInMinutes?: number;
}

/** Metadata returned once a streamed download has been fully consumed. */
export interface CsvStreamResult {
  filename: string;
  contentType: string;
  rowCount: number;
  downloadedAt: number;
}

export interface CsvExportService {
  create(request: CsvExportRequest): Promise<CsvExportSummary>;
  download(exportId: string): Promise<CsvDownloadResult>;
  /** Decrypt and emit CSV records lazily, one row at a time. */
  stream(exportId: string): AsyncGenerator<string, CsvStreamResult, void>;
  getSummary(exportId: string): Promise<CsvExportSummary>;
  remove(exportId: string): Promise<void>;
}

function validateRequest(
  request: CsvExportRequest,
  maxRows: number,
  defaultExpiresInMinutes: number
): { columns: StoredCsvColumn[]; expiresAtOffset: number } {
  if (!request || typeof request !== 'object') {
    throw new CsvExportError('INVALID_REQUEST', 'An export request is required');
  }
  if (!request.ownerId || !request.ownerId.trim()) {
    throw new CsvExportError('INVALID_REQUEST', 'ownerId is required');
  }
  if (!Array.isArray(request.columns) || request.columns.length === 0) {
    throw new CsvExportError('INVALID_REQUEST', 'At least one column is required');
  }
  if (!Array.isArray(request.rows)) {
    throw new CsvExportError('INVALID_REQUEST', 'rows must be an array');
  }
  if (request.rows.length > maxRows) {
    throw new CsvExportError('INVALID_REQUEST', `rows cannot exceed ${maxRows} entries`);
  }
  const keys = new Set<string>();
  const headers = new Set<string>();
  const columns: StoredCsvColumn[] = [];
  for (const column of request.columns) {
    if (!column || typeof column.key !== 'string' || !column.key.trim()) {
      throw new CsvExportError('INVALID_REQUEST', 'Every column needs a key');
    }
    if (typeof column.header !== 'string' || !column.header.trim()) {
      throw new CsvExportError('INVALID_REQUEST', `Column ${column.key} needs a header`);
    }
    if (keys.has(column.key) || headers.has(column.header)) {
      throw new CsvExportError('INVALID_REQUEST', 'Column keys and headers must be unique');
    }
    keys.add(column.key);
    headers.add(column.header);
    columns.push({ key: column.key, header: column.header, pii: column.pii === true });
  }
  const expiresInMinutes = request.expiresInMinutes ?? defaultExpiresInMinutes;
  if (
    !Number.isFinite(expiresInMinutes) ||
    expiresInMinutes <= 0 ||
    expiresInMinutes > MAX_EXPIRES_IN_MINUTES
  ) {
    throw new CsvExportError(
      'INVALID_REQUEST',
      `expiresInMinutes must be between 0 and ${MAX_EXPIRES_IN_MINUTES}`
    );
  }
  return { columns, expiresAtOffset: Math.floor(expiresInMinutes * 60_000) };
}

function toSummary(record: StoredCsvExport): CsvExportSummary {
  return {
    exportId: record.exportId,
    ownerId: record.ownerId,
    filename: record.filename,
    rowCount: record.rowCount,
    columnCount: record.columns.length,
    encryptedCellCount: record.encryptedCellCount,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function createCsvExportService(options: CsvExportServiceOptions = {}): CsvExportService {
  const store = options.store ?? createInMemoryCsvExportStore();
  const encryption = options.encryption ?? createAesGcmFieldEncryption();
  const log = options.logger ?? defaultLogger;
  const metrics = options.metrics;
  const now = options.now ?? Date.now;
  const idFactory = options.idFactory ?? (() => `csv-${randomBytes(16).toString('hex')}`);
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const defaultExpiresInMinutes = options.defaultExpiresInMinutes ?? DEFAULT_EXPIRES_IN_MINUTES;

  const emit = (name: string, tags?: Record<string, string>): void => {
    metrics?.increment?.(`${METRIC_PREFIX}.${name}`, 1, tags);
  };

  const validatedRecord = async (exportId: string): Promise<StoredCsvExport> => {
    const record = await store.get(exportId);
    if (!record) {
      emit('not_found');
      throw new CsvExportError('NOT_FOUND', 'Export not found');
    }
    if (now() > record.expiresAt) {
      emit('expired');
      await store.delete?.(exportId);
      throw new CsvExportError('EXPIRED', 'Export has expired');
    }
    if (checksumFor(record.columns, record.rows) !== record.checksum) {
      emit('integrity_failed');
      throw new CsvExportError('INTEGRITY_ERROR', 'Export payload failed its checksum');
    }
    return record;
  };

  async function* streamCsv(exportId: string): AsyncGenerator<string, CsvStreamResult, void> {
    const startedAt = now();
    const record = await validatedRecord(exportId);
    yield `${record.columns.map((column) => escapeCsvCell(column.header)).join(',')}\r\n`;
    try {
      for (const storedRow of record.rows) {
        const cells: string[] = [];
        for (const column of record.columns) {
          const cell = storedRow[column.key] ?? '';
          const plaintext =
            column.pii && cell !== ''
              ? await encryption.decrypt(parseEncryptedCell(cell))
              : cell;
          cells.push(escapeCsvCell(plaintext));
        }
        yield `${cells.join(',')}\r\n`;
      }
    } catch (error) {
      log.error?.('CSV export decryption failed', { exportId });
      emit('decryption_failed');
      throw error;
    }
    const downloadedAt = now();
    log.info?.('CSV export downloaded', { exportId, ownerId: record.ownerId });
    emit('downloaded');
    metrics?.timing?.(`${METRIC_PREFIX}.download`, Math.max(0, downloadedAt - startedAt));
    return {
      filename: record.filename,
      contentType: 'text/csv; charset=utf-8',
      rowCount: record.rowCount,
      downloadedAt,
    };
  }

  return {
    async create(request: CsvExportRequest): Promise<CsvExportSummary> {
      const startedAt = now();
      const { columns, expiresAtOffset } = validateRequest(
        request,
        maxRows,
        defaultExpiresInMinutes
      );
      const storedRows: Array<Record<string, string>> = [];
      let encryptedCellCount = 0;

      try {
        for (const row of request.rows) {
          const storedRow: Record<string, string> = {};
          for (const column of columns) {
            const value = formatCsvCell(row[column.key]);
            if (column.pii && value !== '') {
              const encrypted = await encryption.encrypt(value);
              storedRow[column.key] = JSON.stringify(encrypted);
              encryptedCellCount += 1;
            } else {
              storedRow[column.key] = value;
            }
          }
          storedRows.push(storedRow);
        }
      } catch (error) {
        const wrapped =
          error instanceof CsvExportError
            ? error
            : new CsvExportError('ENCRYPTION_FAILED', 'PII fields could not be encrypted', error);
        log.error?.('CSV export encryption failed', { exportId: request.exportId ?? null });
        emit('encryption_failed');
        throw wrapped;
      }

      const createdAt = now();
      const record: StoredCsvExport = {
        exportId: request.exportId ?? idFactory(),
        ownerId: request.ownerId,
        filename: safeCsvFilename(request.filename),
        columns,
        rows: storedRows,
        createdAt,
        expiresAt: createdAt + expiresAtOffset,
        rowCount: storedRows.length,
        encryptedCellCount,
        checksum: checksumFor(columns, storedRows),
      };
      await store.put(record);
      log.info?.('CSV export created', {
        exportId: record.exportId,
        ownerId: record.ownerId,
        rowCount: record.rowCount,
        encryptedCellCount,
      });
      emit('created', { encryption: 'aes-256-gcm' });
      metrics?.timing?.(`${METRIC_PREFIX}.create`, Math.max(0, now() - startedAt));
      return toSummary(record);
    },

    async download(exportId: string): Promise<CsvDownloadResult> {
      // Backwards-compatible buffered API: collects the same chunks a streaming
      // caller would write straight to the response body.
      const iterator = streamCsv(exportId);
      let content = '';
      let chunk = await iterator.next();
      while (!chunk.done) {
        content += chunk.value;
        chunk = await iterator.next();
      }
      const meta = chunk.value;
      return {
        exportId,
        filename: meta.filename,
        contentType: meta.contentType,
        content,
        rowCount: meta.rowCount,
        downloadedAt: meta.downloadedAt,
      };
    },

    stream: streamCsv,

    async getSummary(exportId: string): Promise<CsvExportSummary> {
      const record = await store.get(exportId);
      if (!record) throw new CsvExportError('NOT_FOUND', 'Export not found');
      return toSummary(record);
    },

    async remove(exportId: string): Promise<void> {
      await store.delete?.(exportId);
      log.info?.('CSV export removed', { exportId });
      emit('removed');
    },
  };
}
